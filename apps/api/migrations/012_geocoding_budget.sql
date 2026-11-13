-- Shared development geocoder budget; no IP/user identity or raw search query is stored.
CREATE TABLE geocoding_provider_budget (
  provider_key text PRIMARY KEY,
  day date NOT NULL,
  requests integer NOT NULL CHECK (requests >= 0),
  next_at timestamptz NOT NULL
);
CREATE TABLE geocoding_search_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX geocoding_cache_expiry ON geocoding_search_cache(expires_at);
