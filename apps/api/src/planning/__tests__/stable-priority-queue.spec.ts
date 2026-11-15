import {StablePriorityQueue} from '../stable-priority-queue';
import {compareStates} from '../charge-stop-optimizer';
import type {OptimizerState} from '../optimizer-types';
import {frontierObjectives} from '../validation/frontier-scenarios';

describe('Bounded stable frontier heap',()=>{
 it.each([0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects invalid capacity %s',capacity=>{
  expect(()=>new StablePriorityQueue<number>((a,b)=>a-b,capacity)).toThrow(RangeError);
 });
 it('handles empty/single entry, re-use and a full queue without dropping or replacing entries',()=>{
  const q=new StablePriorityQueue<number>((a,b)=>a-b,2);expect(q.pop()).toBeUndefined();q.push(2);q.push(1);
  expect(()=>q.push(0)).toThrow(RangeError);expect(q.length).toBe(2);expect(q.pop()).toBe(1);expect(q.pop()).toBe(2);
  expect(q.length).toBe(0);expect(q.pop()).toBeUndefined();q.push(4);expect(q.pop()).toBe(4);
 });
 it('preserves FIFO for ties even when higher priorities arrive and entries are interleaved',()=>{
  const q=new StablePriorityQueue<{priority:number;id:string}>((a,b)=>a.priority-b.priority,8);
  q.push({priority:1,id:'a'});q.push({priority:1,id:'b'});q.push({priority:0,id:'urgent'});
  expect(q.pop()?.id).toBe('urgent');q.push({priority:1,id:'c'});
  expect([q.pop()?.id,q.pop()?.id,q.pop()?.id]).toEqual(['a','b','c']);
 });
 it('matches stable sort treating NaN comparison as equality',()=>{
  const q=new StablePriorityQueue<number>(()=>NaN,3);[3,1,2].forEach(v=>q.push(v));expect([q.pop(),q.pop(),q.pop()]).toEqual([3,1,2]);
 });
 it.each(frontierObjectives)('preserves compareStates and every pop under seeded mixed operations: %s',objective=>{
  for(const seed of [1,42,20261113]){
   let random=seed;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
   const compare=(a:OptimizerState,b:OptimizerState)=>compareStates(a,b,objective),q=new StablePriorityQueue(compare,256),old:OptimizerState[]=[];
   for(let i=0;i<6000;i++){
    if(old.length===0||old.length<256&&next()%3!==0){
     const state={seconds:next()%5,distance:next()%3,netKwh:(next()%7)-3+(next()%5)*1e-9,stops:Array(next()%3).fill(null),visited:['origin',String(next()%4)]} as OptimizerState;
     const before=JSON.stringify(state);q.push(state);old.push(state);expect(JSON.stringify(state)).toBe(before);
    }else{old.sort(compare);expect(q.pop()).toBe(old.shift());}
    expect(q.length).toBe(old.length);
   }
   old.sort(compare);for(const state of old)expect(q.pop()).toBe(state);expect(q.pop()).toBeUndefined();
  }
 });
 it('bounds comparison work for descending insertion and drain rather than sorting on each pop',()=>{
  let calls=0;const n=4096,q=new StablePriorityQueue<number>((a,b)=>{calls++;return a-b;},n);
  for(let i=n;i>0;i--)q.push(i);for(let i=1;i<=n;i++)expect(q.pop()).toBe(i);
  expect(calls).toBeLessThan(n*Math.ceil(Math.log2(n))*4);
 });
});
