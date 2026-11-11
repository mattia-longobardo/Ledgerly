-- PERS-335: a manual service keeps only its value — deposits, withdrawals and the value typed from
-- the broker, no positions. Every manual service still in the per-asset mode is converted, as the
-- old "Switch to total mode" did (docs/design/investments.md §2.5): a new `total` period from now
-- and an account valuation equal to the value the account shows, so V and the net money put in do
-- not change. A service with positions is not converted by guess: the migration stops.
DO $$
DECLARE
  service record;
  value_cents bigint;
  opened_on date;
  event_id uuid;
  converted_at timestamptz := now();
BEGIN
  FOR service IN
    SELECT current.investment_account_id, current.user_id, current.starts_at, ia.account_id,
           coalesce(prefs.time_zone, 'Europe/Rome') AS time_zone
    FROM (
      SELECT DISTINCT ON (period.investment_account_id) period.*
      FROM investment_account_periods period
      ORDER BY period.investment_account_id, period.starts_at DESC
    ) current
    JOIN investment_accounts ia ON ia.id = current.investment_account_id
    LEFT JOIN user_preferences prefs ON prefs.user_id = current.user_id
    WHERE current.origin = 'manual' AND current.mode = 'assets'
    ORDER BY current.investment_account_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM investment_holdings holding
      WHERE holding.investment_account_id = service.investment_account_id
    ) THEN
      RAISE EXCEPTION 'manual service % keeps positions: convert it by hand', service.investment_account_id;
    END IF;

    opened_on := (converted_at AT TIME ZONE service.time_zone)::date;
    -- The value the account shows today: its last point on or before today (§1.3, the only writer).
    SELECT entry.balance_cents INTO value_cents
    FROM balance_entries entry
    WHERE entry.account_id = service.account_id AND entry.source = 'portfolio' AND entry.on <= opened_on
    ORDER BY entry.on DESC, entry.captured_at DESC
    LIMIT 1;
    IF value_cents IS NULL THEN
      RAISE EXCEPTION 'manual service % has no value to convert', service.investment_account_id;
    END IF;

    INSERT INTO investment_account_periods
      (user_id, investment_account_id, from_on, starts_at, mode, origin, reason)
    VALUES
      (service.user_id, service.investment_account_id, opened_on,
       greatest(converted_at, service.starts_at + interval '1 millisecond'), 'total', 'manual', 'conversion');

    INSERT INTO investment_events (user_id, investment_account_id, occurred_at, "on", origin)
    VALUES (service.user_id, service.investment_account_id,
            greatest(converted_at, service.starts_at + interval '1 millisecond'), opened_on, 'conversion')
    RETURNING id INTO event_id;

    INSERT INTO investment_operations (user_id, event_id, leg, kind, amount_cents)
    VALUES (service.user_id, event_id, 'main', 'account_valuation', value_cents);
  END LOOP;
END $$;
