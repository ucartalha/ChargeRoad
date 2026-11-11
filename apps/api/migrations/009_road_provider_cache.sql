-- Request keys are HMACs; do not store submitted coordinate requests or API credentials.
CREATE TABLE road_response_cache (
  request_key text PRIMARY KEY,provider_id text NOT NULL,payload jsonb,
  expires_at timestamptz NOT NULL DEFAULT '-infinity',token uuid,generation bigint NOT NULL DEFAULT 0,
  lease_until timestamptz
);
CREATE INDEX road_response_cache_expiry_idx ON road_response_cache(expires_at);
CREATE TABLE road_provider_budget (
  provider_id text PRIMARY KEY,day date NOT NULL,used integer NOT NULL CHECK(used>=0),
  next_allowed_at timestamptz NOT NULL,blocked_until timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE osm_way_attributes (
  provider_id text NOT NULL,way_id bigint NOT NULL CHECK(way_id>0),tags jsonb NOT NULL,
  source_updated_at timestamptz,retrieved_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
  license text NOT NULL CHECK(license='ODbL-1.0'),PRIMARY KEY(provider_id,way_id)
);
CREATE INDEX osm_way_attributes_expiry_idx ON osm_way_attributes(expires_at);
