CREATE TABLE vehicle_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL REFERENCES vehicle_data_sources(key), version text NOT NULL,
  source_url text NOT NULL, checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'),
  source_generated_at timestamptz NOT NULL, retrieved_at timestamptz NOT NULL,
  report jsonb NOT NULL, UNIQUE(source_key,checksum_sha256)
);
CREATE INDEX vehicle_source_snapshots_version_idx ON vehicle_source_snapshots(source_key,source_generated_at DESC);
CREATE TABLE vehicle_source_candidates (
  snapshot_id uuid NOT NULL REFERENCES vehicle_source_snapshots(id), external_id text NOT NULL,
  make text NOT NULL, model text NOT NULL, model_year integer,
  raw_record jsonb NOT NULL, review_flags jsonb NOT NULL,
  PRIMARY KEY(snapshot_id,external_id)
);
CREATE INDEX vehicle_source_candidates_selection_idx ON vehicle_source_candidates(make,model,model_year);
CREATE TRIGGER immutable_vehicle_source_candidates BEFORE UPDATE OR DELETE ON vehicle_source_candidates
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_vehicle_source_snapshots BEFORE UPDATE OR DELETE ON vehicle_source_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
