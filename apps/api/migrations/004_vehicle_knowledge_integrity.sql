ALTER TABLE vehicle_knowledge_batches ADD CONSTRAINT vehicle_knowledge_batch_source_unique UNIQUE(id,source_key);
ALTER TABLE vehicle_knowledge_publications ADD CONSTRAINT vehicle_knowledge_publication_source_fk
  FOREIGN KEY(batch_id,source_key) REFERENCES vehicle_knowledge_batches(id,source_key);
ALTER TABLE vehicle_profile_revisions ADD CONSTRAINT vehicle_profile_revision_identity_unique UNIQUE(id,entity_id,policy);
ALTER TABLE vehicle_profile_publications ADD CONSTRAINT vehicle_profile_publication_identity_fk
  FOREIGN KEY(revision_id,entity_id,policy) REFERENCES vehicle_profile_revisions(id,entity_id,policy);
ALTER TABLE vehicle_reference_revisions ADD CONSTRAINT vehicle_reference_record_fk
  FOREIGN KEY(batch_id,external_id) REFERENCES vehicle_knowledge_records(batch_id,external_id);
CREATE INDEX vehicle_knowledge_source_time_idx ON vehicle_knowledge_batches(source_key,generated_at DESC);
CREATE TABLE vehicle_knowledge_attempts (
  id uuid PRIMARY KEY,
  source_key text NOT NULL,
  checksum_sha256 text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL CHECK(status IN ('running','published','unchanged','failed')),
  batch_id uuid REFERENCES vehicle_knowledge_batches(id),
  error_code text
);
