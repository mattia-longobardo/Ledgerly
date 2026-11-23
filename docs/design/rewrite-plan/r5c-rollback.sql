-- Release R5c, step P5 "Import CSV" (decision ST-8): the way back for the database, before the one of
-- step P3a below. Run this block first, alone, to go back to the image of P3a.
--
-- The step adds one table, `csv_column_maps`, which the image before it never reads. The movements
-- an import wrote are manual movements (`origin = 'manual'`, `idempotency_key` `csv:<hash>`) that
-- the image before reads as any other: they stay. Lost: the maps saved per account.
BEGIN;
DROP TABLE IF EXISTS csv_column_maps;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795600000000;
COMMIT;

-- Release R5c, step P3a "Wallet e Trek come plugin": the way back for the database, before the one of
-- step P2 below (docs/design/rewrite-plan/03-releases.md "R5c"). Run this block first, alone, to go
-- back to the image of P2; run the block of P2 after it only if P2 is not coming back either.
--
-- The step renames the providers `wallet` and `trek` to `plugin:wallet` and `plugin:trek` (the
-- image before it knows only the old names), turns the plugins on for the people who have a
-- connection, writes `external` for the days of Trek and turns the interest rules that published to
-- `analyze_only`. Reversed in reverse order. Two things do not come back: which rules published
-- (none in production at the release: 0 rows with `post_to_provider`), and an activation a person
-- made after the release (the image before reads none).
BEGIN;
UPDATE leave_days SET origin = 'trek' WHERE origin = 'external';
DELETE FROM plugin_activations WHERE plugin_id IN ('wallet', 'trek');
UPDATE account_switches SET to_provider = 'wallet' WHERE to_provider = 'plugin:wallet';
UPDATE account_switches SET from_provider = 'wallet' WHERE from_provider = 'plugin:wallet';
UPDATE accounts SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE accounts SET provider = 'wallet' WHERE provider = 'plugin:wallet';
UPDATE source_skipped_accounts SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE source_skipped_accounts SET provider = 'wallet' WHERE provider = 'plugin:wallet';
UPDATE source_settings SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE source_settings SET provider = 'wallet' WHERE provider = 'plugin:wallet';
UPDATE source_categories SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE source_categories SET provider = 'wallet' WHERE provider = 'plugin:wallet';
UPDATE provider_links SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE provider_links SET provider = 'wallet' WHERE provider = 'plugin:wallet';
UPDATE integration_connections SET provider = 'trek' WHERE provider = 'plugin:trek';
UPDATE integration_connections SET provider = 'wallet' WHERE provider = 'plugin:wallet';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795590000000;
COMMIT;

-- Release R5c, step P2 "Trek come plugin": the way back for the database (docs/design/rewrite-plan/03-releases.md "R5c").
--
-- The step adds three nullable columns to `leave_days` (`external_kind`, `external_fraction`,
-- `external_state`) and lets `origin` be `external` beside `trek`. The image before it never reads
-- the new columns and writes no `external` origin, so the rollback is the images:
--
--   docker tag ledgerly:pre-r5c ledgerly:latest && docker tag ledgerly-web:pre-r5c ledgerly-web:latest
--   docker compose up -d --no-build
--
-- Run this file only if the step is not coming back: it drops the columns, restores the two checks
-- as they were and removes the migration from the journal, so that a new deploy applies it again.
-- It loses nothing: the new columns are a copy of `trek_*`, and `refused` is written again by the
-- next pass. A row with `origin = 'external'` cannot exist before P3; one found stops the rollback.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM leave_days WHERE origin = 'external') THEN
    RAISE EXCEPTION 'R5c rollback: leave_days has rows of origin external; rename them to trek first';
  END IF;
END $$;
ALTER TABLE leave_days DROP CONSTRAINT IF EXISTS leave_days_external_ck;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_kind;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_fraction;
ALTER TABLE leave_days DROP COLUMN IF EXISTS external_state;
ALTER TABLE leave_days DROP CONSTRAINT leave_days_origin_ck;
ALTER TABLE leave_days ADD CONSTRAINT leave_days_origin_ck CHECK (origin in ('manual', 'trek'));
ALTER TABLE leave_days DROP CONSTRAINT leave_days_pending_delete_ck;
ALTER TABLE leave_days ADD CONSTRAINT leave_days_pending_delete_ck
  CHECK (pending <> 'delete' or origin = 'trek' or synced_at is not null);
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795580000000;
COMMIT;
