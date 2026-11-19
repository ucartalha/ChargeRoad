/**
 * DEVELOPMENT-ONLY logs (2026-11-19, user request). Printed only when React Native's __DEV__ is true (Expo dev server); a
 * release build never prints them. No coordinates, addresses or GPS traces; SOC values may appear. Every call site is listed
 * in docs/DEV_DIAGNOSTICS.md and must be removed or reviewed before the store release.
 */
declare const __DEV__:boolean|undefined;
export const devLogEnabled=()=>typeof __DEV__!=='undefined'&&__DEV__===true;
/** Rounds numbers so logs stay readable; drops anything that is not a primitive. */
export function devPayload(data:Record<string,unknown>):Record<string,string|number|boolean|null>{
  const out:Record<string,string|number|boolean|null>={};
  for(const [k,v] of Object.entries(data)){
    if(typeof v==='number')out[k]=Number.isFinite(v)?Math.round(v*10)/10:null;
    else if(typeof v==='string'||typeof v==='boolean'||v===null)out[k]=v;
  }
  return out;
}
export function devLog(event:string,data:Record<string,unknown>={}){if(devLogEnabled())console.info('[dev] '+event,devPayload(data));}
