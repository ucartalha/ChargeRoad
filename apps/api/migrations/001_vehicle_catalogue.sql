CREATE TABLE vehicle_data_sources (
  key text PRIMARY KEY,
  name text NOT NULL,
  homepage_url text NOT NULL,
  license text NOT NULL
);

CREATE TABLE vehicle_imports (
  id uuid PRIMARY KEY,
  source_key text NOT NULL REFERENCES vehicle_data_sources(key),
  source_version text NOT NULL,
  schema_version text NOT NULL,
  source_url text NOT NULL,
  checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
  source_generated_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  record_count integer NOT NULL CHECK (record_count > 0),
  error_message text
);
CREATE INDEX vehicle_imports_source_time_idx ON vehicle_imports(source_key, source_generated_at DESC) WHERE status = 'succeeded';

CREATE TABLE vehicle_makes (
  id text PRIMARY KEY,
  source_key text NOT NULL REFERENCES vehicle_data_sources(key),
  slug text NOT NULL,
  name text NOT NULL,
  UNIQUE(source_key, slug)
);

CREATE TABLE vehicle_models (
  id text PRIMARY KEY,
  make_id text NOT NULL REFERENCES vehicle_makes(id),
  slug text NOT NULL,
  name text NOT NULL,
  UNIQUE(make_id, slug)
);

CREATE TABLE vehicle_variants (
  id text PRIMARY KEY,
  source_key text NOT NULL REFERENCES vehicle_data_sources(key),
  source_vehicle_id text NOT NULL,
  model_id text NOT NULL REFERENCES vehicle_models(id),
  model_year integer NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
  trim_slug text NOT NULL,
  trim_name text NOT NULL,
  variant_slug text,
  variant_name text,
  vehicle_type text NOT NULL,
  markets text[] NOT NULL DEFAULT '{}',
  usable_battery_kwh double precision CHECK (usable_battery_kwh > 0),
  gross_battery_kwh double precision CHECK (gross_battery_kwh > 0),
  max_ac_charge_kw double precision CHECK (max_ac_charge_kw >= 0),
  max_dc_charge_kw double precision CHECK (max_dc_charge_kw >= 0),
  source_updated_at timestamptz,
  raw_data jsonb NOT NULL,
  last_import_id uuid NOT NULL REFERENCES vehicle_imports(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_key, source_vehicle_id),
  CHECK (usable_battery_kwh IS NULL OR gross_battery_kwh IS NULL OR usable_battery_kwh <= gross_battery_kwh)
);
CREATE INDEX vehicle_variants_model_year_idx ON vehicle_variants(model_id, model_year);
CREATE INDEX vehicle_variants_active_idx ON vehicle_variants(source_key) WHERE is_active;
CREATE INDEX vehicle_variants_markets_idx ON vehicle_variants USING gin(markets);

CREATE TABLE vehicle_charge_ports (
  vehicle_id text NOT NULL REFERENCES vehicle_variants(id),
  ordinal integer NOT NULL,
  kind text NOT NULL,
  connector text NOT NULL,
  PRIMARY KEY(vehicle_id, ordinal)
);
CREATE INDEX vehicle_charge_ports_connector_idx ON vehicle_charge_ports(connector);

CREATE TABLE vehicle_consumption_profiles (
  vehicle_id text PRIMARY KEY REFERENCES vehicle_variants(id),
  consumption_kwh_per_100km double precision NOT NULL CHECK (consumption_kwh_per_100km > 0),
  basis text NOT NULL CHECK (basis = 'unspecified'),
  notes text
);

CREATE TABLE vehicle_range_ratings (
  vehicle_id text NOT NULL REFERENCES vehicle_variants(id),
  ordinal integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rated', 'real_world')),
  profile text NOT NULL,
  range_km double precision NOT NULL CHECK (range_km > 0),
  conditions jsonb,
  PRIMARY KEY(vehicle_id, ordinal)
);

CREATE TABLE vehicle_charge_curves (
  vehicle_id text PRIMARY KEY REFERENCES vehicle_variants(id),
  curve_type text NOT NULL CHECK (curve_type IN ('power_by_soc', 'current_by_soc')),
  conditions jsonb,
  source_url text
);

CREATE TABLE vehicle_charge_curve_points (
  vehicle_id text NOT NULL REFERENCES vehicle_charge_curves(vehicle_id),
  soc_percent double precision NOT NULL CHECK (soc_percent BETWEEN 0 AND 100),
  power_kw double precision CHECK (power_kw >= 0),
  current_a double precision CHECK (current_a >= 0),
  voltage_v double precision CHECK (voltage_v > 0),
  PRIMARY KEY(vehicle_id, soc_percent),
  CHECK (power_kw IS NOT NULL OR current_a IS NOT NULL)
);
