-- Source-owned legacy tables remain intact. Public identity and publication are separate.
CREATE TABLE catalogue_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalogue_bindings (
  source_key text NOT NULL REFERENCES vehicle_data_sources(key),
  external_id text NOT NULL,
  entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  legacy_id text UNIQUE,
  match_basis text NOT NULL,
  PRIMARY KEY(source_key, external_id)
);
CREATE INDEX catalogue_bindings_entity_idx ON catalogue_bindings(entity_id);
CREATE TABLE catalogue_entries (
  entity_id uuid PRIMARY KEY REFERENCES catalogue_entities(id),
  primary_source text NOT NULL REFERENCES vehicle_data_sources(key),
  make_slug text NOT NULL, model_slug text NOT NULL, model_year integer NOT NULL,
  markets text[] NOT NULL DEFAULT '{}',
  search_text text NOT NULL,
  is_active boolean NOT NULL,
  detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_entries_selection_idx ON catalogue_entries(make_slug,model_slug,model_year,entity_id) WHERE is_active;
CREATE INDEX catalogue_entries_markets_idx ON catalogue_entries USING gin(markets);
CREATE TABLE vehicle_knowledge_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL REFERENCES vehicle_data_sources(key),
  version text NOT NULL, generated_at timestamptz NOT NULL, retrieved_at timestamptz NOT NULL,
  checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'),
  publication_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  status text NOT NULL CHECK(status IN ('staging','published','superseded')),
  report jsonb NOT NULL,
  UNIQUE(source_key,checksum_sha256)
);
CREATE TABLE vehicle_knowledge_records (
  batch_id uuid NOT NULL REFERENCES vehicle_knowledge_batches(id),
  external_id text NOT NULL,
  entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  record jsonb NOT NULL,
  PRIMARY KEY(batch_id,external_id)
);
CREATE INDEX vehicle_knowledge_records_entity_idx ON vehicle_knowledge_records(entity_id,batch_id);
CREATE TABLE vehicle_knowledge_publications (
  source_key text NOT NULL REFERENCES vehicle_data_sources(key), external_id text NOT NULL,
  batch_id uuid NOT NULL, PRIMARY KEY(source_key,external_id),
  FOREIGN KEY(batch_id,external_id) REFERENCES vehicle_knowledge_records(batch_id,external_id)
);
CREATE TABLE vehicle_reference_revisions (
  batch_id uuid NOT NULL REFERENCES vehicle_knowledge_batches(id),
  entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  external_id text NOT NULL,
  reference_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('consumption','charging','fact')),
  quality text NOT NULL CHECK(quality IN ('verified','source_reported','engineering_estimate','quarantined')),
  payload jsonb NOT NULL,
  PRIMARY KEY(batch_id,entity_id,reference_id)
);
CREATE INDEX vehicle_reference_revisions_entity_idx ON vehicle_reference_revisions(entity_id,kind,batch_id);
CREATE TABLE vehicle_profile_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  batch_id uuid NOT NULL REFERENCES vehicle_knowledge_batches(id),
  profile_version text NOT NULL,
  policy text NOT NULL CHECK(policy IN ('verified_only','allow_engineering_estimates')),
  checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  UNIQUE(batch_id,entity_id,policy)
);
CREATE TABLE vehicle_profile_publications (
  entity_id uuid NOT NULL REFERENCES catalogue_entities(id),
  policy text NOT NULL CHECK(policy IN ('verified_only','allow_engineering_estimates')),
  revision_id uuid NOT NULL REFERENCES vehicle_profile_revisions(id),
  PRIMARY KEY(entity_id,policy)
);
-- Revisions and accepted evidence are append-only. Publication pointers may advance.
CREATE FUNCTION reject_vehicle_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Vehicle knowledge revisions are immutable'; END;
$$;
CREATE TRIGGER immutable_vehicle_profiles BEFORE UPDATE OR DELETE ON vehicle_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_vehicle_references BEFORE UPDATE OR DELETE ON vehicle_reference_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();
CREATE TRIGGER immutable_vehicle_records BEFORE UPDATE OR DELETE ON vehicle_knowledge_records
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_revision_mutation();

