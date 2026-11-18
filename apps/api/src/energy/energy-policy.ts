// 1.4.0 (2026-11-17): modelled terrain is integrated through a 300 m distance window (elevation-window.ts).
// 1.5.0 (2026-11-18): windowed modelled terrain is resampled every 100 m; the knot budget applies to the physical
// (integrated) profile, raw DEM knots have their own larger bound (long routes such as İstanbul→Kelkit).
export const ENERGY_ALGORITHM_VERSION='chargeroad-energy/1.5.0';
// Road coordinates, unique terrain knots and speed samples have separate bounded budgets.
export const ENERGY_POLICY={maxSegments:10000,maxGeometryPoints:20000,maxElevationPoints:20000,maxSpeedPoints:20000,maxReferences:512,maxSteps:200000,
  maxStepSeconds:5,maxStepMeters:100,maxComputeMs:1500,yieldEvery:64,maxForecastAgeSeconds:43200,
  departureWindowSeconds:259200,gravity:9.80665,dryAirGasConstant:287.05,elevationWindowMeters:300,
  elevationResampleMeters:100,maxRawElevationPoints:200000} as const;
export class EnergyDataMissing extends Error {constructor(readonly code:string){super(code);}}
