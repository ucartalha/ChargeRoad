import type {EnergyModel,RoadSegment,WeatherForecast,VehicleEnergyProfile} from '@chargeroad/shared';
import type {Coordinate} from '@chargeroad/shared';
import {meters} from '../roads/geometry';
import {ENERGY_POLICY,EnergyDataMissing} from './energy-policy';

export function airDensity(weather:WeatherForecast,height:number|null,model:EnergyModel,assumptions:Set<string>){
  const temp=weather.temperatureCelsius!+273.15;
  if(temp<=0)throw new EnergyDataMissing('INVALID_ABSOLUTE_TEMPERATURE');
  if(weather.airPressureHpa!==null&&weather.metadata?.pressureKind==='surface')return weather.airPressureHpa*100/(ENERGY_POLICY.dryAirGasConstant*temp);
  if(weather.airPressureHpa!==null&&weather.metadata?.pressureKind==='sea_level'&&height!==null){
    assumptions.add('isothermal_sea_level_to_surface_pressure');
    const pressure=weather.airPressureHpa*100*Math.exp(-ENERGY_POLICY.gravity*height/(ENERGY_POLICY.dryAirGasConstant*temp));
    return pressure/(ENERGY_POLICY.dryAirGasConstant*temp);
  }
  if(model.unknowns.airDensityKgPerM3===null)throw new EnergyDataMissing('SURFACE_AIR_DENSITY_MISSING');
  assumptions.add('explicit_calibration_air_density_fallback');return model.unknowns.airDensityKgPerM3;
}
export function cabinPower(model:EnergyModel,mode:string,target:number|null,temperature:number,assumptions:Set<string>){
  if(mode==='off')return 0;
  if(mode==='unknown'){
    if(model.unknowns.hvacKw===null)throw new EnergyDataMissing('HVAC_STATE_MISSING');assumptions.add('explicit_unknown_hvac_power');return model.unknowns.hvacKw;
  }
  if(target===null){target=model.unknowns.cabinTargetC;if(target===null)throw new EnergyDataMissing('CABIN_TARGET_MISSING');assumptions.add('explicit_cabin_target_fallback');}
  const heat=Math.max(0,target-temperature)*model.cabin.heatKwPerDegree,cool=Math.max(0,temperature-target)*model.cabin.coolKwPerDegree;
  return Math.min(model.cabin.maxKw,mode==='heat'?heat:mode==='cool'?cool:heat+cool);
}
export function capacityFactor(model:EnergyModel,temperature:number|null,assumptions:Set<string>){
  const curve=model.capacityTemperatureCurve;if(!curve){assumptions.add('temperature_capacity_derating_not_modelled');return 1;}
  if(temperature===null){if(model.unknowns.capacityTemperatureFactor===null)throw new EnergyDataMissing('BATTERY_TEMPERATURE_FOR_CAPACITY_MISSING');
    assumptions.add('explicit_unknown_temperature_capacity_factor');return model.unknowns.capacityTemperatureFactor;}
  const i=curve.findIndex(p=>p.temperatureC>=temperature);if(i<0||i===0&&temperature<curve[0].temperatureC)throw new EnergyDataMissing('CAPACITY_TEMPERATURE_OUTSIDE_CALIBRATION');
  const b=curve[i];if(b.temperatureC===temperature)return b.factor;const a=curve[i-1];return a.factor+(b.factor-a.factor)*(temperature-a.temperatureC)/(b.temperatureC-a.temperatureC);
}
export function elevationAt(segment:RoadSegment,distance:number){
  const points=segment.elevationProfile;if(!points)return null;
  const i=points.findIndex(p=>p.distanceFromStartMeters>=distance);if(i<0)return points.at(-1)!.elevationMeters;
  if(i===0)return points[0].elevationMeters;const a=points[i-1],b=points[i];
  return a.elevationMeters+(b.elevationMeters-a.elevationMeters)*(distance-a.distanceFromStartMeters)/(b.distanceFromStartMeters-a.distanceFromStartMeters);
}
export function aerodynamicForce(density:number,cda:number,speedMps:number,windKph:number,windFrom:number|null,bearing:number,assumptions:Set<string>){
  const angle=((windFrom??0)-bearing)*Math.PI/180,along=speedMps+windKph/3.6*Math.cos(angle),cross=windKph/3.6*Math.sin(angle);
  if(along<0)assumptions.add('tailwind_assistance_not_harvested');
  return .5*density*cda*Math.hypot(along,cross)*Math.max(0,along);
}
export function hasPhysics(vehicle:VehicleEnergyProfile){const p=vehicle.physics;return p.curbMassKg!==null&&p.dragAreaSquareMeters!==null&&p.rollingResistanceCoefficient!==null&&p.drivetrainEfficiency!==null;}
export function distanceToRoad(location:Coordinate,segment:RoadSegment){
  const longitudeDelta=(value:number)=>(value+540)%360-180;
  return Math.min(...segment.geometry.slice(1).map((end,index)=>{
    const start=segment.geometry[index],scale=Math.cos(start.latitude*Math.PI/180),x=longitudeDelta(end.longitude-start.longitude)*scale,y=end.latitude-start.latitude,
      px=longitudeDelta(location.longitude-start.longitude)*scale,py=location.latitude-start.latitude,
      t=x*x+y*y===0?0:Math.max(0,Math.min(1,(px*x+py*y)/(x*x+y*y)));
    return meters(location,{latitude:start.latitude+y*t,longitude:longitudeDelta(start.longitude+longitudeDelta(end.longitude-start.longitude)*t)});
  }));
}

