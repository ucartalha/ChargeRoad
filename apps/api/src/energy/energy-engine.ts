import {createHash} from 'node:crypto';
import {setImmediate as yieldEventLoop} from 'node:timers/promises';
import {energyEvaluationRequestSchema,energyEvaluationResultSchema,weatherForecastIsUsable} from '@chargeroad/shared';
import type {EnergyEvaluationResult,EnergyAudit,EnergyModel,EnergySegment,RoadSegment,WeatherForecast} from '@chargeroad/shared';
import {canonicalJson} from '../vehicles/knowledge/knowledge-package';
import {ENERGY_ALGORITHM_VERSION,ENERGY_POLICY,EnergyDataMissing} from './energy-policy';
import {airDensity,cabinPower,capacityFactor,elevationAt,aerodynamicForce,hasPhysics,integratePieces,distanceToRoad} from './energy-physics';
import {meters} from '../roads/geometry';
import {createReferenceSelector} from './reference-selector';
import {batteryThermalStep} from './battery-thermal';
import {energyInputUsage} from './energy-input-budget';

const unknownTemperature={origin:'unknown' as const,value:null};
function audit(segment:RoadSegment,model:EnergyModel):EnergyAudit{return {segmentId:segment.id,mode:model.mode,
  referenceKwh:0,referenceRoadLoadKwh:0,referenceIncludedAuxiliaryKwh:0,roadLoadDrawKwh:0,referenceResidualKwh:0,
  baseAuxiliaryKwh:0,cabinKwh:0,batteryThermalKwh:0,availableBrakingKwh:0,regeneratedKwh:0,frictionBrakingKwh:0,
  wheelPositiveKwh:0,driveLossKwh:0,recoveryLossKwh:0,discardedRecoveryKwh:0,
  meanSpeedKph:segment.expectedSpeedKph,airDensityKgPerM3:null,integrationSteps:0,referenceIds:[]};}

