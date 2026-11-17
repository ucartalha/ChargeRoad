import {seedFallbackCandidates} from '../charge-stop-optimizer';

// When every range-hint seed attempt depletes the battery, the failed legs show how far the car really got.
// The fallback then tries untried stations inside that observed reach, farthest first (ordering only, never a certificate).
const candidate=(id:string)=>({station:{id}}) as never;
const progress:Record<string,number>={a:.30,b:.42,c:.55,d:.61,e:.70,f:.74,g:.80};
const progressOf=(c:{station:{id:string}})=>progress[c.station.id];

describe('Seed fallback candidates',()=>{
  const ranked=['f','g','e','d','c','b','a'].map(candidate);
  it('returns untried stations within the observed reach, farthest first, bounded by the attempt limit',()=>{
    const out=seedFallbackCandidates(ranked,new Set(['f','g','e']),.65,progressOf,3);
    expect(out.map(progressOf)).toEqual([.61,.55,.42]);
  });
  it('never retries a primary attempt or a station beyond the observed reach',()=>{
    const out=seedFallbackCandidates(ranked,new Set(['d']),.62,progressOf,10);
    expect(out.map(c=>(c as {station:{id:string}}).station.id)).toEqual(['c','b','a']);
  });
  it('does nothing when no reach was observed',()=>{
    expect(seedFallbackCandidates(ranked,new Set(),Number.NEGATIVE_INFINITY,progressOf,3)).toEqual([]);
  });
  it('breaks progress ties deterministically by station id',()=>{
    const tied=[candidate('y'),candidate('x')],p=()=>.5;
    expect(seedFallbackCandidates(tied,new Set(),.6,p,3).map(c=>(c as {station:{id:string}}).station.id)).toEqual(['x','y']);
  });
});
