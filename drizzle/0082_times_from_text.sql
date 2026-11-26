-- The day and the time of the operation for the movements read before the bank's text was parsed
-- (`plugins/enablebanking/src/times.ts`, same wording): the bank gives about 90 days only, so a new
-- reading cannot give them back. Same rules as a reading: a time on a day after the stored one is not
-- the operation's, the instant must fall on its own day in the person's zone, a time the person set is
-- kept. Data only; recovery is the release's dump.
WITH found AS (
  SELECT t.id, z.zone, (t.occurred_at AT TIME ZONE z.zone)::date AS stored_day,
    regexp_match(t.raw_text, '\mdel\s+(\d{2})/(\d{2})/(\d{4})\s+alle\s+ore\s+(\d{2})[:.](\d{2})\M', 'i') AS m
  FROM "transactions" t
  -- The person's zone; without preferences, the default one (`users/rules.ts`).
  CROSS JOIN LATERAL (
    SELECT coalesce((SELECT p.time_zone FROM "user_preferences" p WHERE p.user_id = t.user_id), 'Europe/Rome') AS zone
  ) z
  WHERE t.origin = 'provider' AND NOT t.time_known AND NOT ('occurredAt' = ANY(t.locally_edited))
    AND t.raw_text ~* '\mdel\s+\d{2}/\d{2}/\d{4}\s+alle\s+ore\s+\d{2}[:.]\d{2}\M'
), parts AS (
  SELECT id, zone, stored_day, m[1]::int AS d, m[2]::int AS mo, m[3]::int AS y, m[4]::int AS h, m[5]::int AS mi
  FROM found
), stamped AS (
  -- A day or a time that does not exist (31/04, 24:00) is not a time the bank gave: 31/04 rolls to May.
  SELECT id, zone, stored_day, day, (day + make_time(h, mi, 0)) AT TIME ZONE 'Europe/Rome' AS instant
  FROM (
    SELECT *, make_date(y, mo, 1) + (d - 1) AS day FROM parts
    WHERE y >= 1 AND mo BETWEEN 1 AND 12 AND d BETWEEN 1 AND 31 AND h < 24 AND mi < 60
  ) c
  WHERE extract(month FROM day) = mo
)
UPDATE "transactions" AS t SET "occurred_at" = s.instant, "time_known" = true
FROM stamped s
WHERE t.id = s.id AND s.day <= s.stored_day AND (s.instant AT TIME ZONE s.zone)::date = s.day;
