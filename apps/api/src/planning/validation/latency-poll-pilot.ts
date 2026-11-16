/** Offline development hypothesis only. No production importer or environment change. */
export function latencyPilotPollHint(status:string,ageMilliseconds:number,enabled=false,mode='production'){
 return enabled&&mode==='development'&&(status==='queued'||status==='running')&&
  Number.isFinite(ageMilliseconds)&&ageMilliseconds>=0&&ageMilliseconds<10000?2000:5000;
}
