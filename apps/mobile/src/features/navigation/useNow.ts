import {useEffect,useState} from 'react';
/** Wall clock that re-renders every intervalMs (0 = frozen); the navigation bar's arrival time uses it. */
export function useNow(intervalMs:number){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{setNow(Date.now());if(!intervalMs)return;const timer=setInterval(()=>setNow(Date.now()),intervalMs);return()=>clearInterval(timer);},[intervalMs]);
  return now;
}
