import { normalizeEpdk } from '../epdk-normalizer';
import type { CatalogueSourceContext,StationCatalogueSource } from './catalogue-source';

export class EpdkCatalogueSource implements StationCatalogueSource {
  readonly key='epdk-stations';readonly countries=['TR'];readonly liveAvailability=false as const;
  readonly fields=['station','access.publicAccess','connectorClaims'] as const;
  async collect(countryCode:string,context:CatalogueSourceContext){
    if(countryCode!=='TR')throw new Error('EPDK country unsupported');
    const response=await context.request({url:'https://apigateway.epdk.gov.tr/sarjIstasyonlari',body:'{}',
      requestClass:'national',minIntervalMs:3600000,maxBytes:64*1024*1024,timeoutMs:45000});
    return {rawBytes:response.bytes,package:normalizeEpdk(response.bytes,response.retrievedAt)};
  }
}
