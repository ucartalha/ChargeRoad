// Piecewise-linear source values; extrapolation is deliberately forbidden.
export function interpolate<T>(points:T[],x:number,key:(p:T)=>number,value:(p:T)=>number):number {
  if(x<key(points[0])-1e-9||x>key(points.at(-1)!)+1e-9)throw new Error('INTERPOLATION_OUTSIDE_COVERAGE');
  x=Math.max(key(points[0]),Math.min(key(points.at(-1)!),x));
  let lo=0,hi=points.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(key(points[mid])<x)lo=mid+1;else hi=mid;}
  const i=lo;
  if(i===0)return value(points[0]);
  const a=points[i-1],b=points[i];return value(a)+(value(b)-value(a))*(x-key(a))/(key(b)-key(a));
}

// Within a source block each power cap is at most quadratic (linear current × voltage).
// Split at every pairwise crossing before quadrature, including narrow bottlenecks.
export function crossings(caps:(x:number)=>number[],lo:number,hi:number){
  const a=caps(lo),m=caps((lo+hi)/2),b=caps(hi),cuts=[lo,hi];
  for(let i=0;i<a.length;i++){
    const q=2*(b[i]+a[i]-2*m[i]),l=b[i]-a[i]-q,t=-l/(2*q);
    if(Number.isFinite(t)&&t>1e-10&&t<1-1e-10)cuts.push(lo+t*(hi-lo));
  }
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++){
    const c=a[i]-a[j],mid=m[i]-m[j],end=b[i]-b[j];
    const q=2*(end+c-2*mid),l=end-c-q;
    const roots:number[]=[];
    if(Math.abs(q)<1e-10){if(Math.abs(l)>1e-10)roots.push(-c/l);}
    else {const d=l*l-4*q*c;if(d>=0){const v=-.5*(l+(l>=0?1:-1)*Math.sqrt(d));
      if(v===0)roots.push(-l/(2*q));else roots.push(v/q,c/v);}}
    for(const t of roots)if(t>1e-10&&t<1-1e-10)cuts.push(lo+t*(hi-lo));
  }
  return [...new Set(cuts)].sort((x,y)=>x-y);
}

export type Ledger=[number,number,number,number]; // hours, inlet kWh, auxiliary kWh, loss kWh
const simpson=(a:number,b:number,fa:Ledger,fm:Ledger,fb:Ledger):Ledger=>fa.map((v,i)=>(b-a)*(v+4*fm[i]+fb[i])/6) as Ledger;
export async function integrateLedger(f:(x:number)=>Promise<Ledger>,a:number,b:number,tolerance:number,depth=18):Promise<Ledger>{
  const fa=await f(a),fm=await f((a+b)/2),fb=await f(b),whole=simpson(a,b,fa,fm,fb);
  async function step(lo:number,hi:number,left:Ledger,mid:Ledger,right:Ledger,estimate:Ledger,tol:number,remaining:number):Promise<Ledger>{
    const center=(lo+hi)/2,lm=await f((lo+center)/2),rm=await f((center+hi)/2);
    const l=simpson(lo,center,left,lm,mid),r=simpson(center,hi,mid,rm,right),sum=l.map((v,i)=>v+r[i]) as Ledger;
    if(sum.every((v,i)=>Math.abs(v-estimate[i])<=15*(tol+1e-9*Math.abs(v))))return sum.map((v,i)=>v+(v-estimate[i])/15) as Ledger;
    if(remaining===0)throw new Error('QUADRATURE_CONVERGENCE_LIMIT');
    const first=await step(lo,center,left,lm,mid,l,tol/2,remaining-1),second=await step(center,hi,mid,rm,right,r,tol/2,remaining-1);
    return first.map((v,i)=>v+second[i]) as Ledger;
  }
  return step(a,b,fa,fm,fb,whole,tolerance,depth);
}
