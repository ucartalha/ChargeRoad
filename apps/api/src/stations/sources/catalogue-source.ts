import type { StationImportPackage } from '@chargeroad/shared';
import type { StationField,StationSourcePolicy } from './source-policy';
import { sourceOrder } from './source-policy';

export interface SourceHttpRequest {
  url:string;headers?:Record<string,string>;body?:string;requestClass:string;
  minIntervalMs:number;maxBytes:number;timeoutMs:number;
}
export interface SourceHttpResponse {bytes:Buffer;retrievedAt:string;}
export interface CatalogueAcquisition {package:StationImportPackage;rawBytes:Buffer;}
export interface CatalogueSourceContext {
  signal:AbortSignal;
  request(input:SourceHttpRequest):Promise<SourceHttpResponse>;
}
export interface StationCatalogueSource {
  readonly key:string;
  readonly countries:readonly string[];
  readonly fields:readonly StationField[];
  // General working condition is NOT a live occupancy feed.
  readonly liveAvailability:false;
  collect(countryCode:string,context:CatalogueSourceContext):Promise<CatalogueAcquisition>;
}

export class StationSourceRegistry {
  private readonly adapters=new Map<string,StationCatalogueSource>();
  constructor(adapters:StationCatalogueSource[],readonly policy:StationSourcePolicy){
    for(const adapter of adapters){
      if(this.adapters.has(adapter.key))throw new Error('Duplicate station provider: '+adapter.key);
      this.adapters.set(adapter.key,adapter);
    }
    for(const key of Object.keys(policy.providers))if(policy.providers[key].enabled&&!this.adapters.has(key))
      throw new Error('Enabled station provider has no registered adapter: '+key);
    for(const keys of Object.values(policy.fields))for(const key of keys??[])if(!this.adapters.has(key))
      throw new Error('Field policy references an unregistered adapter: '+key);
  }
  get(key:string,countryCode:string){
    const adapter=this.adapters.get(key);
    if(!adapter||!this.policy.providers[key]?.enabled)throw new Error('Station provider unavailable or disabled: '+key);
    if(!adapter.countries.includes(countryCode))throw new Error('Station provider country unsupported');
    return adapter;
  }
  // Pure acquisition plan. Never contacts providers, silently buys data, or runs on mobile reads.
  planMissingFields(countryCode:string,fields:StationField[]){
    return fields.map(field=>({field,providers:[...this.adapters.values()]
      .filter(a=>this.policy.providers[a.key]?.enabled&&a.countries.includes(countryCode)&&a.fields.includes(field))
      .sort((a,b)=>sourceOrder(this.policy,a.key,b.key,field)).map(a=>a.key)}));
  }
  describe(){return [...this.adapters.values()].map(a=>({key:a.key,countries:a.countries,fields:a.fields,
    liveAvailability:a.liveAvailability,...this.policy.providers[a.key]}));}
}
