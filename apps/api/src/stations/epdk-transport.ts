import { request } from 'node:https';

// The official EPDK contract uses GET with a JSON body; Fetch rejects that shape.
export function readEpdkCatalogue(filters:Record<string,string>={},caller?:AbortSignal):Promise<Buffer>{
  const permitted=new Set(['lisansNo','sarjIstasyonuNo','markaAdi','yesilSarjIstasyonuMu','sarjIstasyonuAdi','hizmetSekli']);
  if(Object.keys(filters).some(k=>!permitted.has(k)))throw new Error('Unsupported EPDK filter');
  const body=JSON.stringify(filters);
  const signal=caller?AbortSignal.any([caller,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);
  return new Promise((resolve,reject)=>{
    const req=request('https://apigateway.epdk.gov.tr/sarjIstasyonlari',{method:'GET',signal,
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'ChargeRoad-station-import'}},res=>{
      const chunks:Buffer[]=[];let length=0;
      res.on('data',(chunk:Buffer)=>{
        length+=chunk.length;
        if(length>64*1024*1024){res.destroy(new Error('EPDK response exceeds 64 MiB'));return;}
        chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>{
        if(res.statusCode!==200){reject(new Error('EPDK source HTTP '+res.statusCode));return;}
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error',reject);req.end(body);
  });
}
