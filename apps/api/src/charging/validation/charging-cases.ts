import {chargingFixture} from '../__tests__/fixtures';
export function analyticalChargingCases(){
  const constant=chargingFixture(),taper=chargingFixture(),lossy=chargingFixture(),limited=chargingFixture();
  taper.vehicle.dcChargingCurves[0].curve={representation:'power_by_soc',points:[{socPercent:20,powerKw:100,voltageV:400,batteryTemperatureC:null},{socPercent:80,powerKw:50,voltageV:400,batteryTemperatureC:null}]};
  lossy.vehicle.dcChargingPaths[0].conversionEfficiency=.9;lossy.vehicle.chargingModel!.terminalToStoredEfficiency=.95;lossy.vehicle.chargingModel!.auxiliaryPackKw=2;
  const dc=limited.station.evses[0].connectors[0];if(dc.powerType==='dc')dc.maxCurrentA=100;
  return [{id:'constant_100kw',input:constant,expectedSeconds:1728},{id:'linear_taper_100_to_50',input:taper,expectedSeconds:.96*Math.log(2)*3600},
    {id:'converter_storage_auxiliary',input:lossy,expectedSeconds:48/((100*.9-2)*.95)*3600},{id:'current_limited_40kw',input:limited,expectedSeconds:4320}];
}
export function detailedChargingCase(){
  const input=chargingFixture();input.arrivalSocPercent=5;input.targetSocPercent=95;
  input.vehicle.dcChargingCurves[0].curve={representation:'power_by_soc',points:Array.from({length:101},(_,soc)=>({socPercent:soc,powerKw:150-soc,voltageV:350+soc*3,batteryTemperatureC:null}))};
  input.vehicle.chargingModel!.auxiliaryPackKw=2;input.vehicle.chargingModel!.terminalToStoredEfficiency=.96;
  input.vehicle.dcChargingPaths[0].conversionEfficiency=.95;
  const dc=input.station.evses[0].connectors[0];if(dc.powerType==='dc'){
    dc.maxCurrentA=200;dc.powerEnvelopeInterpolation='linear';dc.powerEnvelope=[{voltageV:300,maxCurrentA:180,maxPowerKw:130},{voltageV:500,maxCurrentA:160,maxPowerKw:120},{voltageV:700,maxCurrentA:150,maxPowerKw:110}];}
  return input;
}
