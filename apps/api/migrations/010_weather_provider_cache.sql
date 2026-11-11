CREATE TABLE weather_forecast_cache (
  request_key text PRIMARY KEY, provider_id text NOT NULL, document jsonb,
  expires_at timestamptz NOT NULL DEFAULT '-infinity', retain_until timestamptz NOT NULL DEFAULT '-infinity',
  token uuid, generation bigint NOT NULL DEFAULT 0, lease_until timestamptz,
  retry_at timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE INDEX weather_cache_expiry_idx ON weather_forecast_cache(retain_until);
CREATE INDEX weather_cache_active_idx ON weather_forecast_cache(provider_id,lease_until) WHERE token IS NOT NULL;
CREATE TABLE weather_provider_state (
  provider_id text PRIMARY KEY, day date NOT NULL, used integer NOT NULL DEFAULT 0 CHECK(used>=0),
  next_allowed_at timestamptz NOT NULL DEFAULT '-infinity', blocked_until timestamptz NOT NULL DEFAULT '-infinity',
  blocked_kind text NOT NULL DEFAULT 'provider_unavailable' CHECK(blocked_kind IN ('provider_unavailable','budget_exhausted'))
);
