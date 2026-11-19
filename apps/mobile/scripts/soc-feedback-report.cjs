// SOC feedback report (development, 2026-11-19). Reads saved Expo/Metro output and summarizes the driver's SOC corrections
// per vehicle variant and energy model. Usage: node scripts/soc-feedback-report.cjs <metro-log.txt> [more logs…]
// Offline evidence only: it never changes the energy engine (that needs a version bump and approval, CLAUDE.md rule 4).
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const {summarizeJournal}=require('../src/features/navigation/soc-feedback.ts');

function parseRecords(text){
  const out=[];for(const line of text.split(/\r?\n/)){const at=line.indexOf('[dev] soc_correction ');if(at<0)continue;
    try{const r=JSON.parse(line.slice(line.indexOf('{',at)));
      // devLog rounds to 0.1, so the ratio is recomputed from the two drops.
      if(r.quality==='ok'&&r.modelDrop>0)r.ratio=r.observedDrop/r.modelDrop;out.push(r);}catch{}}
  return out;
}
const median=(xs)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
const fmt=(n,d=1)=>n===null||n===undefined?'—':Number(n).toFixed(d);
function report(records){
  const lines=['# SOC düzeltme raporu','',`Kayıt: ${records.length} · kullanılabilir (quality=ok): ${records.filter(r=>r.quality==='ok').length}`,'',
    '| Araç | Enerji modeli | Kayıt | Kullanılabilir | Ort. hata (puan) | Medyan oran (gerçek/tahmin düşüş) | km |','|---|---|---|---|---|---|---|'];
  for(const s of summarizeJournal(records))lines.push(`| ${s.vehicleLabel??s.vehicleVariantId.slice(0,12)} | ${s.energyModel??'—'} | ${s.records} | ${s.usable} | ${fmt(s.meanError)} | ${fmt(s.medianRatio,3)} | ${fmt(s.km)} |`);
  lines.push('','## Yol tipine göre (kullanılabilir kayıtlar)','','| Araç | Grup | n | Medyan oran | Ort. hız km/s |','|---|---|---|---|---|');
  const groups=new Map();
  for(const r of records.filter(r=>r.quality==='ok')){const g=(r.motorwayShare??0)>=.5?'otoyol ağırlıklı':'şehir/yol';
    const key=(r.vehicleLabel??r.vehicleVariantId.slice(0,12))+'\u0000'+g;groups.set(key,[...(groups.get(key)??[]),r]);}
  for(const [key,list] of groups){const [car,g]=key.split('\u0000');
    lines.push(`| ${car} | ${g} | ${list.length} | ${fmt(median(list.map(r=>r.ratio)),3)} | ${fmt(median(list.filter(r=>r.avgKph!==null).map(r=>r.avgKph)))} |`);}
  const skipped={};for(const r of records)if(r.quality!=='ok')skipped[r.quality]=(skipped[r.quality]??0)+1;
  lines.push('','Elenen kayıtlar: '+(Object.entries(skipped).map(([k,v])=>`${k} ${v}`).join(', ')||'yok'),'',
    'Oran > 1: araç modelden fazla tüketiyor; < 1: az. Az sayıda kayıtla motor değiştirilmez; bu rapor yalnız kanıttır.');
  return lines.join('\n');
}
module.exports={parseRecords,report};
if(require.main===module){
  const files=process.argv.slice(2);if(!files.length){console.error('Kullanım: node scripts/soc-feedback-report.cjs <metro-log.txt> […]');process.exit(2);}
  console.log(report(files.flatMap(f=>parseRecords(fs.readFileSync(f,'utf8')))));
}
