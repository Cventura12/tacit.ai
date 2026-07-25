CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key            TEXT,
  p_window_seconds INTEGER,
  p_max            INTEGER
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INTEGER;
BEGIN
  v_window_start := to_timestamp(
    (EXTRACT(EPOCH FROM NOW())::BIGINT / p_window_seconds) * p_window_seconds
  );
  INSERT INTO rate_limit_buckets (key, count, window_start)
  VALUES (p_key, 1, v_window_start)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN rate_limit_buckets.window_start < v_window_start THEN 1
                  ELSE rate_limit_buckets.count + 1
                END,
        window_start = GREATEST(rate_limit_buckets.window_start, v_window_start)
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END;
$$;