-- Flat source projection, built only during import. It never joins public reads to remote data.
CREATE VIEW open_ev_catalogue_projection AS
SELECT v.id AS legacy_id, v.source_key, v.source_vehicle_id,
  ma.slug AS make_slug, mo.slug AS model_slug, v.model_year, v.markets, v.is_active,
  concat_ws(' ',ma.name,mo.name,v.trim_name,v.variant_name) AS search_text,
  jsonb_build_object(
    'make',ma.name,'makeSlug',ma.slug,'model',mo.name,'modelSlug',mo.slug,'modelYear',v.model_year,
    'trim',v.trim_name,'trimSlug',v.trim_slug,'variant',v.variant_name,'variantSlug',v.variant_slug,
    'vehicleType',v.vehicle_type,'markets',v.markets,'usableBatteryKwh',v.usable_battery_kwh,
    'grossBatteryKwh',v.gross_battery_kwh,'maxAcChargeKw',v.max_ac_charge_kw,'maxDcChargeKw',v.max_dc_charge_kw,
    'consumptionKwhPer100Km',cp.consumption_kwh_per_100km,'consumptionBasis',cp.basis,'isActive',v.is_active,
    'connectorTypes',COALESCE((SELECT jsonb_agg(connector ORDER BY connector) FROM
      (SELECT DISTINCT connector FROM vehicle_charge_ports WHERE vehicle_id=v.id) p),'[]'::jsonb),
    'chargePorts',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'connector',connector) ORDER BY ordinal)
      FROM vehicle_charge_ports WHERE vehicle_id=v.id),'[]'::jsonb),
    'rangeRatings',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'profile',profile,'rangeKm',range_km,'conditions',conditions) ORDER BY ordinal)
      FROM vehicle_range_ratings WHERE vehicle_id=v.id),'[]'::jsonb),
    'dcChargeCurve',(SELECT jsonb_build_object('type',c.curve_type,'conditions',c.conditions,'sourceUrl',c.source_url,
      'points',(SELECT jsonb_agg(jsonb_build_object('socPercent',soc_percent,'powerKw',power_kw,'currentA',current_a,'voltageV',voltage_v) ORDER BY soc_percent)
        FROM vehicle_charge_curve_points WHERE vehicle_id=v.id)) FROM vehicle_charge_curves c WHERE c.vehicle_id=v.id),
    'source',jsonb_build_object('key',ds.key,'name',ds.name,'license',ds.license,'homepageUrl',ds.homepage_url,
      'vehicleId',v.source_vehicle_id,'version',im.source_version,'schemaVersion',im.schema_version,
      'generatedAt',im.source_generated_at,'fetchedAt',im.fetched_at,'sourceUpdatedAt',v.source_updated_at)
  ) AS detail
FROM vehicle_variants v JOIN vehicle_models mo ON mo.id=v.model_id JOIN vehicle_makes ma ON ma.id=mo.make_id
JOIN vehicle_data_sources ds ON ds.key=v.source_key JOIN vehicle_imports im ON im.id=v.last_import_id
LEFT JOIN vehicle_consumption_profiles cp ON cp.vehicle_id=v.id;

CREATE FUNCTION sync_open_ev_catalogue() RETURNS void LANGUAGE plpgsql AS $$
DECLARE row_record record; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chargeroad:catalogue-publication'));
  -- The source importer already owns the source advisory lock. Opaque IDs are generated once.
  FOR row_record IN SELECT v.source_key,v.source_vehicle_id,v.id FROM vehicle_variants v
    LEFT JOIN catalogue_bindings b ON b.source_key=v.source_key AND b.external_id=v.source_vehicle_id
    WHERE b.entity_id IS NULL ORDER BY v.id
  LOOP
    INSERT INTO catalogue_entities DEFAULT VALUES RETURNING id INTO new_id;
    INSERT INTO catalogue_bindings(source_key,external_id,entity_id,legacy_id,match_basis)
      VALUES(row_record.source_key,row_record.source_vehicle_id,new_id,row_record.id,'source_record_identity_only');
  END LOOP;
  INSERT INTO catalogue_entries(entity_id,primary_source,make_slug,model_slug,model_year,markets,search_text,is_active,detail)
  SELECT b.entity_id,p.source_key,p.make_slug,p.model_slug,p.model_year,p.markets,p.search_text,p.is_active,
    p.detail || jsonb_build_object('id',b.entity_id::text)
  FROM open_ev_catalogue_projection p JOIN catalogue_bindings b ON b.source_key=p.source_key AND b.external_id=p.source_vehicle_id
  ON CONFLICT(entity_id) DO UPDATE SET make_slug=EXCLUDED.make_slug,model_slug=EXCLUDED.model_slug,
    model_year=EXCLUDED.model_year,markets=EXCLUDED.markets,search_text=EXCLUDED.search_text,
    is_active=EXCLUDED.is_active,detail=EXCLUDED.detail,updated_at=now()
  WHERE catalogue_entries.primary_source=EXCLUDED.primary_source AND catalogue_entries.detail IS DISTINCT FROM EXCLUDED.detail;
END;
$$;
SELECT sync_open_ev_catalogue();
