import { DatabaseService } from '../database/database.service';
import { normalizeEpdk } from './epdk-normalizer';
import { StationImportRepository } from './station-import.repository';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createStationSourceService } from './sources/create-source-service';

export const epdkReceiptSchema=z.object({endpoint:z.literal('https://apigateway.epdk.gov.tr/sarjIstasyonlari'),
  retrievedAt:z.iso.datetime(),rawSha256:z.string().regex(/^[a-f0-9]{64}$/),httpStatus:z.literal(200)}).strict();

export class EpdkStationService {
  constructor(private readonly database:DatabaseService){}
  async sync(filters:Record<string,string>={},signal?:AbortSignal){
    if(Object.keys(filters).length)throw new Error('Filtered EPDK publication requires explicit delta merge semantics; disabled');
    return createStationSourceService(this.database).sync('epdk-stations','TR',signal);
  }
  async importSnapshot(bytes:Buffer,rawReceipt:unknown){
    const receipt=epdkReceiptSchema.parse(rawReceipt),retrievedAt=receipt.retrievedAt;
    if(createHash('sha256').update(bytes).digest('hex')!==receipt.rawSha256)throw new Error('EPDK receipt checksum mismatch');
    if(Date.parse(retrievedAt)>Date.now()+300000)throw new Error('EPDK receipt cannot claim a future fetch');
    const normalized=normalizeEpdk(bytes,retrievedAt);
    const result=await new StationImportRepository(this.database).publish(normalized,bytes);
    await this.database.pool.query(`INSERT INTO station_source_fetch_gates(source_key,request_class,next_allowed_at)
      VALUES('epdk-stations','national',$1::timestamptz+interval '1 hour') ON CONFLICT(source_key,request_class)
      DO UPDATE SET next_allowed_at=GREATEST(station_source_fetch_gates.next_allowed_at,EXCLUDED.next_allowed_at)`,[retrievedAt]);
    return result;
  }
}
