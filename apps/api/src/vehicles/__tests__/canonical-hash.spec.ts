import {createHash} from 'node:crypto';
import {canonicalJson,canonicalJsonSha256} from '../knowledge/knowledge-package';

// The streaming digest must be byte-identical to hashing the materialised canonical string.
const reference=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');

function seeded(seed:number){return ()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};}
function randomValue(next:()=>number,depth:number):unknown{
  const r=next();
  if(depth>4||r<.35){const pick=Math.floor(next()*9);
    return [null,true,false,0,-0,next()*1e6-5e5,'s'+Math.floor(next()*1000),'ünicode ğüşıöç 🚗 "\\',Number.NaN][pick];}
  if(r<.65)return Array.from({length:Math.floor(next()*6)},()=>randomValue(next,depth+1));
  const out:Record<string,unknown>={};for(let i=Math.floor(next()*6);i>0;i--)out['k'+Math.floor(next()*20)+(next()<.2?'ğ':'')]=randomValue(next,depth+1);return out;
}

describe('canonicalJsonSha256',()=>{
  it('matches sha256(canonicalJson) for ordering, unicode and JSON edge values',()=>{
    const cases:unknown[]=[
      {z:[{b:1,a:2}],a:1},{a:1,z:[{a:2,b:1}]},[],{},'text',0,-0,1e21,1e-7,Number.NaN,Number.POSITIVE_INFINITY,null,true,
      {emoji:'🚗🔋',surrogateAtEnd:'x🚗',lone:'\ud83d',lineSep:'  ',quote:'"\\/'},
      {date:new Date(0),nested:{deep:{deeper:[1,[2,[3,{k:'v'}]]]}}},
      {undefinedProp:undefined,fn:()=>1,symbol:Symbol('s'),kept:1},
      [undefined,1,undefined,()=>2,null],
      // eslint-disable-next-line no-sparse-arrays
      [1,,3],
    ];
    for(const value of cases)expect(canonicalJsonSha256(value)).toBe(reference(value));
  });
  it('matches for long strings and wide structures that cross internal chunk boundaries',()=>{
    const long='ğ🚗'.repeat(70000),wide=Array.from({length:30000},(_,i)=>({id:'segment-'+i,v:i/7,label:i%3?'ı':'🚗'}));
    expect(canonicalJsonSha256({long,wide})).toBe(reference({long,wide}));
    expect(canonicalJsonSha256(wide)).toBe(reference(wide));
  });
  it('matches for deterministic random structures',()=>{
    const next=seeded(20261117);
    for(let i=0;i<500;i++){const value=randomValue(next,0);expect(canonicalJsonSha256(value)).toBe(reference(value));}
  });
  it('fails like the materialised path for values JSON cannot encode',()=>{
    expect(()=>reference({big:1n})).toThrow(TypeError);expect(()=>canonicalJsonSha256({big:1n})).toThrow(TypeError);
  });
});
