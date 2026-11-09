CREATE TABLE api_rate_limit_days (
  ip_key text NOT NULL CHECK (length(ip_key) = 64),
  local_day date NOT NULL,
  strikes integer NOT NULL DEFAULT 0 CHECK (strikes >= 0),
  blocked_until timestamptz,
  windows jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (ip_key, local_day)
);
CREATE INDEX api_rate_limit_expiry_idx ON api_rate_limit_days(expires_at);

-- One atomic operation shared by every API instance. Only one row per IP/day;
-- policy counters overwrite their previous window rather than growing forever.
CREATE FUNCTION consume_api_rate_limit(
  p_ip_key text, p_policy text, p_limit integer, p_window_seconds integer,
  p_strike_limit integer, p_timezone text, p_now timestamptz
) RETURNS TABLE(outcome text, remaining integer, strikes integer, retry_after_seconds integer)
LANGUAGE plpgsql SET lock_timeout = '250ms' AS $$
DECLARE
  v_day date := (p_now AT TIME ZONE p_timezone)::date;
  v_end timestamptz := (v_day + 1)::timestamp AT TIME ZONE p_timezone;
  v_epoch bigint := floor(extract(epoch FROM p_now) / p_window_seconds)::bigint * p_window_seconds;
  v_state api_rate_limit_days%ROWTYPE;
  v_window jsonb;
  v_count integer;
  v_struck boolean;
BEGIN
  IF p_limit < 1 OR p_limit > 1000000 OR p_window_seconds < 1 OR p_strike_limit < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit policy';
  END IF;
  -- Already-blocked traffic needs an indexed read only: no counter write or row lock.
  SELECT d.* INTO v_state FROM api_rate_limit_days d
    WHERE d.ip_key=p_ip_key AND d.local_day=v_day;
  IF FOUND AND v_state.blocked_until IS NOT NULL AND v_state.blocked_until > p_now THEN
    RETURN QUERY SELECT 'blocked'::text, 0, v_state.strikes,
      greatest(1, ceil(extract(epoch FROM v_state.blocked_until-p_now))::integer);
    RETURN;
  END IF;
  INSERT INTO api_rate_limit_days(ip_key, local_day, expires_at)
    VALUES(p_ip_key, v_day, v_end) ON CONFLICT DO NOTHING;
  SELECT d.* INTO v_state FROM api_rate_limit_days d
    WHERE d.ip_key=p_ip_key AND d.local_day=v_day FOR UPDATE;
  IF v_state.blocked_until IS NOT NULL AND v_state.blocked_until > p_now THEN
    RETURN QUERY SELECT 'blocked'::text, 0, v_state.strikes,
      greatest(1, ceil(extract(epoch FROM v_state.blocked_until-p_now))::integer);
    RETURN;
  END IF;
  v_window := v_state.windows -> p_policy;
  IF v_window IS NULL OR (v_window ->> 'epoch')::bigint <> v_epoch THEN
    v_count := 0;
    v_struck := false;
  ELSE
    v_count := (v_window ->> 'count')::integer;
    v_struck := (v_window ->> 'struck')::boolean;
  END IF;
  v_count := least(v_count + 1, p_limit + 1);
  IF v_count > p_limit AND NOT v_struck THEN
    v_state.strikes := v_state.strikes + 1;
    v_struck := true;
  END IF;
  IF v_state.strikes >= p_strike_limit THEN v_state.blocked_until := v_end; END IF;
  UPDATE api_rate_limit_days d SET
    windows=jsonb_set(v_state.windows, ARRAY[p_policy],
      jsonb_build_object('epoch',v_epoch,'count',v_count,'struck',v_struck), true),
    strikes=v_state.strikes, blocked_until=v_state.blocked_until
    WHERE d.ip_key=p_ip_key AND d.local_day=v_day;
  IF v_state.blocked_until IS NOT NULL THEN
    RETURN QUERY SELECT 'blocked'::text, 0, v_state.strikes,
      greatest(1, ceil(extract(epoch FROM v_end-p_now))::integer);
  ELSIF v_count > p_limit THEN
    RETURN QUERY SELECT 'limited'::text, 0, v_state.strikes,
      greatest(1, ceil(extract(epoch FROM least(to_timestamp(v_epoch+p_window_seconds),v_end)-p_now))::integer);
  ELSE
    RETURN QUERY SELECT 'allowed'::text, p_limit-v_count, v_state.strikes, 0;
  END IF;
END;
$$;
