-- Provider execution is shared by API/CLI workers; no network calls run inside these transactions.
CREATE TABLE station_provider_jobs (
  provider_key text PRIMARY KEY, token uuid, generation bigint NOT NULL DEFAULT 0,
  lease_until timestamptz, blocked_until timestamptz NOT NULL DEFAULT '-infinity',
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0)
);
CREATE TABLE station_catalogue_materializations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL,policy jsonb NOT NULL,snapshot_ids jsonb NOT NULL
);
