// Independent exhaustive reference for the explicitly scaled analytical graph only.
// No production search, energy engine, charging integrator, station filter or ranking helper is called.
export function analyticalStopReference(objective:'minimum_total_duration'|'minimum_energy'|'minimum_charging_stops',step=10){
  const position:Record<string,number>={origin:0,a:.5,b:1.25,destination:2},capacity=4,rate=2,reserve=10,arrival=20;
  type Answer={seconds:number;netKwh:number;stops:{node:string;target:number}[]};let best:Answer|null=null;let evaluated=0;
  const chargeSeconds=(from:number,to:number)=>{let seconds=0;
    if(from<80){const end=Math.min(80,to);seconds+=(end-from)*capacity/100/100*3600;from=end;}
    if(to>from){const p=(soc:number)=>100-4.75*(soc-80);seconds+=capacity/100/4.75*Math.log(p(from)/p(to))*3600;}return seconds;};
  const key=(a:Answer)=>objective==='minimum_charging_stops'?[a.stops.length,a.seconds]:objective==='minimum_energy'?[a.netKwh,a.seconds,a.stops.length]:[a.seconds,a.stops.length];
  const better=(a:Answer,b:Answer)=>{const x=key(a),y=key(b);for(let i=0;i<x.length;i++){if(Math.abs(x[i]-y[i])>1e-8)return x[i]<y[i];}return false;};
  function visit(node:string,soc:number,visited:string[],answer:Answer){
    const remaining=Object.keys(position).filter(n=>!visited.includes(n));
    const targets=new Set([soc]);if(node!=='origin'){
      for(let s=step;s<=100;s+=step)targets.add(s);targets.add(80);targets.add(100);
      for(const next of remaining){const drop=Math.abs(position[next]-position[node])*rate/capacity*100;targets.add(drop+(next==='destination'?arrival:reserve));}
    }
    for(const target of targets){if(target<soc-1e-8||target>100)continue;
      const stops=target>soc+1e-8?[...answer.stops,{node,target}]:answer.stops,seconds=answer.seconds+(target>soc?chargeSeconds(soc,target):0);
      for(const next of remaining){evaluated++;const distance=Math.abs(position[next]-position[node]),energy=distance*rate,end=target-energy/capacity*100;
        if(end<reserve-1e-8||next==='destination'&&end<arrival-1e-8)continue;
        const result={stops,seconds:seconds+distance*60,netKwh:answer.netKwh+energy};
        if(next==='destination'){if(!best||better(result,best))best=result;}
        else visit(next,end,[...visited,next],result);
      }
    }
  }
  visit('origin',40,['origin'],{seconds:0,netKwh:0,stops:[]});return {answer:best as Answer|null,evaluated};
}
