export const STATION_POLICY={
  version:'station-corridor/1.0.0',
  // Operational starting budgets, not calibrated route-quality or production SLA claims.
  corridorStepsMeters:[2000,5000,10000],maxCandidates:500,maxRoutes:5,maxGeometryPoints:20000,
  statementTimeoutMs:2000,staticSoftAgeSeconds:86400,
  maxAutomaticCoordinateMoveMeters:2000,
} as const;
