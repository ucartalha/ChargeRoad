import { EventEmitter } from 'node:events';
const https=require('node:https') as typeof import('node:https');
import { readEpdkCatalogue } from '../epdk-transport';
import { EpdkStationService } from '../epdk.service';
import { DatabaseService } from '../../database/database.service';

describe('EPDK GET body transport',()=>{
  afterEach(()=>jest.restoreAllMocks());
  it('uses the documented GET JSON body rather than incompatible Fetch semantics',async()=>{
    let sentBody:string|undefined,options:any;
    jest.spyOn(https,'request').mockImplementation(((_url:any,opts:any,callback:any)=>{
      options=opts;const req=new EventEmitter() as any;
      req.end=(body:string)=>{sentBody=body;queueMicrotask(()=>{
        const res=new EventEmitter() as any;res.statusCode=200;callback(res);
        res.emit('data',Buffer.from('{"statusCode":200}'));res.emit('end');
      });};return req;
    }) as any);
    expect((await readEpdkCatalogue()).toString('utf8')).toBe('{"statusCode":200}');
    expect(options.method).toBe('GET');expect(sentBody).toBe('{}');expect(options.headers['Content-Length']).toBe(2);
  });
  it('reports a source HTTP error without exposing its raw error body',async()=>{
    jest.spyOn(https,'request').mockImplementation(((_url:any,_opts:any,callback:any)=>{
      const req=new EventEmitter() as any;req.end=()=>queueMicrotask(()=>{
        const res=new EventEmitter() as any;res.statusCode=429;callback(res);
        res.emit('data',Buffer.from('private upstream diagnostics'));res.emit('end');
      });return req;
    }) as any);
    await expect(readEpdkCatalogue()).rejects.toThrow('EPDK source HTTP 429');
  });
  it('rejects unknown filters before any network call',()=>{
    const spy=jest.spyOn(https,'request');
    expect(()=>readEpdkCatalogue({unsupported:'value'})).toThrow('Unsupported');expect(spy).not.toHaveBeenCalled();
  });
  it('requires an explicit acquisition receipt instead of treating a file mtime as source freshness',async()=>{
    const service=new EpdkStationService({pool:{}} as DatabaseService);
    await expect(service.importSnapshot(Buffer.from('{}'),{
      endpoint:'https://apigateway.epdk.gov.tr/sarjIstasyonlari',retrievedAt:new Date().toISOString(),rawSha256:'0'.repeat(64),httpStatus:200,
    })).rejects.toThrow('receipt checksum');
  });
});
