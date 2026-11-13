import {createHash} from 'node:crypto';
import {setImmediate as yieldThread} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {chargingEvaluationRequestSchema,chargingEvaluationResultSchema} from '@chargeroad/shared';
import type {ChargingEvaluationRequest,ChargingEvaluationResult,StationConnector} from '@chargeroad/shared';
import {canonicalJson} from '../vehicles/knowledge/knowledge-package';
import {capacityFactor} from '../energy/energy-physics';
import {EnergyDataMissing} from '../energy/energy-policy';
import {crossings,integrateLedger,interpolate} from './charging-math';

export const CHARGING_ALGORITHM_VERSION='dc-curve-integration/1.2.0';
class ChargingFailure extends Error {
  constructor(readonly status:ChargingEvaluationResult['status'],code:string){super(code);}
}
const missing=(code:string):never=>{throw new ChargingFailure('insufficient_data',code);};
const incompatible=(code:string):never=>{throw new ChargingFailure('incompatible',code);};
const within=(v:number,range:{min:number;max:number})=>v>=range.min-1e-8&&v<=range.max+1e-8;

/** Pure DC calculator. It consumes snapshots, never contacts a provider or starts charging. */
export class ChargingCurveEngine {
  async evaluate(raw:ChargingEvaluationRequest,signal:AbortSignal=new AbortController().signal):Promise<ChargingEvaluationResult>{
    signal.throwIfAborted();const started=performance.now(),r=chargingEvaluationRequestSchema.parse(raw),v=r.vehicle,model=v.chargingModel;
    const out:ChargingEvaluationResult={status:'insufficient_data',dataQuality:
      model?.quality==='engineering_estimate'||v.dataQuality?.quality==='engineering_estimate'?'engineering_estimate':
      model?.quality==='verified'&&v.dataQuality?.quality==='verified'?'verified':'unknown',algorithmVersion:CHARGING_ALGORITHM_VERSION,
      inputChecksumSha256:createHash('sha256').update(canonicalJson(r)).digest('hex'),vehicleProfileId:v.id,vehicleProfileVersion:v.version,
      modelId:model?.id??null,modelVersion:model?.version??null,stationId:r.station.id,evseId:r.evseId,connectorId:r.connectorId,
      curveId:r.curveId,curveVersion:null,chargingPathId:null,arrivalSocPercent:r.arrivalSocPercent,targetSocPercent:r.targetSocPercent,
      effectiveBatteryCapacityKwh:r.capacity.effectiveKwh,chargingSeconds:null,energyStoredKwh:null,energyDeliveredAtInletKwh:null,
      auxiliaryEnergyKwh:null,conversionLossKwh:null,totalStopSeconds:null,departureAt:null,
      batteryTemperatureAtDepartureC:{origin:'unknown',value:null},intervals:[],evaluations:0,assumptions:[],warnings:[],reasons:[]};
    const check=async()=>{signal.throwIfAborted();if(++out.evaluations>100000||performance.now()-started>1500)
      throw new ChargingFailure('computation_limit','CHARGING_COMPUTATION_LIMIT');
      if(out.evaluations%128===0)await yieldThread();signal.throwIfAborted();};
    try {
      const c=r.capacity;
      if(c.vehicleProfileId!==v.id||c.vehicleProfileVersion!==v.version||c.vehicleVariantId!==v.vehicleVariantId||
        c.referenceUsableKwh!==v.capacity.referenceUsableBatteryKwh||c.referenceSohPercent!==v.capacity.atStateOfHealthPercent)missing('CAPACITY_SNAPSHOT_PROFILE_MISMATCH');
      const factor=v.energyModel?capacityFactor(v.energyModel,c.temperatureAtAssessmentC,new Set()):1;
      if(v.energyModel?.capacityTemperatureCurve&&!v.energyModel.source.license)missing('CAPACITY_MODEL_SOURCE_PERMISSION_MISSING');
      if(Math.abs(c.temperatureFactor-factor)>1e-9||c.temperatureModelId!==(v.energyModel?.capacityTemperatureCurve?v.energyModel.id:null)||
        c.temperatureModelVersion!==(v.energyModel?.capacityTemperatureCurve?v.energyModel.version:null))missing('CAPACITY_SNAPSHOT_MODEL_MISMATCH');
      if(r.arrivalSocPercent===r.targetSocPercent){out.status='no_charge_required';out.chargingSeconds=out.energyStoredKwh=out.energyDeliveredAtInletKwh=out.auxiliaryEnergyKwh=out.conversionLossKwh=0;
        out.totalStopSeconds=0;out.departureAt=r.timing.arrivalAt;return chargingEvaluationResultSchema.parse(out);}
      if(!model)missing('CHARGING_LOSS_AND_AUXILIARY_MODEL_MISSING');
      if(r.qualityPolicy==='verified_only'&&(model!.quality==='engineering_estimate'||v.dataQuality?.quality==='engineering_estimate'))missing('ENGINEERING_ESTIMATE_NOT_ALLOWED');
      if(r.qualityPolicy==='verified_only'&&out.dataQuality!=='verified')missing('PROFILE_VERIFICATION_MISSING');
      const curve=v.dcChargingCurves.find(x=>x.id===r.curveId);if(!curve)missing('DC_CHARGING_CURVE_MISSING');
      out.curveVersion=curve!.version;out.chargingPathId=curve!.chargingPathId;
      const path=v.dcChargingPaths.find(x=>x.id===curve!.chargingPathId)!;
      const evse=r.station.evses.find(x=>x.id===r.evseId);if(!evse)missing('PHYSICAL_EVSE_MISSING');
      const catalogueScenario=evse!.identityBasis==='catalogue_scenario';
      if(catalogueScenario&&r.hardwarePolicy!=='catalogue_power_scenario')missing('CATALOGUE_HARDWARE_SCENARIO_NOT_ALLOWED');
      const connector=evse!.connectors.find(x=>x.id===r.connectorId);if(!connector)missing('CONNECTOR_MISSING');
      if(connector!.powerType!=='dc')incompatible('AC_REQUIRES_SEPARATE_CHARGING_MODEL');
      const dc=connector as Extract<StationConnector,{powerType:'dc'}>;
      if(!v.supportedConnectors.includes(dc.standard))incompatible('CONNECTOR_STANDARD_MISMATCH');
      if(curve!.semantics!=='vehicle_acceptance_limit')missing('VEHICLE_ACCEPTANCE_CURVE_REQUIRED');
      for(const source of [v.capacity.source,model!.source,curve!.source,path.source])if(!source.license)missing('CHARGING_SOURCE_PERMISSION_MISSING');
      if(!dc.source.license&&!(dc.permissionBasis==='public_service'&&dc.source.sourceId==='epdk-stations'))missing('CHARGING_SOURCE_PERMISSION_MISSING');
      const points:{socPercent:number;voltageV:number|null}[]=curve!.curve.points;
      if(points.length>2048||dc.powerEnvelope.length>2048||(path.inletVoltageBySoc?.points.length??0)>2048)
        throw new ChargingFailure('computation_limit','CHARGING_SOURCE_POINT_LIMIT');
      if(r.arrivalSocPercent<points[0].socPercent||r.targetSocPercent>points.at(-1)!.socPercent)missing('CHARGING_SOC_OUTSIDE_CURVE');
      const expectedEffect=curve!.powerBoundary==='vehicle_inlet'?'excluded':'included';
      if(curve!.conditions.thermalAuxiliariesIncluded!==expectedEffect||curve!.conditions.conversionLossesIncluded!==expectedEffect)
        missing('CHARGING_ENERGY_BOUNDARY_AMBIGUOUS');
      const temp=r.batteryTemperatureAtStartC,condition=curve!.conditions;
      if(temp.value===null||!condition.batteryTemperatureC)missing('BATTERY_TEMPERATURE_CONDITION_MISSING');
      const now=Date.parse(r.evaluatedAt),chargeAt=r.timing.arrivalAt!==null?
        Date.parse(r.timing.arrivalAt)+(r.timing.connectionSeconds+(r.timing.waitingSeconds??0))*1000:now;
      if(temp.origin==='estimated'){
        if(Date.parse(temp.estimatedAt)>now||temp.validAt===null||Math.abs(Date.parse(temp.validAt)-chargeAt)>900000)missing('CHARGE_START_TEMPERATURE_NOT_VALID');
      }else if(temp.origin!=='unknown'&&(Date.parse(temp.observedAt)>now||Math.abs(Date.parse(temp.observedAt)-chargeAt)>900000))missing('CHARGE_START_TEMPERATURE_NOT_VALID');
      if(!within(temp.value!,condition.batteryTemperatureC!))missing('BATTERY_TEMPERATURE_OUTSIDE_CURVE');
      if(curve!.curve.points.some(p=>p.batteryTemperatureC!==null&&!within(p.batteryTemperatureC,condition.batteryTemperatureC!)))missing('CURVE_TEMPERATURE_METADATA_INCONSISTENT');
      if(condition.ambientTemperatureC&&(r.ambientTemperatureC===null||!within(r.ambientTemperatureC,condition.ambientTemperatureC)))missing('AMBIENT_TEMPERATURE_OUTSIDE_CURVE');
      if(condition.stateOfHealthPercent&&!within(c.sohPercent,condition.stateOfHealthPercent))missing('SOH_OUTSIDE_CURVE');
      if(condition.preconditioning!=='unknown'&&condition.preconditioning!==r.preconditioning)missing('PRECONDITIONING_CONDITION_MISMATCH');
      if(dc.maxPowerKw===null||!catalogueScenario&&(dc.maxCurrentA===null||dc.outputVoltageRangeV===null)||path.maxInletPowerKw===null||path.maxInletCurrentA===null||path.inletVoltageRangeV===null||path.conversionEfficiency===null)
        missing('DC_HARDWARE_LIMITS_MISSING');
      if(catalogueScenario){out.dataQuality='engineering_estimate';out.warnings.push('Catalogue power scenario: selected voltage path, sustained power and EVSE grouping are unverified; charging time is conditional, not a guarantee.');}
      const efficiency=path.conversionEfficiency!,storage=model!.terminalToStoredEfficiency,aux=model!.auxiliaryPackKw;
      const useCurveVoltage=curve!.powerBoundary==='vehicle_inlet'&&points.every(p=>p.voltageV!==null);
      const voltageProfile=path.inletVoltageBySoc;
      if(!useCurveVoltage){
        if(!voltageProfile)missing('INLET_VOLTAGE_PROFILE_MISSING');
        if(!voltageProfile!.source.license)missing('INLET_VOLTAGE_SOURCE_PERMISSION_MISSING');
        if(voltageProfile!.batteryTemperatureC&&!within(temp.value!,voltageProfile!.batteryTemperatureC))missing('INLET_VOLTAGE_TEMPERATURE_OUTSIDE_CALIBRATION');
        if(r.arrivalSocPercent<voltageProfile!.points[0].socPercent||r.targetSocPercent>voltageProfile!.points.at(-1)!.socPercent)missing('INLET_VOLTAGE_SOC_OUTSIDE_COVERAGE');
      }
      const voltage=(soc:number)=>useCurveVoltage?interpolate(points,soc,p=>p.socPercent,p=>p.voltageV!):interpolate(voltageProfile!.points,soc,p=>p.socPercent,p=>p.voltageV);
      let poolCap:number|null=null;
      if(evse!.sharedPowerPoolId){const allocation=r.sharedPowerAllocation,pool=r.station.sharedPowerPools.find(p=>p.id===evse!.sharedPowerPoolId)!;
        if(!allocation||allocation.poolId!==pool.id)missing('SHARED_POWER_ALLOCATION_MISSING');
        const age=(now-Date.parse(allocation!.observedAt))/1000;if(age<0||age>300)missing('SHARED_POWER_ALLOCATION_STALE');
        if(pool.ratedTotalPowerKw!==null&&allocation!.powerKw>pool.ratedTotalPowerKw)missing('SHARED_POWER_ALLOCATION_EXCEEDS_RATING');
        const available=pool.availablePowerKw;
        if(available.value!==null){const at=available.origin==='estimated'?available.estimatedAt:available.observedAt;
          if(at!==null&&now-Date.parse(at)>=0&&now-Date.parse(at)<=300000&&allocation!.powerKw>available.value)missing('SHARED_POWER_ALLOCATION_EXCEEDS_AVAILABLE');}
        poolCap=allocation!.powerKw;out.warnings.push('Shared-power allocation is a planning snapshot; future allocation is not guaranteed.');
      }else if(r.sharedPowerAllocation)missing('UNEXPECTED_SHARED_POWER_ALLOCATION');
      const envelope=dc.powerEnvelope;
      if(envelope.length&&(dc.powerEnvelopeInterpolation!=='linear'||envelope.length<2||envelope.some((p,i)=>i>0&&p.voltageV<=envelope[i-1].voltageV)))missing('POWER_ENVELOPE_INTERPOLATION_UNDEFINED');
      const knots=[r.arrivalSocPercent,r.targetSocPercent,...points.map(p=>p.socPercent),...(useCurveVoltage?[]:voltageProfile!.points.map(p=>p.socPercent))]
        .filter(x=>x>=r.arrivalSocPercent&&x<=r.targetSocPercent).sort((a,b)=>a-b);
      let cuts=[...new Set(knots)];
      for(let i=0;i<cuts.length-1;i++){await check();for(const e of envelope){const va=voltage(cuts[i]),vb=voltage(cuts[i+1]);
        if(e.voltageV>Math.min(va,vb)&&e.voltageV<Math.max(va,vb))knots.push(cuts[i]+(cuts[i+1]-cuts[i])*(e.voltageV-va)/(vb-va));}}
      cuts=[...new Set(knots)].sort((a,b)=>a-b);
      const labels=['vehicle_curve','connector_power','connector_current','vehicle_path_power','vehicle_path_current',...(poolCap===null?[]:['shared_power']),...(envelope.length?['envelope_power','envelope_current']:[])];
      const caps=(soc:number)=>{
        const volts=voltage(soc);
        if(dc.outputVoltageRangeV&&!within(volts,dc.outputVoltageRangeV)||!within(volts,path.inletVoltageRangeV!))incompatible('DC_VOLTAGE_NOT_SUPPORTED');
        const value=curve!.curve.representation==='power_by_soc'?interpolate(curve!.curve.points,soc,p=>p.socPercent,p=>p.powerKw):
          interpolate(curve!.curve.points,soc,p=>p.socPercent,p=>p.currentA)*interpolate(curve!.curve.points,soc,p=>p.socPercent,p=>p.voltageV)/1000;
        const accepted=curve!.powerBoundary==='vehicle_inlet'?value:(value/(curve!.powerBoundary==='battery_stored'?storage:1)+aux)/efficiency;
        // A redundant known power cap keeps the integration finite when the current limit is unreported.
        const values=[accepted,dc.maxPowerKw!,dc.maxCurrentA===null?dc.maxPowerKw!:dc.maxCurrentA*volts/1000,path.maxInletPowerKw!,path.maxInletCurrentA!*volts/1000];
        if(poolCap!==null)values.push(poolCap);
        if(envelope.length){if(volts<envelope[0].voltageV||volts>envelope.at(-1)!.voltageV)missing('POWER_ENVELOPE_VOLTAGE_OUTSIDE_COVERAGE');
          values.push(interpolate(envelope,volts,p=>p.voltageV,p=>p.maxPowerKw),interpolate(envelope,volts,p=>p.voltageV,p=>p.maxCurrentA)*volts/1000);}
        return values;
      };
      const base=cuts;cuts=[];
      for(let i=0;i<base.length-1;i++){await check();cuts.push(...crossings(caps,base[i],base[i+1]).slice(0,-1));}cuts.push(base.at(-1)!);
      if(cuts.length>10000)throw new ChargingFailure('computation_limit','CHARGING_INTERVAL_LIMIT');
      let hours=0,inlet=0,auxiliary=0,loss=0;
      for(let i=0;i<cuts.length-1;i++){
        const a=cuts[i],b=cuts[i+1];let min=Infinity,max=0;
        const values=await integrateLedger(async soc=>{await check();const limits=caps(soc),pin=Math.min(...limits),terminal=pin*efficiency-aux,stored=terminal*storage;
          if(stored<=1e-9)throw new ChargingFailure('unreachable','NON_POSITIVE_NET_CHARGING_POWER');
          min=Math.min(min,pin);max=Math.max(max,pin);const dt=c.effectiveKwh/100/stored;
          return [dt,pin*dt,aux*dt,(pin*(1-efficiency)+terminal*(1-storage))*dt];},a,b,1e-8*(b-a)/(r.targetSocPercent-r.arrivalSocPercent));
        const mid=caps((a+b)/2),limiter=labels[mid.indexOf(Math.min(...mid))];
        hours+=values[0];inlet+=values[1];auxiliary+=values[2];loss+=values[3];
        if(hours>24)throw new ChargingFailure('computation_limit','CHARGING_DURATION_LIMIT');
        out.intervals.push({fromSocPercent:a,toSocPercent:b,seconds:values[0]*3600,storedKwh:c.effectiveKwh*(b-a)/100,
          inletKwh:values[1],auxiliaryKwh:values[2],lossKwh:values[3],minInletKw:min,maxInletKw:max,limiter});
      }
      signal.throwIfAborted();out.status='estimated';out.chargingSeconds=hours*3600;out.energyStoredKwh=c.effectiveKwh*(r.targetSocPercent-r.arrivalSocPercent)/100;
      out.energyDeliveredAtInletKwh=inlet;out.auxiliaryEnergyKwh=auxiliary;out.conversionLossKwh=loss;
      out.totalStopSeconds=r.timing.waitingSeconds===null?null:out.chargingSeconds+r.timing.waitingSeconds+r.timing.connectionSeconds;
      out.departureAt=out.totalStopSeconds===null||r.timing.arrivalAt===null?null:new Date(Date.parse(r.timing.arrivalAt)+out.totalStopSeconds*1000).toISOString();
      const thermal=model!.temperatureEvolution;
      if(thermal){
        if(!thermal.source.license||r.ambientTemperatureC===null||!within(r.ambientTemperatureC,thermal.ambientRangeC)||Math.abs(temp.value!-thermal.temperatureC)>.01)
          missing('CHARGING_THERMAL_MODEL_CONDITIONS_NOT_MET');
        if(out.departureAt!==null)out.batteryTemperatureAtDepartureC={origin:'estimated',value:thermal.temperatureC,estimatedAt:r.evaluatedAt,
          validAt:out.departureAt,modelVersion:model!.id+'/'+model!.version+'/'+thermal.version};
      }
      out.assumptions=[...c.assumptions,...model!.assumptions,'capacity_snapshot_fixed_no_second_soh_or_temperature_scaling','conditioned_curve_not_a_dynamic_thermal_model',
        'constant_calibrated_pack_auxiliary_and_efficiencies','no_blocking_preconditioning_model'];
      if(thermal)out.assumptions.push('source_calibrated_isothermal_regulation_with_existing_auxiliary_load');
      if(catalogueScenario)out.assumptions.push('catalogue_power_scenario_not_verified_hardware','selected_vehicle_voltage_path_assumed_available','catalogue_rated_power_assumed_sustained');
      else out.warnings.push('Charge-start temperature and curve conditions must hold; departure battery temperature remains unknown.');
      if(r.timing.waitingSeconds===null)out.warnings.push('Waiting time is unknown; total stop time and departure time are unavailable.');
      if(evse!.availability.reportedStatus==='unknown')out.warnings.push('Live connector availability is unknown.');
      return chargingEvaluationResultSchema.parse(out);
    }catch(error){
      if(signal.aborted)throw signal.reason;
      if(error instanceof ChargingFailure){out.status=error.status;out.reasons.push(error.message);}
      else if(error instanceof Error&&['QUADRATURE_CONVERGENCE_LIMIT'].includes(error.message)){out.status='computation_limit';out.reasons.push(error.message);}
      else if(error instanceof EnergyDataMissing)out.reasons.push(error.code);
      else throw error;
      out.chargingSeconds=out.energyStoredKwh=out.energyDeliveredAtInletKwh=out.auxiliaryEnergyKwh=out.conversionLossKwh=out.totalStopSeconds=null;out.departureAt=null;
      // Partial intervals are diagnostic only. Never publish a complete duration on failure.
      return chargingEvaluationResultSchema.parse(out);
    }
  }
}
