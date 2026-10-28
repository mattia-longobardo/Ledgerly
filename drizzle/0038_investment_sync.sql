CREATE TABLE "investment_key_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"investment_account_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" text NOT NULL,
	"origin" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_restricted" boolean,
	"attested_read_only_at" timestamp with time zone,
	"attested_ip_at" timestamp with time zone,
	"attestation_text_version" text,
	"retired_at" timestamp with time zone,
	"revoked_at_provider_at" timestamp with time zone,
	CONSTRAINT "investment_key_checks_result_ck" CHECK ("investment_key_checks"."result" in ('read-only', 'write', 'unknown-flag', 'unverifiable', 'error')),
	CONSTRAINT "investment_key_checks_origin_ck" CHECK ("investment_key_checks"."origin" in ('connect', 'replace', 'pass', 'verify')),
	CONSTRAINT "investment_key_checks_provider_ck" CHECK (length("investment_key_checks"."provider") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "investment_sync_coverage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stream" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	CONSTRAINT "investment_sync_coverage_window_uq" UNIQUE("connection_id","stream","from_at"),
	CONSTRAINT "investment_sync_coverage_kind_ck" CHECK ("investment_sync_coverage"."kind" in ('holdings', 'flows')),
	CONSTRAINT "investment_sync_coverage_status_ck" CHECK ("investment_sync_coverage"."status" in ('complete', 'partial', 'gap')),
	CONSTRAINT "investment_sync_coverage_stream_ck" CHECK ("investment_sync_coverage"."stream" ~ '^[a-z][a-z0-9_:/-]{0,59}$'),
	CONSTRAINT "investment_sync_coverage_window_ck" CHECK ("investment_sync_coverage"."to_at" >= "investment_sync_coverage"."from_at"),
	CONSTRAINT "investment_sync_coverage_reason_ck" CHECK ("investment_sync_coverage"."reason" is null or "investment_sync_coverage"."reason" ~ '^[a-z][a-z0-9_]{0,59}$')
);
--> statement-breakpoint
ALTER TABLE "provider_links" DROP CONSTRAINT "provider_links_entity_type_ck";--> statement-breakpoint
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_kind_ck";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_kind_ck";--> statement-breakpoint
ALTER TABLE "investment_holdings" DROP CONSTRAINT "investment_holdings_product_ck";--> statement-breakpoint
ALTER TABLE "investment_reading_positions" DROP CONSTRAINT "investment_reading_positions_product_ck";--> statement-breakpoint
ALTER TABLE "investment_reading_scopes" DROP CONSTRAINT "investment_reading_scopes_product_ck";--> statement-breakpoint
ALTER TABLE "investment_key_checks" ADD CONSTRAINT "investment_key_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_key_checks" ADD CONSTRAINT "investment_key_checks_investment_account_id_investment_accounts_id_fk" FOREIGN KEY ("investment_account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_key_checks" ADD CONSTRAINT "investment_key_checks_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_sync_coverage" ADD CONSTRAINT "investment_sync_coverage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_sync_coverage" ADD CONSTRAINT "investment_sync_coverage_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_key_checks_account_idx" ON "investment_key_checks" USING btree ("investment_account_id","checked_at");--> statement-breakpoint
CREATE INDEX "investment_key_checks_user_idx" ON "investment_key_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_sync_coverage_user_idx" ON "investment_sync_coverage" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "provider_links" ADD CONSTRAINT "provider_links_entity_type_ck" CHECK ("provider_links"."entity_type" in ('account', 'transaction', 'category', 'category_group', 'interest_entry', 'investment_event', 'investment_holding'));--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_kind_ck" CHECK ("sync_jobs"."kind" in ('accounts', 'transactions', 'leave', 'documents', 'holdings', 'flows'));--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_kind_ck" CHECK ("sync_runs"."kind" in ('accounts', 'transactions', 'leave', 'documents', 'holdings', 'flows'));--> statement-breakpoint
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_product_ck" CHECK ("investment_holdings"."product" ~ '^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$');--> statement-breakpoint
ALTER TABLE "investment_reading_positions" ADD CONSTRAINT "investment_reading_positions_product_ck" CHECK ("investment_reading_positions"."product" ~ '^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$');--> statement-breakpoint
ALTER TABLE "investment_reading_scopes" ADD CONSTRAINT "investment_reading_scopes_product_ck" CHECK ("investment_reading_scopes"."product" ~ '^(spot|funding|earn|staking|custody|trading|cash|crypto|copy|other:[a-z0-9_-]{1,30})$');