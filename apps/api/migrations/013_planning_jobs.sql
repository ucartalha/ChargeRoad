CREATE TABLE planning_jobs (
 id uuid PRIMARY KEY,
 owner_hash text NOT NULL CHECK(owner_hash ~ '^[a-f0-9]{64}$'),
 request_hash text, request_payload jsonb,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
 result_payload jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 lease_token uuid, generation bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 CHECK(status NOT IN ('queued','running') OR request_payload IS NOT NULL),
 CHECK(status<>'completed' OR result_payload IS NOT NULL)
);
CREATE INDEX planning_jobs_queue_idx ON planning_jobs(created_at) WHERE status IN ('queued','running');
CREATE INDEX planning_jobs_expiry_idx ON planning_jobs(expires_at);
