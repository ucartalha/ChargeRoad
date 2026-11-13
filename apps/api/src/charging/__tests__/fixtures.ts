import type {ChargingEvaluationRequest} from '@chargeroad/shared';
import {fixture,source} from '../../planning/__tests__/fixtures';
export function chargingFixture():ChargingEvaluationRequest{
  const {vehicle,request}=fixture(),at=request.departureAt,s=source('synthetic-charging');
  vehicle.chargingModel={id:'synthetic-charge-model',version:'1',vehicleVariantId:vehicle.vehicleVariantId,quality:'engineering_estimate',source:s,
    verificationNote:'Analytical test calibration only; no Hyundai performance claim',assumptions:['synthetic_test_only'],terminalToStoredEfficiency:1,auxiliaryPackKw:0};
  vehicle.dataQuality={schemaVersion:'vehicle-quality/1.0.0',policy:'allow_engineering_estimates',quality:'engineering_estimate',verificationNote:'Synthetic test',assumptions:[],methodId:'test',methodVersion:'1'};
  vehicle.dcChargingPaths=[{id:'native',mode:'native_pack',inletVoltageRangeV:{min:200,max:1000},inletVoltageBySoc:null,maxInletPowerKw:200,maxInletCurrentA:500,conversionEfficiency:1,source:s}];
  vehicle.dcChargingCurves=[{id:'curve',version:'1',vehicleVariantId:vehicle.vehicleVariantId,chargingPathId:'native',semantics:'vehicle_acceptance_limit',powerBoundary:'vehicle_inlet',
    curve:{representation:'power_by_soc',points:[{socPercent:0,powerKw:100,voltageV:400,batteryTemperatureC:null},{socPercent:100,powerKw:100,voltageV:400,batteryTemperatureC:null}]},
    interpolation:'linear',extrapolation:'forbidden',conditions:{batteryTemperatureC:{min:20,max:40},ambientTemperatureC:null,stateOfHealthPercent:{min:80,max:100},
      preconditioning:'unknown',evseMaxPowerKw:null,evseMaxCurrentA:null,evseVoltageRangeV:null,thermalAuxiliariesIncluded:'excluded',conversionLossesIncluded:'excluded'},source:s}];
  return {vehicle,station:{id:'station',name:'Synthetic station',location:request.origin,operatorId:null,source:s,
    sharedPowerPools:[],access:{publicAccess:true,membershipRequired:false,openingHours:null},
    evses:[{id:'evse',availability:{reportedStatus:'unknown',sourceObservedAt:null,receivedAt:at,source:s},sharedPowerPoolId:null,
      connectors:[{id:'connector',powerType:'dc',standard:'ccs2',maxPowerKw:200,maxCurrentA:500,outputVoltageRangeV:{min:200,max:1000},powerEnvelope:[],source:s}]}]},
    capacity:{vehicleProfileId:vehicle.id,vehicleProfileVersion:vehicle.version,vehicleVariantId:vehicle.vehicleVariantId,
      referenceUsableKwh:80,referenceSohPercent:100,sohPercent:100,temperatureFactor:1,temperatureAtAssessmentC:30,
      temperatureModelId:null,temperatureModelVersion:null,effectiveKwh:80,assumptions:[]},evseId:'evse',connectorId:'connector',curveId:'curve',
    arrivalSocPercent:20,targetSocPercent:80,qualityPolicy:'allow_engineering_estimates',evaluatedAt:at,
    batteryTemperatureAtStartC:{origin:'user_input',value:30,observedAt:at},ambientTemperatureC:20,preconditioning:'unknown',sharedPowerAllocation:null,
    timing:{arrivalAt:at,connectionSeconds:60,waitingSeconds:0,blockingPreconditioningSeconds:0}};
}
