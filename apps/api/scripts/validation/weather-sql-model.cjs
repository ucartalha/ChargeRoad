/** Reuses immutable LAT-002 JS SQL model. NOT PostgreSQL lock/integration proof. */
const fs=require('fs'),path=require('path'),{setTimeout:delay}=require('timers/promises');
module.exports=function(RealDate){
 const text=fs.readFileSync(path.join(__dirname,'../diagnose-weather-acquisition.cjs'),'utf8');
 let model=text.slice(text.indexOf('class SqlFixture {'),text.indexOf('function observed('));
 if(!model.startsWith('class SqlFixture {'))throw Error('MODEL_SEAM_CHANGED');
 model=model.replace('paced:s.next>RealDate.now()','paced:s.next>RealDate.now(),pace_wait_ms:Math.max(0,s.next-RealDate.now())');
 model=model.replace('leased:!!r.token&&r.lease>now','leased:!!r.token&&r.lease>now,lease_wait_ms:Math.max(0,r.lease-now)');
 return new Function('delay','RealDate',model+';return SqlFixture;')(delay,RealDate);
};
