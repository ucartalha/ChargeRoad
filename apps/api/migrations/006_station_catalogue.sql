CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE TABLE station_data_sources (
  key text PRIMARY KEY, name text NOT NULL, homepage_url text NOT NULL,
  permission text NOT NULL, permission_reference text NOT NULL, attribution text NOT NULL,
  license text, priority integer NOT NULL CHECK(priority BETWEEN 1 AND 1000)
);
CREATE TABLE station_source_snapshots (
  id uuid PRIMARY KEY,source_key text NOT NULL REFERENCES station_data_sources(key),
  scope_key text NOT NULL,country_code text NOT NULL,version text NOT NULL,
  retrieved_at timestamptz NOT NULL,source_updated_at timestamptz,
  raw_sha256 text NOT NULL,content_sha256 text NOT NULL,
  source_complete boolean NOT NULL,geographic_coverage_verified boolean NOT NULL,
  source_row_count integer NOT NULL,quality_exclusions integer NOT NULL,
  status text NOT NULL CHECK(status IN ('staged','published','rejected')),
  raw_bytes bytea NOT NULL,report jsonb NOT NULL,coverage_bounds jsonb,
  UNIQUE(source_key,scope_key,content_sha256),UNIQUE(id,source_key,scope_key)
);
CREATE TABLE charging_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE station_source_aliases (
  source_key text NOT NULL REFERENCES station_data_sources(key),country_code text NOT NULL,
  party_id text NOT NULL,external_id text NOT NULL,location_id uuid NOT NULL REFERENCES charging_locations(id),
  match_rationale text NOT NULL,
  PRIMARY KEY(source_key,country_code,party_id,external_id)
);
CREATE INDEX station_aliases_location_idx ON station_source_aliases(location_id);
CREATE TABLE station_location_revisions (
  id uuid PRIMARY KEY,snapshot_id uuid NOT NULL REFERENCES station_source_snapshots(id),
  location_id uuid NOT NULL REFERENCES charging_locations(id),
  location_geog public.geography(Point,4326) NOT NULL,
  lifecycle text NOT NULL CHECK(lifecycle IN ('operating','temporarily_closed','planned','removed','unknown')),
  public_access boolean,connector_standards text[] NOT NULL,payload jsonb NOT NULL,
  UNIQUE(snapshot_id,location_id),UNIQUE(id,location_id)
);
CREATE TABLE station_connector_claims (
  revision_id uuid NOT NULL REFERENCES station_location_revisions(id),external_id text NOT NULL,
  standard text NOT NULL,power_type text NOT NULL,max_power_kw double precision CHECK(max_power_kw>0),
  payload jsonb NOT NULL,PRIMARY KEY(revision_id,external_id)
);
CREATE TABLE charging_evses (
  revision_id uuid NOT NULL REFERENCES station_location_revisions(id),id text NOT NULL,payload jsonb NOT NULL,
  PRIMARY KEY(revision_id,id)
);
CREATE TABLE charging_connectors (
  revision_id uuid NOT NULL,evse_id text NOT NULL,id text NOT NULL,payload jsonb NOT NULL,
  PRIMARY KEY(revision_id,evse_id,id),FOREIGN KEY(revision_id,evse_id) REFERENCES charging_evses(revision_id,id)
);
CREATE TABLE charging_power_pools (
  revision_id uuid NOT NULL REFERENCES station_location_revisions(id),id text NOT NULL,payload jsonb NOT NULL,
  PRIMARY KEY(revision_id,id)
);
CREATE TABLE station_source_publications (
  source_key text NOT NULL,scope_key text NOT NULL,snapshot_id uuid NOT NULL,
  last_checked_at timestamptz NOT NULL,PRIMARY KEY(source_key,scope_key),
  FOREIGN KEY(snapshot_id,source_key,scope_key) REFERENCES station_source_snapshots(id,source_key,scope_key)
);
CREATE TABLE station_catalogue_heads (
  location_id uuid PRIMARY KEY REFERENCES charging_locations(id),revision_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES station_source_snapshots(id),source_key text NOT NULL REFERENCES station_data_sources(key),
  location_geog public.geography(Point,4326) NOT NULL,lifecycle text NOT NULL,
  public_access boolean,connector_standards text[] NOT NULL,payload jsonb NOT NULL,
  FOREIGN KEY(revision_id,location_id) REFERENCES station_location_revisions(id,location_id)
);
CREATE INDEX station_heads_geog_idx ON station_catalogue_heads USING gist(location_geog);
CREATE INDEX station_heads_standards_idx ON station_catalogue_heads USING gin(connector_standards);
CREATE TABLE station_import_runs (
  id uuid PRIMARY KEY,source_key text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,status text NOT NULL CHECK(status IN ('running','published','unchanged','failed')),
  snapshot_id uuid REFERENCES station_source_snapshots(id),error_code text
);
CREATE TABLE station_source_fetch_gates (
  source_key text NOT NULL,request_class text NOT NULL,next_allowed_at timestamptz NOT NULL,
  PRIMARY KEY(source_key,request_class)
);
CREATE TRIGGER immutable_station_revisions BEFORE UPDATE OR DELETE ON station_location_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_station_connector_claims BEFORE UPDATE OR DELETE ON station_connector_claims
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
-- Live availability observations are deliberately separate work (CR-008).
