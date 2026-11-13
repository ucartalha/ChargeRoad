import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {DatabaseService} from '../../database/database.service';
import {migrate} from '../../database/migrate';
import {PgPlanningAdmission} from '../http/pg-planning-admission';
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration('Cross-instance atomic planning admission',()=>{
  const schema='planning_slots_'+randomBytes(8).toString('hex'),signal=new AbortController().signal;
  let admin:Pool,pool:Pool,a:PgPlanningAdmission,b:PgPlanningAdmission;
  beforeAll(async()=>{admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema,application_name:schema,max:10});await migrate(pool);
    a=new PgPlanningAdmission({pool} as DatabaseService);b=new PgPlanningAdmission({pool} as DatabaseService);},30000);
  beforeEach(async()=>{await pool.query('UPDATE planning_execution_slots SET token=NULL,expires_at=NULL');await pool.query('UPDATE planning_admission_config SET capacity=2');});
  afterAll(async()=>{await pool.end();if(!/^planning_slots_[a-f0-9]{16}$/.test(schema))throw new Error('Unsafe schema');await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
  it('lets exactly the configured number of tasks enter across independent store instances',async()=>{
    const leases=await Promise.all(Array.from({length:24},(_,i)=>(i%2?a:b).acquire(30000,signal)));
    expect(leases.filter(Boolean)).toHaveLength(2);expect(new Set(leases.filter(Boolean).map(l=>l!.slot)).size).toBe(2);
    for(const l of leases)if(l)await a.release(l);
    expect(await b.acquire(30000,signal)).not.toBeNull();
  });
  it('recovers expired work and prevents the old token from renewing or releasing its replacement',async()=>{
    await pool.query('UPDATE planning_admission_config SET capacity=1');const old=await a.acquire(30000,signal);
    await pool.query("UPDATE planning_execution_slots SET expires_at=clock_timestamp()-interval '1 second' WHERE slot_id=$1",[old!.slot]);
    expect(await a.renew(old!,30000)).toBe(false);const current=await b.acquire(30000,signal);expect(current!.slot).toBe(old!.slot);expect(current!.token).not.toBe(old!.token);
    await a.release(old!);expect(await a.acquire(30000,signal)).toBeNull();expect(await b.renew(current!,30000)).toBe(true);
    await b.release(current!);expect(await a.acquire(30000,signal)).not.toBeNull();
  });
  it('does not hold a transaction/client while the solver runs',async()=>{
    const lease=await a.acquire(30000,signal);expect(lease).not.toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND state='idle in transaction'",[schema])).rows[0].n).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);await a.release(lease!);
  });
  it('fails closed when shared capacity configuration is missing',async()=>{
    await pool.query('DELETE FROM planning_admission_config');await expect(a.acquire(30000,signal)).rejects.toThrow('configuration missing');
    await pool.query('INSERT INTO planning_admission_config(singleton,capacity) VALUES(true,2)');
  });
});
