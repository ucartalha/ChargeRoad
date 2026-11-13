import {randomUUID} from 'node:crypto';
import {Injectable} from '@nestjs/common';
import type {PoolClient,QueryConfig} from 'pg';
import {DatabaseService} from '../../database/database.service';
import {PlanningAdmissionStore} from './planning-admission.store';
import type {PlanningLease} from './planning-admission.store';

@Injectable()
export class PgPlanningAdmission extends PlanningAdmissionStore {
  constructor(private readonly database:DatabaseService){super();}
  private async client(signal?:AbortSignal){
    signal?.throwIfAborted();const pending=this.database.pool.connect();
    return new Promise<PoolClient>((resolve,reject)=>{
      let finished=false;const finish=(error?:unknown,client?:PoolClient)=>{if(finished){client?.release();return;}finished=true;
        clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(client!);};
      const cancel=()=>finish(signal?.reason??new Error('Admission cancelled')),timer=setTimeout(()=>finish(new Error('Admission DB pool timeout')),400);
      signal?.addEventListener('abort',cancel,{once:true});pending.then(c=>finish(undefined,c),e=>finish(e));
    });
  }
  private async query<T>(text:string,values:unknown[],signal?:AbortSignal){
    const client=await this.client(signal);let discard=false;
    // node-postgres supports per-query client timeouts; @types/pg exposes this only on ClientConfig.
    const execute=(text:string,values?:unknown[])=>{const config:QueryConfig & {query_timeout:number}={text,values,query_timeout:400};return client.query(config);};
    try{signal?.throwIfAborted();await execute('BEGIN');await execute("SET LOCAL statement_timeout='400ms'");
      await execute("SET LOCAL lock_timeout='100ms'");signal?.throwIfAborted();const result=await execute(text,values);
      await execute('COMMIT');return result.rows as T[];
    }catch(error){discard=true;try{await execute('ROLLBACK');}catch{/* discard closes the connection and rolls back any unfinished transaction */}throw error;}
    finally{client.release(discard);}
  }
  async acquire(ttl:number,signal:AbortSignal){
    if(!Number.isInteger(ttl)||ttl<100||ttl>60000)throw new Error('Invalid planning lease TTL');
    const token=randomUUID();const rows=await this.query<{capacity:number;slot_id:number|null}>(`WITH candidate AS (
      SELECT s.slot_id FROM planning_execution_slots s CROSS JOIN planning_admission_config c
      WHERE c.singleton AND s.slot_id<=c.capacity AND (s.token IS NULL OR s.expires_at<=clock_timestamp())
      ORDER BY s.slot_id FOR UPDATE OF s SKIP LOCKED LIMIT 1
    ), claimed AS (
      UPDATE planning_execution_slots s SET token=$1,expires_at=clock_timestamp()+$2::int*interval '1 millisecond'
      FROM candidate a WHERE s.slot_id=a.slot_id RETURNING s.slot_id
    ) SELECT c.capacity,a.slot_id FROM planning_admission_config c LEFT JOIN claimed a ON true WHERE c.singleton`,[token,ttl],signal);
    if(!rows.length)throw new Error('Planning admission configuration missing');
    const row=rows[0];return row.slot_id===null?null:{slot:row.slot_id,token};
  }
  async renew(lease:PlanningLease,ttl:number){
    const rows=await this.query(`UPDATE planning_execution_slots SET expires_at=clock_timestamp()+$3::int*interval '1 millisecond'
      WHERE slot_id=$1 AND token=$2 AND expires_at>clock_timestamp() RETURNING slot_id`,[lease.slot,lease.token,ttl]);return rows.length===1;
  }
  async release(lease:PlanningLease){await this.query('UPDATE planning_execution_slots SET token=NULL,expires_at=NULL WHERE slot_id=$1 AND token=$2',[lease.slot,lease.token]);}
}
