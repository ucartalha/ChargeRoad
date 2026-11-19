import {PlanningJobsStore,LONG_POLL_MAX_MS} from '../http/planning-jobs.store';

// Long-poll (2026-11-19): a status read may wait until the job finishes instead of the client sleeping a fixed 5 s.
// Fake pool: the job is running until finish() writes it as completed; finish() also notifies waiting readers.
function store(){
  const row:{id:string;status:string;created_at:Date;started_at:Date|null;expires_at:Date;error_code:null}={id:'11111111-1111-4111-8111-111111111111',
    status:'running',created_at:new Date(),started_at:new Date(),expires_at:new Date(Date.now()+600000),error_code:null};
  let reads=0;
  const pool={query:jest.fn(async(sql:string)=>{if(sql.startsWith('UPDATE planning_jobs\n  SET status=$4')){row.status='completed';return {rowCount:1,rows:[]};}
    if(sql.startsWith('SELECT id,status')){reads++;return {rows:[{...row}]};}return {rows:[]};})};
  const s=new PlanningJobsStore({pool} as never);return {s,row,reads:()=>reads};
}
describe('Planning job long-poll',()=>{
  it('bounds the wait',()=>expect(LONG_POLL_MAX_MS).toBeLessThanOrEqual(20000));
  it('returns as soon as the job finishes, not after the full wait',async()=>{
    const {s,row}=store(),began=Date.now();
    setTimeout(()=>void s.finish({id:row.id,lease_token:'t',generation:1},{status:'planned'} as never,null),150);
    const view=await s.status(row.id,'owner',5000);
    expect(view.status).toBe('completed');expect(Date.now()-began).toBeLessThan(1500);
  });
  it('without waitMs answers immediately (old clients)',async()=>{
    const {s,row,reads}=store(),began=Date.now();const view=await s.status(row.id,'owner');
    expect(view.status).toBe('running');expect(reads()).toBe(1);expect(Date.now()-began).toBeLessThan(200);
  });
  it('gives up at the wait limit and when the caller aborts',async()=>{
    const {s,row}=store();let began=Date.now();expect((await s.status(row.id,'owner',300)).status).toBe('running');expect(Date.now()-began).toBeGreaterThanOrEqual(250);
    const c=new AbortController();began=Date.now();setTimeout(()=>c.abort(),100);
    expect((await s.status(row.id,'owner',5000,c.signal)).status).toBe('running');expect(Date.now()-began).toBeLessThan(1000);
  });
});