// Pure arithmetic/data evaluation. No HTTP, DB, LLM, charging solver or implicit calibration.
export class EnergyConsumptionEngine {
  constructor(private readonly clock:()=>number=()=>performance.now()){}
  async evaluate(raw:unknown,signal:AbortSignal):Promise<EnergyEvaluationResult>{
    signal.throwIfAborted();
    const input=energyEvaluationRequestSchema.parse(raw),{vehicle,route}=input,continuation=input.continuation;
    const request=continuation?{...input.request,departureAt:continuation.departureAt,startingChargePercent:continuation.startingChargePercent,
      initialBatteryTemperatureC:continuation.batteryTemperatureC,constraints:{minimumReserveChargePercent:continuation.kind==='upper_charge_preview'?0:input.request.constraints.minimumReserveChargePercent,
        targetArrivalChargePercent:continuation.targetArrivalChargePercent}}:input.request;
    const result:EnergyEvaluationResult={status:'estimated',requestId:request.requestId,routeId:route.id,
      algorithmVersion:ENERGY_ALGORITHM_VERSION,inputChecksumSha256:createHash('sha256').update(canonicalJson(input)).digest('hex'),
      vehicleProfileId:vehicle.id,vehicleProfileVersion:vehicle.version,modelId:vehicle.energyModel?.id??null,modelVersion:vehicle.energyModel?.version??null,
      capacityKwh:null,segments:[],audit:[],netBatteryEnergyKwh:0,finalChargePercent:null,minimumChargePercent:null,
      completedDistanceMeters:0,partialSegmentId:null,referenceIds:[],reasons:[],assumptions:[],warnings:[]};
    const assumptions=new Set<string>(),warnings=new Set<string>(),referenceIds=new Set<string>();
    let currentSegment:string|null=null;
    const reason=(code:string)=>{if(!result.reasons.some(r=>r.code===code))result.reasons.push({code,segmentId:currentSegment});};
    const finish=()=>{result.assumptions=[...assumptions].sort();result.warnings=[...warnings].sort();result.referenceIds=[...referenceIds].sort();return energyEvaluationResultSchema.parse(result);};
    const deadline=this.clock()+Math.min(request.policy.maxComputationMilliseconds,ENERGY_POLICY.maxComputeMs);
    let steps=0;
    try{
      if(request.vehicleVariantId!==vehicle.vehicleVariantId)throw new EnergyDataMissing('VEHICLE_VARIANT_MISMATCH');
      if(continuation){assumptions.add('continuation_soc_is_modelled_not_a_new_user_measurement');
        if(Date.parse(continuation.departureAt)<Date.parse(input.request.departureAt))throw new EnergyDataMissing('CONTINUATION_PRECEDES_JOURNEY');}
      const departureDelta=(Date.parse(input.request.departureAt)-Date.parse(input.evaluatedAt))/1000;
      if(departureDelta<0||departureDelta>ENERGY_POLICY.departureWindowSeconds)throw new EnergyDataMissing('DEPARTURE_OUTSIDE_72_HOUR_WINDOW');
      const usage=energyInputUsage(route);
      if(usage.segments>ENERGY_POLICY.maxSegments||vehicle.consumptionReferences.length>ENERGY_POLICY.maxReferences||
        usage.geometryPoints>ENERGY_POLICY.maxGeometryPoints||usage.uniqueElevationPoints>ENERGY_POLICY.maxElevationPoints||
        usage.elevationPoints>ENERGY_POLICY.maxElevationPoints+Math.max(0,usage.segments-1)||usage.speedPoints>ENERGY_POLICY.maxSpeedPoints){
        result.status='computation_limit';reason('ENERGY_INPUT_BUDGET');return finish();}
      if(!vehicle.energyModel)throw new EnergyDataMissing('ENERGY_CALIBRATION_MISSING');
      const allowEstimates=request.policy.vehicleDataQuality==='allow_engineering_estimates';
      if(!allowEstimates&&(vehicle.energyModel.quality==='engineering_estimate'||vehicle.dataQuality?.quality==='engineering_estimate'))
        throw new EnergyDataMissing('ENGINEERING_ESTIMATE_NOT_ALLOWED');
      const model:EnergyModel=allowEstimates?vehicle.energyModel:{...vehicle.energyModel,unknowns:{payloadKg:null,sohPercent:null,cabinTargetC:null,hvacKw:null,
        capacityTemperatureFactor:null,airDensityKgPerM3:null,allowFlatElevation:false}};
      if(request.operatingConditions.tireSetupId!==null&&request.operatingConditions.tireSetupId!==model.tireSetupId)
        throw new EnergyDataMissing('TIRE_CALIBRATION_MISMATCH');
      if(request.operatingConditions.tireSetupId===null)assumptions.add('tire_setup_assumed_from_calibration');
      for(const item of model.assumptions)assumptions.add(item);
      const versionKey=ENERGY_ALGORITHM_VERSION+':'+createHash('sha256').update(canonicalJson(model)).digest('hex').slice(0,24);
      if(model.quality==='engineering_estimate'||vehicle.dataQuality?.quality==='engineering_estimate')warnings.add('engineering_calibration_not_field_validated');
      const payload=request.operatingConditions.payloadKg.value??model.unknowns.payloadKg;
      if(payload===null)throw new EnergyDataMissing('PAYLOAD_MISSING');
      if(request.operatingConditions.payloadKg.value===null)assumptions.add('explicit_payload_fallback');
      const soh=request.stateOfHealthPercent.value??model.unknowns.sohPercent;
      if(soh===null)throw new EnergyDataMissing('STATE_OF_HEALTH_MISSING');
      if(request.stateOfHealthPercent.value===null)assumptions.add('explicit_soh_fallback');
      const initialTemperature=request.initialBatteryTemperatureC;
      let batteryTemperature=initialTemperature.value;
      if(initialTemperature.origin==='estimated'&&(Date.parse(initialTemperature.estimatedAt)>Date.parse(input.evaluatedAt)||!initialTemperature.validAt||Math.abs(Date.parse(initialTemperature.validAt)-Date.parse(request.departureAt))>1000))batteryTemperature=null;
      if((initialTemperature.origin==='measured'||initialTemperature.origin==='user_input')&&
        (Date.parse(initialTemperature.observedAt)>Date.parse(input.evaluatedAt)||Date.parse(initialTemperature.observedAt)>Date.parse(request.departureAt)||Date.parse(request.departureAt)-Date.parse(initialTemperature.observedAt)>900000))batteryTemperature=null;
      if(initialTemperature.value!==null&&batteryTemperature===null)warnings.add('initial_battery_temperature_not_valid_at_departure');
      const prior=input.capacitySnapshot;
      if(prior&&(prior.vehicleProfileId!==vehicle.id||prior.vehicleProfileVersion!==vehicle.version||prior.vehicleVariantId!==vehicle.vehicleVariantId||
        prior.referenceUsableKwh!==vehicle.capacity.referenceUsableBatteryKwh||prior.referenceSohPercent!==vehicle.capacity.atStateOfHealthPercent||prior.sohPercent!==soh||
        prior.temperatureModelId!==(model.capacityTemperatureCurve?model.id:null)||prior.temperatureModelVersion!==(model.capacityTemperatureCurve?model.version:null)||
        Math.abs(prior.temperatureFactor-capacityFactor(model,prior.temperatureAtAssessmentC,assumptions))>1e-9))throw new EnergyDataMissing('CAPACITY_SNAPSHOT_PROFILE_OR_MODEL_MISMATCH');
      const capacity=prior?.effectiveKwh??vehicle.capacity.referenceUsableBatteryKwh*soh/vehicle.capacity.atStateOfHealthPercent*capacityFactor(model,batteryTemperature,assumptions);
      if(!Number.isFinite(capacity)||capacity<=0)throw new EnergyDataMissing('INVALID_EFFECTIVE_CAPACITY');
      result.capacityKwh=capacity;assumptions.add('capacity_fixed_at_evaluation_start_no_energy_created_by_warming');
      result.capacitySnapshot=prior??{vehicleProfileId:vehicle.id,vehicleProfileVersion:vehicle.version,vehicleVariantId:vehicle.vehicleVariantId,
        referenceUsableKwh:vehicle.capacity.referenceUsableBatteryKwh,referenceSohPercent:vehicle.capacity.atStateOfHealthPercent,sohPercent:soh,
        temperatureFactor:capacity/(vehicle.capacity.referenceUsableBatteryKwh*soh/vehicle.capacity.atStateOfHealthPercent),
        temperatureAtAssessmentC:batteryTemperature,temperatureModelId:model.capacityTemperatureCurve?model.id:null,
        temperatureModelVersion:model.capacityTemperatureCurve?model.version:null,effectiveKwh:capacity,assumptions:[...assumptions].sort()};
      let battery=capacity*request.startingChargePercent/100,minBattery=battery;
      result.finalChargePercent=request.startingChargePercent;result.minimumChargePercent=request.startingChargePercent;
      if(request.startingChargePercent<request.constraints.minimumReserveChargePercent){result.status='charge_required';reason('INITIAL_RESERVE_NOT_MET');return finish();}
      const physics=hasPhysics(vehicle),p=vehicle.physics;
      const selectReference=createReferenceSelector(vehicle,model);
      if(model.mode==='physics'&&!physics)throw new EnergyDataMissing('PHYSICAL_ROAD_LOAD_PARAMETERS_MISSING');
      const forecasts=new Map<string,WeatherForecast[]>();
      if(new Set(input.weather.map(w=>w.queryId)).size!==input.weather.length)throw new EnergyDataMissing('DUPLICATE_WEATHER_QUERY');
      for(const weather of input.weather){const group=forecasts.get(weather.segmentId)??[];group.push(weather);forecasts.set(weather.segmentId,group);}
      let elapsed=0,previousTraceEnd:number|null=null,halt=false;
      for(const segment of route.segments){
        currentSegment=segment.id;signal.throwIfAborted();
        if(segment.roadClass==='ferry')throw new EnergyDataMissing('FERRY_STANDBY_ENERGY_MODEL_REQUIRED');
        if(this.clock()>=deadline){result.status='computation_limit';reason('ENERGY_COMPUTATION_DEADLINE');return finish();}
        const startAt=Date.parse(request.departureAt)+elapsed*1000,endAt=startAt+segment.drivingDurationSeconds*1000,target=(startAt+endAt)/2;
        // ISO timestamps have millisecond precision; accumulated road durations may be fractional milliseconds.
        const weather=[...(forecasts.get(segment.id)??[])].filter(w=>Date.parse(w.validAt)>=Math.floor(startAt)&&Date.parse(w.validAt)<=Math.ceil(endAt))
          .sort((a,b)=>Math.abs(Date.parse(a.validAt)-target)-Math.abs(Date.parse(b.validAt)-target)||(a.queryId<b.queryId?-1:a.queryId>b.queryId?1:0))[0];
        if(!weather||!weatherForecastIsUsable(weather,Date.parse(input.evaluatedAt),Math.min(ENERGY_POLICY.maxForecastAgeSeconds,request.policy.forecastMaxAgeSeconds)))
          throw new EnergyDataMissing('WEATHER_CORE_OR_FRESHNESS_MISSING');
        if(distanceToRoad(weather.location,segment)>50)throw new EnergyDataMissing('WEATHER_NOT_ON_ROAD_SEGMENT');
        if(weather.metadata&&Math.abs(meters(weather.location,weather.metadata.sampledLocation)-weather.metadata.sampleDistanceMeters)>1)
          throw new EnergyDataMissing('WEATHER_SPATIAL_PROVENANCE_MISMATCH');
        if(weather.metadata&&(Date.parse(weather.validAt)<Date.parse(weather.metadata.coverageStart)||Date.parse(weather.validAt)>Date.parse(weather.metadata.coverageEnd)||
          Date.parse(weather.validAt)<Date.parse(weather.metadata.intervalStart)||Date.parse(weather.validAt)>Date.parse(weather.metadata.intervalEnd)))
          throw new EnergyDataMissing('WEATHER_TIME_PROVENANCE_MISMATCH');
        if(weather.metadata&&weather.metadata.sampleDistanceMeters>10000)throw new EnergyDataMissing('WEATHER_SAMPLE_TOO_FAR');
        if(weather.temperatureCelsius!<model.ambientRangeC.min||weather.temperatureCelsius!>model.ambientRangeC.max)throw new EnergyDataMissing('AMBIENT_OUTSIDE_CALIBRATION');
        if(batteryTemperature===null&&allowEstimates&&model.unknowns.initialBatteryTemperature==='ambient_equilibrium'){
          batteryTemperature=weather.temperatureCelsius!;assumptions.add('initial_battery_temperature_modelled_at_ambient_equilibrium');
          warnings.add('battery_temperature_is_estimated_not_observed');
        }
        if(segment.speedLimitKph!==null&&(segment.expectedSpeedKph>segment.speedLimitKph+0.1||segment.speedProfile?.some(v=>v.speedKph>segment.speedLimitKph!+0.1)))
          throw new EnergyDataMissing('ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT');
        if(segment.speedLimitKph===null)warnings.add('speed_limit_unknown');
        if(!segment.speedProfile){if(model.speedPolicy==='require_speed_trace')throw new EnergyDataMissing('SPEED_DISTRIBUTION_MISSING');
          assumptions.add('travel_average_used_as_steady_speed_proxy');warnings.add('stop_go_energy_not_reconstructed_from_average_speed');previousTraceEnd=null;}
        else {if(model.mode==='reference_corrected'&&!physics)throw new EnergyDataMissing('SPEED_TRACE_REFERENCE_CORRECTION_PHYSICS_MISSING');
          assumptions.add('speed_trace_distance_rounding_reconciled_with_road_length');
          if(previousTraceEnd!==null&&Math.abs(previousTraceEnd-segment.speedProfile[0].speedKph)>0.1)throw new EnergyDataMissing('SPEED_TRACE_BOUNDARY_DISCONTINUITY');
          previousTraceEnd=segment.speedProfile.at(-1)!.speedKph;}
        if(!segment.elevationProfile){if(!model.unknowns.allowFlatElevation)throw new EnergyDataMissing('ELEVATION_MISSING');assumptions.add('explicit_flat_elevation_fallback');}
        else if(segment.elevationQuality!=='verified'){if(!allowEstimates)throw new EnergyDataMissing('ELEVATION_NOT_VERIFIED');assumptions.add('modelled_elevation_not_independently_verified');warnings.add('modelled_elevation_not_independently_verified');}
        let rollingMultiplier=1;
        if(weather.precipitationMmPerHour===null)warnings.add('precipitation_correction_unknown');
        else if(weather.precipitationMmPerHour>0){if(model.wetRollingMultiplier===null)throw new EnergyDataMissing('WET_ROAD_CALIBRATION_MISSING');rollingMultiplier*=model.wetRollingMultiplier;}
        if(weather.snowDepthCm===null)warnings.add('snow_surface_effect_unknown');
        else if(weather.snowDepthCm>0){if(model.snowRollingMultiplier===null)throw new EnergyDataMissing('SNOW_ROAD_CALIBRATION_MISSING');rollingMultiplier*=model.snowRollingMultiplier;}
        const currentCabinKw=cabinPower(model,request.operatingConditions.hvacMode,request.operatingConditions.cabinTargetTemperatureC.value,weather.temperatureCelsius!,assumptions);
        const calibrationDensity=model.referenceAirDensityKgPerM3;
        const mass=physics?p.curbMassKg!+payload:0,segmentReferences=new Set<string>();
        const a=audit(segment,model),startBattery=battery;
        let segmentMin=battery,segmentSeconds=0,segmentDistance=0,densityDistanceSum=0;
        for(const piece of integratePieces(segment)){
          signal.throwIfAborted();
          if(++steps>ENERGY_POLICY.maxSteps||this.clock()>=deadline){result.status='computation_limit';reason('ENERGY_INTEGRATION_BUDGET');halt=true;break;}
          if(steps%ENERGY_POLICY.yieldEvery===0){await yieldEventLoop();signal.throwIfAborted();}
          const beginHeight=elevationAt(segment,piece.startDistance),endHeight=elevationAt(segment,piece.endDistance),dh=beginHeight===null||endHeight===null?0:endHeight-beginHeight;
          const speed=(piece.startSpeed+piece.endSpeed)/2;
          const baseline=model.mode==='reference_corrected'&&piece.distance>1e-10?selectReference(speed*3.6,weather.temperatureCelsius!,batteryTemperature):null;
          if(baseline){for(const id of baseline.ids){referenceIds.add(id);segmentReferences.add(id);}
            if(!physics&&(weather.windSpeedKph!==0||rollingMultiplier!==1||dh!==0||payload!==baseline.referencePayload))
              throw new EnergyDataMissing('REFERENCE_CORRECTION_PHYSICS_MISSING');
            if(physics&&calibrationDensity===null)throw new EnergyDataMissing('REFERENCE_AIR_DENSITY_MISSING');
          }else if(model.mode==='reference_corrected')assumptions.add('stationary_reference_uses_explicit_base_auxiliary_model');
          const referenceMass=baseline&&physics?p.curbMassKg!+baseline.referencePayload:0;
          const rho=physics?airDensity(weather,beginHeight===null?null:(beginHeight+endHeight!)/2,model,assumptions):null;
          if(physics&&(!Number.isFinite(rho)||rho!<=0))throw new EnergyDataMissing('INVALID_AIR_DENSITY');
          let wheelKwh=0,flatKwh=0;
          if(physics){
            const aero=aerodynamicForce(rho!,p.dragAreaSquareMeters!,speed,weather.windSpeedKph!,weather.windFromDegrees,segment.bearingDegrees,assumptions);
            const kinetic=segment.speedProfile?0.5*mass*model.rotationalMassFactor*(piece.endSpeed**2-piece.startSpeed**2):0;
            wheelKwh=((mass*ENERGY_POLICY.gravity*p.rollingResistanceCoefficient!*rollingMultiplier+aero)*piece.distance+mass*ENERGY_POLICY.gravity*dh+kinetic)/3600000;
            if(baseline)flatKwh=(referenceMass*ENERGY_POLICY.gravity*p.rollingResistanceCoefficient!+.5*calibrationDensity!*p.dragAreaSquareMeters!*speed**2)*piece.distance/(3600000*p.drivetrainEfficiency!);
          }
          const hours=piece.seconds/3600,refKwh=baseline?baseline.rate*piece.distance/100000:0,
            includedAux=baseline?(baseline.includedCabinKw+baseline.includedThermalKw)*hours:0,
            residual=baseline?refKwh-flatKwh-includedAux:0;
          if(residual < -1e-8)throw new EnergyDataMissing('REFERENCE_BELOW_CALIBRATED_ROAD_LOAD');
          if(baseline)assumptions.add('reference_residual_distributed_by_distance');
          const batteryThermal=batteryThermalStep(model,batteryTemperature,weather.temperatureCelsius!,hours);
          const traction=physics?Math.max(0,wheelKwh)/p.drivetrainEfficiency!:0,
            baseAux=baseline?0:model.baseAuxiliaryKw*hours,cabin=currentCabinKw*hours,thermal=batteryThermal.energyKwh;
          if(model.maxTractionBatteryKw!==null&&traction/hours>model.maxTractionBatteryKw+1e-6)throw new EnergyDataMissing('DRIVE_POWER_DEMAND_EXCEEDS_CALIBRATION');
          if(model.maxTractionBatteryKw===null)warnings.add('traction_power_limit_unknown');
          const nextTemperature=batteryThermal.temperatureC;
          if(model.automaticBatteryThermal)assumptions.add('bounded_automatic_battery_thermal_model_no_ohmic_heat_or_preconditioning_completion');
          else if(!model.passiveThermal||model.batteryThermalKw>0)warnings.add('battery_temperature_evolution_unknown');else assumptions.add('passive_battery_thermal_model_no_ohmic_or_active_heat');
          const temperatureOk=batteryTemperature!==null&&nextTemperature!==null&&Math.min(batteryTemperature,nextTemperature)>=model.regeneration.temperatureRangeC.min&&
            Math.max(batteryTemperature,nextTemperature)<=model.regeneration.temperatureRangeC.max;
          if(!temperatureOk)assumptions.add('regeneration_disabled_outside_known_thermal_envelope');
          const soc=battery/capacity*100,taper=Math.max(0,Math.min(1,(model.regeneration.zeroAtSocPercent-soc)/(model.regeneration.zeroAtSocPercent-model.regeneration.taperStartSocPercent))),
            braking=Math.max(0,-wheelKwh),eff=model.regeneration.efficiency,
            regenerated=temperatureOk?Math.max(0,Math.min(braking*eff,(p.maxRegenerationKw??0)*hours*taper,capacity-battery)):0;
          if(p.maxRegenerationKw===null)assumptions.add('unknown_regeneration_power_treated_as_zero');
          const net=traction+Math.max(0,residual)+baseAux+cabin+thermal-regenerated;
          if(![wheelKwh,flatKwh,residual,net].every(Number.isFinite))throw new EnergyDataMissing('NUMERIC_CALIBRATION_DOMAIN_EXCEEDED');
          if(net>battery+1e-10){result.status='charge_required';reason('BATTERY_DEPLETION_PREDICTED');halt=true;break;}
          battery=Math.max(0,Math.min(capacity,battery-net));minBattery=Math.min(minBattery,battery);segmentMin=Math.min(segmentMin,battery);
          batteryTemperature=nextTemperature;
          a.referenceKwh+=refKwh;a.referenceRoadLoadKwh+=flatKwh;a.referenceIncludedAuxiliaryKwh+=includedAux;a.referenceResidualKwh+=Math.max(0,residual);
          a.roadLoadDrawKwh+=traction;a.baseAuxiliaryKwh+=baseAux;a.cabinKwh+=cabin;a.batteryThermalKwh+=thermal;
          a.availableBrakingKwh+=braking;a.regeneratedKwh+=regenerated;a.frictionBrakingKwh+=Math.max(0,braking-(eff>0?regenerated/eff:0));
          a.wheelPositiveKwh+=Math.max(0,wheelKwh);a.driveLossKwh+=traction-Math.max(0,wheelKwh);
          a.recoveryLossKwh+=eff>0?regenerated/eff-regenerated:0;a.discardedRecoveryKwh+=Math.max(0,braking*eff-regenerated);
          if(rho!==null)densityDistanceSum+=rho*piece.distance;
          a.airDensityKgPerM3=rho===null?null:piece.endDistance>0?densityDistanceSum/piece.endDistance:rho;a.integrationSteps++;a.referenceIds=[...segmentReferences].sort();
          segmentSeconds+=piece.seconds;segmentDistance=piece.endDistance;
          if(battery/capacity*100<request.constraints.minimumReserveChargePercent-1e-8){result.status='charge_required';reason('RESERVE_WOULD_BE_VIOLATED');}
        }
        const endedAt=new Date(startAt+segmentSeconds*1000).toISOString();
        if(segmentSeconds>0){
          const row:EnergySegment={segmentId:segment.id,departureAt:new Date(startAt).toISOString(),arrivalAt:endedAt,
            startChargePercent:startBattery/capacity*100,endChargePercent:battery/capacity*100,minimumChargePercent:segmentMin/capacity*100,
            netBatteryEnergyKwh:startBattery-battery,
            breakdown:model.mode==='reference_corrected'?null:{tractionKwh:a.roadLoadDrawKwh,baseAuxiliaryKwh:a.baseAuxiliaryKwh,cabinAuxiliaryKwh:a.cabinKwh,batteryThermalKwh:a.batteryThermalKwh,regeneratedKwh:a.regeneratedKwh},
            batteryTemperatureAtEndC:batteryTemperature===null?unknownTemperature:{origin:'estimated',value:batteryTemperature,estimatedAt:input.evaluatedAt,validAt:endedAt,modelVersion:versionKey+(model.automaticBatteryThermal?'/automatic-thermal':'/passive')},
            consumptionReferenceIds:[...segmentReferences].sort(),weatherQueryIds:[weather.queryId],modelVersion:versionKey};
          result.segments.push(row);result.audit.push(a);
        }
        result.completedDistanceMeters=segment.startDistanceMeters+segmentDistance;
        result.finalChargePercent=battery/capacity*100;result.minimumChargePercent=minBattery/capacity*100;
        result.netBatteryEnergyKwh=capacity*request.startingChargePercent/100-battery;
        if(halt){result.partialSegmentId=segment.id;return finish();}
        elapsed+=segment.drivingDurationSeconds;
      }
      if(result.finalChargePercent!<request.constraints.targetArrivalChargePercent-1e-8){result.status='charge_required';reason('ARRIVAL_TARGET_NOT_MET');}
      return finish();
    }catch(error){
      if(signal.aborted)throw signal.reason;
      if(!(error instanceof EnergyDataMissing))throw error;
      result.status=error.code==='INTEGRATION_STEP_LIMIT'?'computation_limit':'insufficient_data';reason(error.code);return finish();
    }
  }
}
