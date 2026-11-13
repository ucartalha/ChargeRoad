import type { Coordinate } from '@chargeroad/shared';
const rad=(x:number)=>x*Math.PI/180;
export function meters(a:Coordinate,b:Coordinate){const v=Math.sin(rad(b.latitude-a.latitude)/2)**2+
  Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
export function interpolate(a:Coordinate,b:Coordinate,f:number):Coordinate{return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+(b.longitude-a.longitude)*f};}
export function bearing(a:Coordinate,b:Coordinate){const d=rad(b.longitude-a.longitude),x=Math.sin(d)*Math.cos(rad(b.latitude)),
  y=Math.cos(rad(a.latitude))*Math.sin(rad(b.latitude))-Math.sin(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.cos(d);
  return (Math.atan2(x,y)*180/Math.PI+360)%360;}
export function decodePolyline6(text:string,maxPoints=20000):Coordinate[]{
  let index=0,lat=0,lon=0;const points:Coordinate[]=[];
  const next=()=>{let value=0,shift=0,b=0;do{
    if(index>=text.length||shift>30)throw new Error('Invalid road polyline');b=text.charCodeAt(index++)-63;
    if(b<0||b>63)throw new Error('Invalid road polyline');value+=(b&31)*2**shift;shift+=5;
  }while(b>=32);return value%2?-(value+1)/2:value/2;};
  while(index<text.length){lat+=next();lon+=next();
    if(Math.abs(lat)>90000000||Math.abs(lon)>180000000||points.length>=maxPoints)throw new Error('Road geometry exceeds budget');
    points.push({latitude:lat/1e6,longitude:lon/1e6});}
  if(points.length<2)throw new Error('Road polyline too short');return points;
}
export function cumulative(points:Coordinate[]){const result=[0];for(let i=1;i<points.length;i++)result.push(result[i-1]+meters(points[i-1],points[i]));return result;}

/** Display-only Douglas-Peucker simplification. Energy/road ledgers retain their original geometry. */
export function simplifyDisplayGeometry(points:Coordinate[],toleranceMeters=5):Coordinate[]{
  if(points.length<3)return points;const keep=new Set([0,points.length-1]),stack:[[number,number]]|[number,number][]=[[0,points.length-1]];
  while(stack.length){const [start,end]=stack.pop()!,a=points[start],b=points[end],factor=Math.cos(rad(a.latitude)),dx=(b.longitude-a.longitude)*factor,dy=b.latitude-a.latitude;
    let far=-1,max=toleranceMeters;for(let i=start+1;i<end;i++){const p=points[i],x=(p.longitude-a.longitude)*factor,y=p.latitude-a.latitude;
      const t=dx*dx+dy*dy?Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy))):0,d=Math.hypot(x-t*dx,y-t*dy)*111195;
      if(d>max){max=d;far=i;}}
    if(far>=0){keep.add(far);stack.push([start,far],[far,end]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