export interface IntegrationPiece {seconds:number;distance:number;startDistance:number;endDistance:number;startSpeed:number;endSpeed:number;}
export function* integratePieces(segment:RoadSegment):Generator<IntegrationPiece>{
  const trace=segment.speedProfile??[{elapsedSeconds:0,speedKph:segment.expectedSpeedKph},{elapsedSeconds:segment.drivingDurationSeconds,speedKph:segment.expectedSpeedKph}];
  const traceDistance=trace.slice(1).reduce((sum,p,i)=>sum+(p.speedKph+trace[i].speedKph)/7.2*(p.elapsedSeconds-trace[i].elapsedSeconds),0);
  const scale=segment.distanceMeters/traceDistance;
  let distance=0;
  for(let i=0;i<trace.length-1;i++){
    const a=trace[i],b=trace[i+1],duration=b.elapsedSeconds-a.elapsedSeconds,v0=a.speedKph/3.6,v1=b.speedKph/3.6;
    const span=(v0+v1)/2*duration,count=Math.ceil(Math.max(duration/ENERGY_POLICY.maxStepSeconds,span/ENERGY_POLICY.maxStepMeters));
    if(count>ENERGY_POLICY.maxSteps)throw new EnergyDataMissing('INTEGRATION_STEP_LIMIT');
    const cuts=Array.from({length:count+1},(_,k)=>duration*k/count);
    // Split at every internal elevation knot so peaks cannot disappear.
    for(const point of segment.elevationProfile??[]){const delta=point.distanceFromStartMeters/scale-distance;
      if(delta<=1e-8||delta>=span-1e-8)continue;
      const acceleration=(v1-v0)/duration;
      const t=Math.abs(acceleration)<1e-12?delta/v0:2*delta/(v0+Math.sqrt(Math.max(0,v0*v0+2*acceleration*delta)));
      if(t>0&&t<duration)cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);const boundaries=cuts.filter((t,k)=>k===0||t-cuts[k-1]>1e-9);
    for(let k=0;k<boundaries.length-1;k++){
      const t0=boundaries[k],t1=boundaries[k+1],startSpeed=v0+(v1-v0)*t0/duration,endSpeed=v0+(v1-v0)*t1/duration;
      const start=distance+v0*t0+.5*(v1-v0)/duration*t0*t0,end=distance+v0*t1+.5*(v1-v0)/duration*t1*t1;
      yield {seconds:t1-t0,distance:(end-start)*scale,startDistance:start*scale,endDistance:end*scale,startSpeed,endSpeed};
    }
    distance+=span;
  }
}
