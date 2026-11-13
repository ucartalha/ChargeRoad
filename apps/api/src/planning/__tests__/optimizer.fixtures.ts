import type {RoadRoute,Coordinate,StationCandidateSet,WeatherQuery,WeatherForecast} from '@chargeroad/shared';
import type {ProviderResponse} from '../../providers/provider-response';
import {chargingFixture} from '../../charging/__tests__/fixtures';
import {energyFixture} from '../../energy/__tests__/fixtures';
import {fixture,stationSet,source,forecast} from './fixtures';
import {EvPlanningService} from '../ev-planning.service';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {DEFAULT_OPTIMIZER_OPTIONS} from '../optimizer-policy';
import {VehicleEnergyProvider} from '../../providers/vehicle-energy-provider';
import {RoutingProvider} from '../../providers/routing-provider';
import {StationDataProvider} from '../../providers/station-data-provider';
import {WeatherProvider} from '../../providers/weather-provider';

/** Scaled, hand-solvable graph. Deliberately not a real car or a geography accuracy test. */
export function optimizerWorld(mocked=true){
  const spy=<T extends (...args:any[])=>any>(fn:T)=>mocked?jest.fn(fn) as unknown as jest.MockedFunction<T>:fn as jest.MockedFunction<T>;
  const f=energyFixture(),charging=chargingFixture(),now=new Date().toISOString(),departure=new Date(Date.now()+60000).toISOString();
  const request=f.request;request.departureAt=departure;request.startingChargeObservedAt=now;request.startingChargePercent=40;
  request.initialBatteryTemperatureC={origin:'user_input',value:30,observedAt:now};request.stateOfHealthPercent={origin:'user_input',value:100,observedAt:now};
  request.constraints={minimumReserveChargePercent:10,targetArrivalChargePercent:20};request.policy.maxComputationMilliseconds=20000;
  request.destination={latitude:39.918,longitude:32.8};
  const vehicle=f.vehicle;vehicle.energyModel!.mode='reference_corrected';vehicle.capacity.referenceUsableBatteryKwh=4;
  vehicle.consumptionReferences[0].valueKwhPer100Km=200;vehicle.chargingModel=charging.vehicle.chargingModel;
  vehicle.chargingModel!.connectionModel={batteryKw:0,ambientRangeC:{min:-40,max:50},source:source('synthetic-connection')};
  vehicle.chargingModel!.temperatureEvolution={kind:'isothermal_conditioned',version:'synthetic-isothermal/1',temperatureC:30,
    ambientRangeC:{min:-40,max:50},source:source('synthetic-regulated-test')};
  vehicle.dcChargingPaths=charging.vehicle.dcChargingPaths;vehicle.dcChargingCurves=charging.vehicle.dcChargingCurves;
  vehicle.dcChargingCurves[0].curve={representation:'power_by_soc',points:[{socPercent:0,powerKw:100,voltageV:400,batteryTemperatureC:30},
    {socPercent:80,powerKw:100,voltageV:400,batteryTemperatureC:30},{socPercent:100,powerKw:5,voltageV:400,batteryTemperatureC:30}]};
  const locations:Record<string,Coordinate>={origin:request.origin,destination:request.destination,a:{latitude:39.9045,longitude:32.8},b:{latitude:39.91125,longitude:32.8}};
  const positions:Record<string,number>={origin:0,a:.5,b:1.25,destination:2};
  const preparation=fixture().options;preparation.road.alternatives=1;preparation.maxWeatherQueries=10000;
  const options={...DEFAULT_OPTIMIZER_OPTIONS,maxStates:1000,maxTransitions:10000,maxRoadQueries:100,maxWeatherQueries:10000,socStepPercent:10,connectionSeconds:0,corridorMeters:[2000]};
  function route(from:string,to:string):RoadRoute{
    const distance=Math.abs(positions[to]-positions[from])*1000,count=Math.max(1,Math.ceil(distance/1000)),span=distance/count;
    const segments=Array.from({length:count},(_,i)=>{
      const point=(t:number)=>({latitude:locations[from].latitude+(locations[to].latitude-locations[from].latitude)*t,longitude:32.8});
      return {...structuredClone(f.route.segments[0]),id:from+'-'+to+'-'+i,startDistanceMeters:i*span,endDistanceMeters:(i+1)*span,distanceMeters:span,
        drivingDurationSeconds:span/1000*60,geometry:[point(i/count),point((i+1)/count)],
        elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:span,elevationMeters:0}]};
    });
    return {id:from+'-'+to,distanceMeters:distance,drivingDurationSeconds:distance/1000*60,segments,segmentationPolicy:preparation.road.segmentationPolicy,
      source:source('synthetic-road'),metadata:{providerId:'synthetic-static',traffic:'none',departureUsedAt:departure,originTimeZone:'Europe/Istanbul',warnings:[],attributions:[],maneuvers:[],
        speedLimitKnownMeters:distance,speedLimitUnknownMeters:0,durationAllocation:'maneuver_weighted',usage:'development_pilot'}};
  }
  const candidates:StationCandidateSet=stationSet();candidates.metadata.search.emptyReason='none';
  candidates.candidates=['a','b'].map(id=>{const station=structuredClone(charging.station);station.id=id;station.name='Synthetic '+id;station.location=locations[id];
    return {station,lifecycle:'operating',connectorClaims:[],warnings:[],routeMatches:[{routeId:'origin-destination',segmentId:'origin-destination-0',distanceMeters:0,segmentProgress:positions[id]/2}]};});
  const vehicles={resolveId:spy(async(id:string)=>id),profile:spy(async()=>({data:vehicle,source:source('synthetic-profile')}))};
  const roads={routes:spy(async(r:{origin:Coordinate;destination:Coordinate})=>{
    const key=(p:Coordinate)=>Object.keys(locations).find(k=>Math.abs(locations[k].latitude-p.latitude)<1e-8&&Math.abs(locations[k].longitude-p.longitude)<1e-8)!;
    return {data:{schemaVersion:'1.0.0' as const,routes:[route(key(r.origin),key(r.destination))]},source:source('synthetic-road')};})};
  const stations={findAlongRoutes:spy(async()=>({data:candidates,source:source('synthetic-stations')}))};
  const weather={forecast:spy(async(queries:WeatherQuery[]):Promise<ProviderResponse<WeatherForecast[]>>=>({data:queries.map(q=>({...forecast(q),temperatureCelsius:30,forecastIssuedAt:new Date(Date.parse(now)-60000).toISOString(),fetchedAt:now})),source:source('synthetic-weather')}))};
  const service=new EvPlanningService(vehicles as unknown as VehicleEnergyProvider,roads as unknown as RoutingProvider,stations as unknown as StationDataProvider,
    weather as unknown as WeatherProvider,new EnergyConsumptionEngine(),new ChargingCurveEngine(),new ChargeStopOptimizer());
  return {request,vehicle,preparation,options,candidates,roads,stations,weather,vehicles,service,route,locations,now};
}
