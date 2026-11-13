import {chargingStationSchema,connectorClaimSchema} from '@chargeroad/shared';
import type {ChargingStation} from '@chargeroad/shared';
export function stationPin(id:string,payload:{station:unknown;connectorClaims?:unknown[]}){
  const station=chargingStationSchema.safeParse(payload.station);if(!station.success)return null;
  const claims=(payload.connectorClaims??[]).flatMap(raw=>{const parsed=connectorClaimSchema.safeParse(raw);return parsed.success?[parsed.data]:[];});
  return {id,coordinate:station.data.location,name:station.data.name,station:station.data,claims};
}
const labels:Record<string,string>={ccs2:'CCS2',ccs1:'CCS1',type2:'Type 2',type1:'Type 1',chademo:'CHAdeMO',nacs:'NACS',other:'Türü belirsiz'};
export function connectorLabel(c:{standard:string;powerType:string;maxPowerKw:number|null;quantity?:number|null}){
  return `${c.powerType==='unknown'?'AC/DC belirsiz':c.powerType.toUpperCase()} · ${labels[c.standard]??c.standard}${c.maxPowerKw?` · ${c.maxPowerKw} kW`:''}${c.quantity?` · ${c.quantity} adet`:''}`;
}
export function socketSummary(pin:{station:ChargingStation;claims:{powerType:string}[]}){
  const connectors=pin.station.evses.length?pin.station.evses.flatMap(e=>e.connectors):pin.claims;
  return [...new Set(connectors.map(c=>c.powerType==='unknown'?'Tür belirsiz':c.powerType.toUpperCase()))].join(' / ')||'Soket verisi yok';
}
