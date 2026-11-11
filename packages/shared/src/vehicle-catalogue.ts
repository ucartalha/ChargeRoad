// Catalogue data can be incomplete. It is not a validated VehicleEnergyProfile.
export type VehicleCatalogueEntry = {
  marketedBatteryKwh?:number|null;
  drivetrain?:'rwd'|'awd'|'fwd'|'unknown';
  wheelInches?:number|null;
  motorPowerKw?:number|null;
  dataQuality?:{missing:string[];profiles:('verified_only'|'allow_engineering_estimates')[];sourceVersion:string};
  id: string;
  make: string;
  makeSlug: string;
  model: string;
  modelSlug: string;
  modelYear: number;
  trim: string;
  trimSlug: string;
  variant: string | null;
  variantSlug: string | null;
  vehicleType: string;
  markets: string[];
  usableBatteryKwh: number | null;
  grossBatteryKwh: number | null;
  maxAcChargeKw: number | null;
  maxDcChargeKw: number | null;
  consumptionKwhPer100Km: number | null;
  consumptionBasis: 'unspecified' | null;
  connectorTypes: string[];
  isActive: boolean;
  source: {
    key: string;
    name: string;
    license: string;
    homepageUrl: string;
    vehicleId: string;
    version: string;
    schemaVersion: string;
    generatedAt: string;
    fetchedAt: string;
    sourceUpdatedAt: string | null;
  };
};

export type VehicleCatalogueDetail = VehicleCatalogueEntry & {
  chargePorts: { kind: string; connector: string }[];
  rangeRatings: {
    kind: 'rated' | 'real_world';
    profile: string;
    rangeKm: number;
    conditions: Record<string, unknown> | null;
  }[];
  dcChargeCurve: {
    type: 'power_by_soc' | 'current_by_soc';
    conditions: Record<string, unknown> | null;
    sourceUrl: string | null;
    points: {
      socPercent: number;
      powerKw: number | null;
      currentA: number | null;
      voltageV: number | null;
    }[];
  } | null;
};

export type VehicleCataloguePage = {
  items: VehicleCatalogueEntry[];
  total: number;
  limit: number;
  offset: number;
};
