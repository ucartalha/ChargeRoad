export const ENERGY_ALGORITHM_VERSION='chargeroad-energy/1.3.2';
// Road coordinates, unique terrain knots and speed samples have separate bounded budgets.
export const ENERGY_POLICY={maxSegments:10000,maxGeometryPoints:20000,maxElevationPoints:20000,maxSpeedPoints:20000,maxReferences:512,maxSteps:200000,
  maxStepSeconds:5,maxStepMeters:100,maxComputeMs:1500,yieldEvery:64,maxForecastAgeSeconds:43200,
  departureWindowSeconds:259200,gravity:9.80665,dryAirGasConstant:287.05} as const;
export class EnergyDataMissing extends Error {constructor(readonly code:string){super(code);}}
