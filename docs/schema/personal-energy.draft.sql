-- DESIGN ONLY. NOT an application migration and NOT executed in CR-006.
-- Depends on CR-003/020 ownership, personal-vehicle and consent tables.
-- Authorization/RLS, erasure and raw-data retention must be implemented before collection.
-- data_owners, personal_vehicles, consent_revisions and trips below are future FK targets.
CREATE TABLE personal_driving_profiles (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES data_owners(id),
  personal_vehicle_id uuid NOT NULL REFERENCES personal_vehicles(id),
  vehicle_entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  configuration_snapshot_sha256 text NOT NULL,
  consent_revision_id uuid NOT NULL REFERENCES consent_revisions(id),
  UNIQUE(id,owner_id,vehicle_entity_id)
);
CREATE TABLE personal_energy_observations (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, owner_id uuid NOT NULL, vehicle_entity_id uuid NOT NULL,
  origin text NOT NULL CHECK(origin IN ('measured','user_input','estimated')),
  energy_boundary text NOT NULL CHECK(energy_boundary IN ('battery_dc','vehicle_inlet','ac_grid','unknown')),
  observed_from timestamptz NOT NULL, observed_until timestamptz NOT NULL,
  value_kwh double precision NOT NULL, method_version text NOT NULL, uncertainty jsonb,
  FOREIGN KEY(profile_id,owner_id,vehicle_entity_id) REFERENCES personal_driving_profiles(id,owner_id,vehicle_entity_id),
  UNIQUE(id,profile_id,owner_id,vehicle_entity_id), CHECK(observed_until>observed_from)
);
CREATE TABLE personal_driving_windows (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id),
  owner_id uuid NOT NULL, profile_id uuid NOT NULL, vehicle_entity_id uuid NOT NULL,
  window_policy_version text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
  elapsed_seconds double precision NOT NULL, valid_seconds double precision NOT NULL,
  distance_meters double precision NOT NULL, stopped_seconds double precision NOT NULL,
  partial boolean NOT NULL, gps_coverage_ratio double precision NOT NULL,
  speed_bins jsonb NOT NULL, road_speed_context jsonb, conditions jsonb NOT NULL,
  energy_observation_id uuid,
  FOREIGN KEY(profile_id,owner_id,vehicle_entity_id) REFERENCES personal_driving_profiles(id,owner_id,vehicle_entity_id),
  FOREIGN KEY(energy_observation_id,profile_id,owner_id,vehicle_entity_id)
    REFERENCES personal_energy_observations(id,profile_id,owner_id,vehicle_entity_id),
  UNIQUE(trip_id,window_policy_version,window_start,window_end),
  CHECK(window_end>window_start), CHECK(valid_seconds>=0 AND valid_seconds<=elapsed_seconds),
  CHECK(stopped_seconds>=0 AND stopped_seconds<=valid_seconds),
  CHECK(distance_meters>=0), CHECK(gps_coverage_ratio BETWEEN 0 AND 1)
);
CREATE INDEX personal_windows_profile_time_idx ON personal_driving_windows(profile_id,window_start);
CREATE TABLE personal_energy_model_revisions (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL, profile_id uuid NOT NULL, vehicle_entity_id uuid NOT NULL,
  reference_revision_id uuid NOT NULL, reference_quality_policy text NOT NULL,
  model_version text NOT NULL, policy_version text NOT NULL, data_cutoff_at timestamptz NOT NULL,
  independent_trip_count integer NOT NULL CHECK(independent_trip_count>=0),
  distance_km double precision NOT NULL CHECK(distance_km>=0),
  reference_weight double precision NOT NULL CHECK(reference_weight>0 AND reference_weight<=1),
  personal_weight double precision NOT NULL CHECK(personal_weight>=0 AND personal_weight<1),
  conditions jsonb NOT NULL, model_payload jsonb NOT NULL,
  FOREIGN KEY(profile_id,owner_id,vehicle_entity_id) REFERENCES personal_driving_profiles(id,owner_id,vehicle_entity_id),
  FOREIGN KEY(reference_revision_id,vehicle_entity_id,reference_quality_policy)
    REFERENCES vehicle_profile_revisions(id,entity_id,policy),
  CHECK(abs(reference_weight+personal_weight-1)<1e-9), UNIQUE(profile_id,model_version)
);
CREATE TABLE personal_model_trip_evidence (
  revision_id uuid NOT NULL REFERENCES personal_energy_model_revisions(id),
  trip_id uuid NOT NULL REFERENCES trips(id), split text NOT NULL CHECK(split IN ('training','holdout')),
  PRIMARY KEY(revision_id,trip_id)
);
-- Charging observations deliberately differ from driving-consumption windows.
CREATE TABLE personal_charging_observations (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL, profile_id uuid NOT NULL, vehicle_entity_id uuid NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  start_soc_percent double precision NOT NULL, end_soc_percent double precision NOT NULL,
  power_boundary text NOT NULL, battery_temperature_c double precision, preconditioning text NOT NULL,
  charger_limits jsonb NOT NULL, samples jsonb NOT NULL, station_limited boolean,
  provenance jsonb NOT NULL,
  FOREIGN KEY(profile_id,owner_id,vehicle_entity_id) REFERENCES personal_driving_profiles(id,owner_id,vehicle_entity_id),
  CHECK(ends_at>starts_at), CHECK(start_soc_percent BETWEEN 0 AND 100), CHECK(end_soc_percent BETWEEN 0 AND 100)
);
-- Before migration: enforce trip/personal_vehicle/consent owner consistency with composite FKs,
-- separate estimate/model versus measurement targets, immutable revisions and consent revocation.
-- Cross-owner consistency with future tables cannot be finalized before their schema exists.
