ALTER TABLE station_import_runs ADD COLUMN receipt jsonb;
ALTER TABLE station_location_revisions ADD CONSTRAINT station_revision_snapshot_identity UNIQUE(id,snapshot_id,location_id);
ALTER TABLE station_catalogue_heads ADD CONSTRAINT station_head_snapshot_identity_fk
  FOREIGN KEY(revision_id,snapshot_id,location_id) REFERENCES station_location_revisions(id,snapshot_id,location_id);
CREATE TRIGGER immutable_charging_evses BEFORE UPDATE OR DELETE ON charging_evses
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_charging_connectors BEFORE UPDATE OR DELETE ON charging_connectors
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_charging_power_pools BEFORE UPDATE OR DELETE ON charging_power_pools
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE FUNCTION protect_station_snapshot_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Station snapshots are immutable'; END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'Station snapshot evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_station_snapshot_data BEFORE UPDATE OR DELETE ON station_source_snapshots
  FOR EACH ROW EXECUTE FUNCTION protect_station_snapshot_data();
