interface Entry<T> {value:T;sequence:number;}

/** Bounded min-heap. Equal priorities leave in insertion order; entries are never evicted.
 * Priorities must remain immutable while queued (as with the optimizer's frontier states).
 */
export class StablePriorityQueue<T> {
 private readonly entries:Entry<T>[]=[];
 private sequence=0;
 constructor(private readonly compare:(a:T,b:T)=>number,private readonly capacity:number){
  if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid queue capacity');
 }
 get length(){return this.entries.length;}
 push(value:T):void{
  if(this.length>=this.capacity)throw new RangeError('Queue capacity exceeded');
  const entry={value,sequence:this.sequence++};let index=this.length;this.entries.push(entry);
  while(index>0){const parent=Math.floor((index-1)/2);if(this.order(entry,this.entries[parent])>=0)break;
   this.entries[index]=this.entries[parent];index=parent;}
  this.entries[index]=entry;
 }
 pop():T|undefined{
  if(!this.length)return undefined;
  const first=this.entries[0],last=this.entries.pop()!;
  if(this.length){let index=0;
   while(index*2+1<this.length){const left=index*2+1,right=left+1;
    const child=right<this.length&&this.order(this.entries[right],this.entries[left])<0?right:left;
    if(this.order(last,this.entries[child])<=0)break;
    this.entries[index]=this.entries[child];index=child;
   }
   this.entries[index]=last;
  }
  return first.value;
 }
 private order(a:Entry<T>,b:Entry<T>){return this.compare(a.value,b.value)||a.sequence-b.sequence;}
}
