import {createHash,createHmac,randomUUID} from 'node:crypto';
import {Injectable,HttpException,NotFoundException} from '@nestjs/common';
import type {PlanningApiRequest,PlanningApiResponse} from '@chargeroad/shared';
import {planningJobStatusSchema} from '@chargeroad/shared';
import {DatabaseService} from '../../database/database.service';
import {canonicalJson} from '../../vehicles/knowledge/knowledge-package';
@Injectable()
export class PlanningJobsStore {
 constructor(private readonly db:DatabaseService){}
 owner(authorization:string|undefined){
  const match=/^Bearer ([a-f0-9]{64})$/.exec(authorization??'');if(!match)throw new NotFoundException('Planning job not found');
  const secret=process.env.RATE_LIMIT_IP_HASH_SECRET;if(!secret||secret.length<32)throw new HttpException('Planning job access unavailable',503);
  return createHmac('sha256',secret).update('planning-job/v1\0'+match[1]).digest('hex');
 }
 private view(row:any){return planningJobStatusSchema.parse({id:row.id,status:row.status,createdAt:row.created_at.toISOString(),
  startedAt:row.started_at?.toISOString()??null,expiresAt:row.expires_at.toISOString(),errorCode:row.error_code,pollAfterMilliseconds:5000});}
 async create(request:PlanningApiRequest,owner:string){
  const hash=createHash('sha256').update(canonicalJson(request)).digest('hex'),client=await this.db.pool.connect();
  try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2s'");
   await client.query("SELECT pg_advisory_xact_lock(hashtext('chargeroad:planning-jobs:enqueue'))");
   const existing=(await client.query('SELECT id,status,owner_hash,request_hash,created_at,started_at,expires_at,error_code FROM planning_jobs WHERE id=$1 AND expires_at>now()',[request.requestId])).rows[0];
   if(existing){if(existing.owner_hash!==owner)throw new NotFoundException('Planning job not found');
    if(existing.request_hash&&existing.request_hash!==hash)throw new HttpException('Planning job request differs',409);
    await client.query('COMMIT');return this.view(existing);}
   const pending=(await client.query("SELECT count(*)::int n FROM planning_jobs WHERE status IN ('queued','running') AND expires_at>now()")).rows[0].n;
   if(pending>=128)throw new HttpException('Planning queue full',503);
   // Retained IDs cannot be reused; new requests must generate a fresh UUID and capability.
   const row=(await client.query(`INSERT INTO planning_jobs(id,owner_hash,request_hash,request_payload,status)
    VALUES($1,$2,$3,$4::jsonb,'queued') ON CONFLICT DO NOTHING RETURNING *`,[request.requestId,owner,hash,JSON.stringify(request)])).rows[0];
   if(!row)throw new HttpException('Planning job ID expired; create a new request',409);
   await client.query('COMMIT');return this.view(row);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async status(id:string,owner:string){const row=(await this.db.pool.query('SELECT id,status,created_at,started_at,expires_at,error_code FROM planning_jobs WHERE id=$1 AND owner_hash=$2 AND expires_at>now()',[id,owner])).rows[0];
  if(!row)throw new NotFoundException('Planning job not found');return this.view(row);}
 async result(id:string,owner:string):Promise<PlanningApiResponse>{
  const row=(await this.db.pool.query("SELECT status,result_payload FROM planning_jobs WHERE id=$1 AND owner_hash=$2 AND expires_at>now()",[id,owner])).rows[0];
  if(!row)throw new NotFoundException('Planning job not found');if(row.status!=='completed')throw new HttpException('Planning result not ready',409);return row.result_payload;
 }
 async cancel(id:string,owner:string){
  // A short tombstone also fences a submit arriving after its caller has cancelled.
  const row=(await this.db.pool.query(`INSERT INTO planning_jobs(id,owner_hash,status,expires_at,finished_at)
   VALUES($1,$2,'cancelled',now()+interval '2 minutes',now()) ON CONFLICT(id) DO UPDATE
   SET status=CASE WHEN planning_jobs.status IN ('queued','running') THEN 'cancelled' ELSE planning_jobs.status END,
    request_payload=CASE WHEN planning_jobs.status IN ('queued','running') THEN NULL ELSE planning_jobs.request_payload END,
    lease_token=CASE WHEN planning_jobs.status IN ('queued','running') THEN NULL ELSE planning_jobs.lease_token END,
    finished_at=CASE WHEN planning_jobs.status IN ('queued','running') THEN now() ELSE planning_jobs.finished_at END,
    lease_until=CASE WHEN planning_jobs.status IN ('queued','running') THEN NULL ELSE planning_jobs.lease_until END
   WHERE planning_jobs.owner_hash=$2 AND planning_jobs.expires_at>now() RETURNING *`,[id,owner])).rows[0];
  if(!row)throw new NotFoundException('Planning job not found');return this.view(row);
 }
 async claim(){const token=randomUUID();return (await this.db.pool.query(`WITH next AS (
  SELECT id FROM planning_jobs WHERE expires_at>now() AND (status='queued' OR status='running' AND lease_until<=now())
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  UPDATE planning_jobs j SET status='running',lease_token=$1,generation=j.generation+1,lease_until=now()+interval '30 seconds',
   started_at=COALESCE(j.started_at,now()) FROM next WHERE j.id=next.id
  RETURNING j.id,j.request_payload,j.lease_token,j.generation`,[token])).rows[0]??null;}
 async renew(job:any){return !!(await this.db.pool.query(`UPDATE planning_jobs SET lease_until=now()+interval '30 seconds'
  WHERE id=$1 AND lease_token=$2 AND generation=$3 AND status='running' AND lease_until>now() AND expires_at>now() RETURNING 1`,[job.id,job.lease_token,job.generation])).rowCount;}
 async finish(job:any,result:PlanningApiResponse|null,error:string|null){await this.db.pool.query(`UPDATE planning_jobs
  SET status=$4,result_payload=$5::jsonb,error_code=$6,request_payload=NULL,finished_at=now(),lease_token=NULL,lease_until=NULL
  WHERE id=$1 AND lease_token=$2 AND generation=$3 AND status='running' AND lease_until>now() AND expires_at>now()`,
  [job.id,job.lease_token,job.generation,result?'completed':'failed',result?JSON.stringify(result):null,error]);}
 async cleanup(){await this.db.pool.query("DELETE FROM planning_jobs WHERE expires_at<=now() AND (lease_until IS NULL OR lease_until<=now())");}
}
