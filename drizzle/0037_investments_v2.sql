CREATE TABLE "investment_account_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"from_on" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"origin" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_account_periods_start_uq" UNIQUE("investment_account_id","starts_at"),
	CONSTRAINT "investment_account_periods_mode_ck" CHECK ("investment_account_periods"."mode" in ('assets', 'total')),
	CONSTRAINT "investment_account_periods_origin_ck" CHECK ("investment_account_periods"."origin" in ('manual', 'synced')),
	CONSTRAINT "investment_account_periods_reason_ck" CHECK ("investment_account_periods"."reason" in ('opening', 'migration', 'handover', 'conversion'))
);
--> statement-breakpoint
CREATE TABLE "investment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"managed_since" date NOT NULL,
	"url" text,
	"opened_on" date,
	"closed_on" date,
	"legacy_platform_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_accounts_account_uq" UNIQUE("account_id"),
	CONSTRAINT "investment_accounts_category_ck" CHECK ("investment_accounts"."category" in ('accounts', 'broker', 'crypto')),
	CONSTRAINT "investment_accounts_provider_ck" CHECK (length("investment_accounts"."provider") between 1 and 40),
	CONSTRAINT "investment_accounts_url_ck" CHECK ("investment_accounts"."url" is null or ("investment_accounts"."url" ~ '^https?://' and length("investment_accounts"."url") <= 500))
);
--> statement-breakpoint
CREATE TABLE "investment_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"class" text NOT NULL,
	"name" text NOT NULL,
	"isin" text,
	"symbol" text,
	"mic" text,
	"currency" text NOT NULL,
	"price_source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_assets_class_ck" CHECK ("investment_assets"."class" in ('stock', 'etf', 'fund', 'bond', 'crypto', 'stablecoin', 'cash', 'other')),
	CONSTRAINT "investment_assets_name_ck" CHECK (length(btrim("investment_assets"."name")) between 1 and 120),
	CONSTRAINT "investment_assets_isin_ck" CHECK ("investment_assets"."isin" is null or "investment_assets"."isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
	CONSTRAINT "investment_assets_symbol_ck" CHECK ("investment_assets"."symbol" is null or length(btrim("investment_assets"."symbol")) between 1 and 20),
	CONSTRAINT "investment_assets_mic_ck" CHECK ("investment_assets"."mic" is null or "investment_assets"."mic" ~ '^[A-Z0-9]{4}$'),
	CONSTRAINT "investment_assets_currency_ck" CHECK ("investment_assets"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "investment_assets_price_source_ck" CHECK ("investment_assets"."price_source" in ('manual', 'provider', 'market'))
);
--> statement-breakpoint
CREATE TABLE "investment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"on" date NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "investment_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"origin" text NOT NULL,
	"transfer_group_id" uuid,
	"transaction_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_events_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "investment_events_origin_ck" CHECK ("investment_events"."origin" in ('manual', 'provider', 'conversion')),
	CONSTRAINT "investment_events_note_ck" CHECK ("investment_events"."note" is null or length(btrim("investment_events"."note")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "investment_holdings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"product" text NOT NULL,
	"opened_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_holdings_uq" UNIQUE("investment_account_id","asset_id","origin","product"),
	CONSTRAINT "investment_holdings_origin_ck" CHECK ("investment_holdings"."origin" in ('manual', 'provider')),
	CONSTRAINT "investment_holdings_product_ck" CHECK ("investment_holdings"."product" ~ '^(spot|funding|earn|staking|custody|other:[a-z0-9_-]{1,30})$')
);
--> statement-breakpoint
CREATE TABLE "investment_operation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"operation_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "investment_operation_revisions_reason_ck" CHECK ("investment_operation_revisions"."reason" in ('edited', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "investment_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"leg" text NOT NULL,
	"holding_id" uuid,
	"kind" text NOT NULL,
	"quantity" numeric(38, 18),
	"unit_price" numeric(30, 12),
	"price_currency" text,
	"native_amount" numeric(30, 12),
	"native_currency" text,
	"fx_rate" numeric(20, 10),
	"fx_source" text,
	"amount_cents" bigint NOT NULL,
	"valid_until" date,
	"quantity_basis" text DEFAULT 'reported' NOT NULL,
	CONSTRAINT "investment_operations_leg_uq" UNIQUE("event_id","leg"),
	CONSTRAINT "investment_operations_leg_ck" CHECK ("investment_operations"."leg" in ('main', 'base', 'quote', 'fee')),
	CONSTRAINT "investment_operations_kind_ck" CHECK ("investment_operations"."kind" in ('opening_cash', 'opening_position', 'deposit', 'withdrawal', 'buy', 'sell', 'valuation', 'close', 'income', 'fee', 'account_valuation', 'adjustment')),
	CONSTRAINT "investment_operations_basis_ck" CHECK ("investment_operations"."quantity_basis" in ('reported', 'reconstructed', 'inferred')),
	CONSTRAINT "investment_operations_sign_ck" CHECK (("investment_operations"."kind" not in ('deposit', 'sell', 'close', 'income') or "investment_operations"."amount_cents" >= 0) and ("investment_operations"."kind" not in ('withdrawal', 'buy', 'fee') or "investment_operations"."amount_cents" <= 0)),
	CONSTRAINT "investment_operations_quantity_ck" CHECK ("investment_operations"."quantity" is null or "investment_operations"."quantity" > 0),
	CONSTRAINT "investment_operations_price_ck" CHECK ("investment_operations"."unit_price" is null or "investment_operations"."unit_price" >= 0),
	CONSTRAINT "investment_operations_valid_until_ck" CHECK ("investment_operations"."valid_until" is null or "investment_operations"."kind" = 'adjustment'),
	CONSTRAINT "investment_operations_price_currency_ck" CHECK ("investment_operations"."price_currency" is null or "investment_operations"."price_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "investment_reading_positions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"product" text NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"price" numeric(30, 12),
	"price_currency" text,
	"price_at" timestamp with time zone,
	"price_source" text,
	"fx_rate" numeric(20, 10),
	"fx_source" text,
	"value_cents" bigint,
	CONSTRAINT "investment_reading_positions_product_ck" CHECK ("investment_reading_positions"."product" ~ '^(spot|funding|earn|staking|custody|other:[a-z0-9_-]{1,30})$')
);
--> statement-breakpoint
CREATE TABLE "investment_reading_scopes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"external_account_id" text NOT NULL,
	"product" text NOT NULL,
	"complete" boolean NOT NULL,
	CONSTRAINT "investment_reading_scopes_uq" UNIQUE("reading_id","external_account_id","product"),
	CONSTRAINT "investment_reading_scopes_product_ck" CHECK ("investment_reading_scopes"."product" ~ '^(spot|funding|earn|staking|custody|other:[a-z0-9_-]{1,30})$')
);
--> statement-breakpoint
CREATE TABLE "investment_readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"on" date NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"cash_cents" bigint,
	"native_total" numeric(30, 12),
	"fx_rate" numeric(20, 10),
	"fx_source" text,
	"missing_prices" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "investment_readings_account_on_uq" UNIQUE("investment_account_id","on"),
	CONSTRAINT "investment_readings_status_ck" CHECK ("investment_readings"."status" in ('complete', 'partial', 'confirmed_zero', 'pending_zero')),
	CONSTRAINT "investment_readings_missing_ck" CHECK ("investment_readings"."missing_prices" >= 0)
);
--> statement-breakpoint
CREATE TABLE "investment_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(38, 18),
	"reading_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "investment_reconciliations_kind_ck" CHECK ("investment_reconciliations"."kind" in ('covered_by_provider', 'outside_scope', 'partial', 'reopened')),
	CONSTRAINT "investment_reconciliations_quantity_ck" CHECK (("investment_reconciliations"."kind" = 'partial') = ("investment_reconciliations"."quantity" is not null))
);
--> statement-breakpoint
CREATE TABLE "investment_superseded_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"balance_entry_id" uuid NOT NULL,
	"on" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"available_cents" bigint,
	"source" text NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_account_periods" ADD CONSTRAINT "investment_account_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_account_periods" ADD CONSTRAINT "investment_account_periods_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_assets" ADD CONSTRAINT "investment_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_events" ADD CONSTRAINT "investment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_events" ADD CONSTRAINT "investment_events_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_events" ADD CONSTRAINT "investment_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operation_revisions" ADD CONSTRAINT "investment_operation_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operation_revisions" ADD CONSTRAINT "investment_operation_revisions_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_event_id_investment_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."investment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_holding_id_investment_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."investment_holdings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reading_positions" ADD CONSTRAINT "investment_reading_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reading_positions" ADD CONSTRAINT "investment_reading_positions_reading_id_investment_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."investment_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reading_positions" ADD CONSTRAINT "investment_reading_positions_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reading_scopes" ADD CONSTRAINT "investment_reading_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reading_scopes" ADD CONSTRAINT "investment_reading_scopes_reading_id_investment_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."investment_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_readings" ADD CONSTRAINT "investment_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_readings" ADD CONSTRAINT "investment_readings_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reconciliations" ADD CONSTRAINT "investment_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reconciliations" ADD CONSTRAINT "investment_reconciliations_holding_id_investment_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."investment_holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reconciliations" ADD CONSTRAINT "investment_reconciliations_reading_id_investment_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."investment_readings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_superseded_entries" ADD CONSTRAINT "investment_superseded_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_superseded_entries" ADD CONSTRAINT "investment_superseded_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_account_periods_user_idx" ON "investment_account_periods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_accounts_user_idx" ON "investment_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_assets_isin_uq" ON "investment_assets" USING btree ("user_id","isin") WHERE "investment_assets"."isin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_assets_symbol_uq" ON "investment_assets" USING btree ("user_id","class","symbol",coalesce("mic", '')) WHERE "investment_assets"."symbol" is not null;--> statement-breakpoint
CREATE INDEX "investment_events_account_on_idx" ON "investment_events" USING btree ("investment_account_id","on");--> statement-breakpoint
CREATE INDEX "investment_events_user_idx" ON "investment_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_holdings_user_idx" ON "investment_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_operation_revisions_event_idx" ON "investment_operation_revisions" USING btree ("event_id","changed_at");--> statement-breakpoint
CREATE INDEX "investment_operation_revisions_user_idx" ON "investment_operation_revisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_operations_holding_idx" ON "investment_operations" USING btree ("holding_id");--> statement-breakpoint
CREATE INDEX "investment_operations_user_idx" ON "investment_operations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_reading_positions_reading_idx" ON "investment_reading_positions" USING btree ("reading_id");--> statement-breakpoint
CREATE INDEX "investment_reading_positions_user_idx" ON "investment_reading_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_reading_scopes_user_idx" ON "investment_reading_scopes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_readings_user_idx" ON "investment_readings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_reconciliations_holding_idx" ON "investment_reconciliations" USING btree ("holding_id","effective_on");--> statement-breakpoint
CREATE INDEX "investment_reconciliations_user_idx" ON "investment_reconciliations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_superseded_entries_account_idx" ON "investment_superseded_entries" USING btree ("account_id","on");--> statement-breakpoint
CREATE INDEX "investment_superseded_entries_user_idx" ON "investment_superseded_entries" USING btree ("user_id");--> statement-breakpoint
-- ——— Data (docs/design/investments.md §2.3, D4) ——————————————————————————————————————————————
-- 1. Every legacy platform becomes a new account (no account represents one: phase 0), in `total`
--    mode, with its movements as deposit/withdrawal events and its valuations as account
--    valuations. A valuation is the value at the end of its day, so it is ordered after that day's
--    movements. The legacy rows keep their ids as the events' ids: the rollback maps them back.
CREATE TEMP TABLE "investments_v2_platforms" ON COMMIT DROP AS
SELECT
  p."id" AS "platform_id",
  p."user_id",
  p."name",
  p."url",
  uuidv7() AS "account_id",
  uuidv7() AS "investment_account_id",
  CASE WHEN p."name" ~* '(binance|kraken|coinbase|bitvavo|crypto\.com)' THEN 'crypto' ELSE 'investment' END AS "type",
  LEAST(
    (SELECT min(m."on") FROM "investment_movements" m WHERE m."platform_id" = p."id"),
    (SELECT min(v."on") FROM "investment_valuations" v WHERE v."platform_id" = p."id"),
    p."created_at"::date
  ) AS "first_on"
FROM "investment_platforms" p;
--> statement-breakpoint
INSERT INTO "accounts" ("id", "user_id", "name", "type", "currency", "origin", "state", "counts_as_liquid", "sort_order")
SELECT
  t."account_id", t."user_id", left(t."name", 80), t."type", 'EUR', 'manual', 'active', false,
  (SELECT coalesce(max(a."sort_order"), -1) FROM "accounts" a WHERE a."user_id" = t."user_id")
    + row_number() OVER (PARTITION BY t."user_id" ORDER BY t."name", t."platform_id")
FROM "investments_v2_platforms" t;
--> statement-breakpoint
INSERT INTO "investment_accounts" ("id", "user_id", "account_id", "category", "provider", "managed_since", "url", "opened_on", "legacy_platform_id")
SELECT t."investment_account_id", t."user_id", t."account_id",
  CASE WHEN t."type" = 'crypto' THEN 'crypto' ELSE 'broker' END,
  'manual', t."first_on", t."url", t."first_on", t."platform_id"
FROM "investments_v2_platforms" t;
--> statement-breakpoint
INSERT INTO "investment_account_periods" ("user_id", "investment_account_id", "from_on", "starts_at", "mode", "origin", "reason")
SELECT t."user_id", t."investment_account_id", t."first_on", t."first_on"::timestamp AT TIME ZONE 'UTC', 'total', 'manual', 'migration'
FROM "investments_v2_platforms" t;
--> statement-breakpoint
INSERT INTO "investment_events" ("id", "user_id", "investment_account_id", "occurred_at", "on", "origin", "transaction_id", "note")
SELECT m."id", m."user_id", t."investment_account_id", (m."on" + time '12:00') AT TIME ZONE 'UTC', m."on", 'manual', m."transaction_id", m."note"
FROM "investment_movements" m JOIN "investments_v2_platforms" t ON t."platform_id" = m."platform_id"
ORDER BY m."on", m."created_at", m."id";
--> statement-breakpoint
INSERT INTO "investment_operations" ("user_id", "event_id", "leg", "kind", "amount_cents")
SELECT m."user_id", m."id", 'main', m."kind", CASE WHEN m."kind" = 'deposit' THEN m."amount_cents" ELSE -m."amount_cents" END
FROM "investment_movements" m JOIN "investments_v2_platforms" t ON t."platform_id" = m."platform_id";
--> statement-breakpoint
INSERT INTO "investment_events" ("id", "user_id", "investment_account_id", "occurred_at", "on", "origin")
SELECT v."id", v."user_id", t."investment_account_id", (v."on" + time '23:59:59') AT TIME ZONE 'UTC', v."on", 'manual'
FROM "investment_valuations" v JOIN "investments_v2_platforms" t ON t."platform_id" = v."platform_id"
ORDER BY v."on", v."id";
--> statement-breakpoint
INSERT INTO "investment_operations" ("user_id", "event_id", "leg", "kind", "amount_cents")
SELECT v."user_id", v."id", 'main', 'account_valuation', v."value_cents"
FROM "investment_valuations" v JOIN "investments_v2_platforms" t ON t."platform_id" = v."platform_id";
--> statement-breakpoint
-- 2. Every existing manual account of type investment or crypto that is not a fund's valuation
--    account (those stay in `funds`: two writers otherwise, §1.3) becomes a service in `total` mode
--    by handover (A4) on its user's today: the balance at T opens the period, the manual, import and
--    provider entries from T on are archived and removed, the ones before T stay.
CREATE TEMP TABLE "investments_v2_handover" ON COMMIT DROP AS
SELECT
  a."id" AS "account_id",
  a."user_id",
  a."type",
  uuidv7() AS "investment_account_id",
  uuidv7() AS "event_id",
  (now() AT TIME ZONE coalesce(up."time_zone", 'Europe/Rome'))::date AS "t",
  (
    SELECT b."balance_cents" FROM "balance_entries" b
    WHERE b."account_id" = a."id"
      AND b."on" <= (now() AT TIME ZONE coalesce(up."time_zone", 'Europe/Rome'))::date
    ORDER BY b."on" DESC,
      CASE b."source" WHEN 'manual' THEN 1 WHEN 'import' THEN 2 WHEN 'portfolio' THEN 3
        WHEN 'provider' THEN 4 WHEN 'system' THEN 5 ELSE 6 END
    LIMIT 1
  ) AS "opening_cents"
FROM "accounts" a
LEFT JOIN "user_preferences" up ON up."user_id" = a."user_id"
WHERE a."type" IN ('investment', 'crypto')
  AND a."origin" = 'manual'
  AND NOT EXISTS (SELECT 1 FROM "funds" f WHERE f."valuation_account_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "investments_v2_platforms" t WHERE t."account_id" = a."id");
--> statement-breakpoint
INSERT INTO "investment_accounts" ("id", "user_id", "account_id", "category", "provider", "managed_since", "opened_on")
SELECT h."investment_account_id", h."user_id", h."account_id",
  CASE WHEN h."type" = 'crypto' THEN 'crypto' ELSE 'broker' END, 'manual', h."t", h."t"
FROM "investments_v2_handover" h;
--> statement-breakpoint
INSERT INTO "investment_account_periods" ("user_id", "investment_account_id", "from_on", "starts_at", "mode", "origin", "reason")
SELECT h."user_id", h."investment_account_id", h."t", now(), 'total', 'manual', 'handover'
FROM "investments_v2_handover" h;
--> statement-breakpoint
INSERT INTO "investment_events" ("id", "user_id", "investment_account_id", "occurred_at", "on", "origin")
SELECT h."event_id", h."user_id", h."investment_account_id", now(), h."t", 'conversion'
FROM "investments_v2_handover" h WHERE h."opening_cents" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "investment_operations" ("user_id", "event_id", "leg", "kind", "amount_cents")
SELECT h."user_id", h."event_id", 'main', 'account_valuation', h."opening_cents"
FROM "investments_v2_handover" h WHERE h."opening_cents" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "investment_superseded_entries" ("user_id", "account_id", "balance_entry_id", "on", "balance_cents", "available_cents", "source", "note", "captured_at", "reason")
SELECT b."user_id", b."account_id", b."id", b."on", b."balance_cents", b."available_cents", b."source", b."note", b."captured_at", 'handover'
FROM "balance_entries" b JOIN "investments_v2_handover" h ON h."account_id" = b."account_id"
WHERE b."on" >= h."t" AND b."source" IN ('manual', 'import', 'provider');
--> statement-breakpoint
DELETE FROM "balance_entries" b USING "investments_v2_handover" h
WHERE h."account_id" = b."account_id" AND b."on" >= h."t" AND b."source" IN ('manual', 'import', 'provider');
--> statement-breakpoint
-- 3. The `portfolio` points of every account above (§1.7): a point on every event day, on the
--    period's first day and on every month end up to the user's today. In `total` mode V is the last
--    account valuation plus the deposits and withdrawals ordered after it, never below zero, and
--    unknown (no point) while money went in before any valuation (§2.1) — the engine's `valueOn`;
--    the integration test checks that a rebuild leaves these points unchanged.
INSERT INTO "balance_entries" ("user_id", "account_id", "on", "balance_cents", "source", "captured_at")
WITH "books" AS (
  SELECT ia."id", ia."user_id", ia."account_id", p."from_on",
    (now() AT TIME ZONE coalesce(up."time_zone", 'Europe/Rome'))::date AS "today"
  FROM "investment_accounts" ia
  JOIN "investment_account_periods" p ON p."investment_account_id" = ia."id"
  LEFT JOIN "user_preferences" up ON up."user_id" = ia."user_id"
),
"days" AS (
  SELECT b."id", b."user_id", b."account_id", b."from_on" AS "d", b."today" FROM "books" b
  UNION
  SELECT b."id", b."user_id", b."account_id", e."on", b."today"
  FROM "books" b JOIN "investment_events" e ON e."investment_account_id" = b."id"
  UNION
  SELECT b."id", b."user_id", b."account_id",
    (date_trunc('month', m) + interval '1 month - 1 day')::date, b."today"
  FROM "books" b, generate_series(date_trunc('month', b."from_on"), date_trunc('month', b."today"), interval '1 month') m
)
SELECT d."user_id", d."account_id", d."d",
  GREATEST(0, coalesce(last_valuation."amount_cents", 0) + coalesce((
    SELECT sum(o."amount_cents")
    FROM "investment_events" e JOIN "investment_operations" o ON o."event_id" = e."id"
    WHERE e."investment_account_id" = d."id" AND e."on" <= d."d"
      AND o."kind" IN ('deposit', 'withdrawal')
      AND (last_valuation."on" IS NULL
        OR (e."on", e."occurred_at", e."seq") > (last_valuation."on", last_valuation."occurred_at", last_valuation."seq"))
  ), 0)),
  'portfolio', now()
FROM "days" d
LEFT JOIN LATERAL (
  SELECT e."on", e."occurred_at", e."seq", o."amount_cents"
  FROM "investment_events" e JOIN "investment_operations" o ON o."event_id" = e."id"
  WHERE e."investment_account_id" = d."id" AND e."on" <= d."d" AND o."kind" = 'account_valuation'
  ORDER BY e."on" DESC, e."occurred_at" DESC, e."seq" DESC
  LIMIT 1
) last_valuation ON true
WHERE d."d" <= d."today"
  -- Unknown, so no point: money went in and nobody valued the account yet.
  AND (last_valuation."on" IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM "investment_events" e JOIN "investment_operations" o ON o."event_id" = e."id"
    WHERE e."investment_account_id" = d."id" AND e."on" <= d."d" AND o."kind" IN ('deposit', 'withdrawal')
  ));
--> statement-breakpoint
-- 4. One write path at a time (A9): from here the legacy tables are read only. Row triggers, so a
--    cascade that deletes nothing (a test user's deletion) and TRUNCATE are not refused.
CREATE FUNCTION "investments_legacy_read_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'investments legacy table % is read only (docs/design/investments.md §7)', TG_TABLE_NAME
    USING ERRCODE = 'read_only_sql_transaction';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "investment_platforms_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "investment_platforms"
  FOR EACH ROW EXECUTE FUNCTION "investments_legacy_read_only"();
--> statement-breakpoint
CREATE TRIGGER "investment_movements_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "investment_movements"
  FOR EACH ROW EXECUTE FUNCTION "investments_legacy_read_only"();
--> statement-breakpoint
CREATE TRIGGER "investment_valuations_read_only" BEFORE INSERT OR UPDATE OR DELETE ON "investment_valuations"
  FOR EACH ROW EXECUTE FUNCTION "investments_legacy_read_only"();
