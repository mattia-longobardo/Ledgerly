CREATE TABLE "notifications_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_log_user_kind_key_uq" UNIQUE("user_id","kind","key")
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"provider" text,
	"provider_account_id" text,
	"state" text DEFAULT 'active' NOT NULL,
	"color" text,
	"reference" text,
	"purpose" text,
	"opened_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"in_net_worth" boolean DEFAULT true NOT NULL,
	"in_snapshot" boolean DEFAULT true NOT NULL,
	"counts_as_liquid" boolean DEFAULT false NOT NULL,
	"low_balance_cents" bigint,
	"stale_after_hours" smallint DEFAULT 36 NOT NULL,
	"reminder" text DEFAULT 'never' NOT NULL,
	"between_entries" text DEFAULT 'hold' NOT NULL,
	"renamed_locally" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_uq" UNIQUE("user_id","provider","provider_account_id"),
	CONSTRAINT "accounts_type_ck" CHECK ("accounts"."type" in ('checking', 'savings', 'cash', 'investment', 'pension', 'crypto', 'credit', 'other')),
	CONSTRAINT "accounts_state_ck" CHECK ("accounts"."state" in ('active', 'unavailable', 'archived')),
	CONSTRAINT "accounts_origin_ck" CHECK ("accounts"."origin" in ('manual', 'synced')),
	CONSTRAINT "accounts_reminder_ck" CHECK ("accounts"."reminder" in ('monthly', 'quarterly', 'never')),
	CONSTRAINT "accounts_between_entries_ck" CHECK ("accounts"."between_entries" in ('hold', 'interpolate')),
	CONSTRAINT "accounts_currency_ck" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounts_name_ck" CHECK (length(btrim("accounts"."name")) between 1 and 80),
	CONSTRAINT "accounts_stale_hours_ck" CHECK ("accounts"."stale_after_hours" between 1 and 8760),
	CONSTRAINT "accounts_low_balance_ck" CHECK ("accounts"."low_balance_cents" is null or "accounts"."low_balance_cents" >= 0),
	CONSTRAINT "accounts_synced_provider_ck" CHECK ("accounts"."origin" = 'manual' or ("accounts"."provider" is not null and "accounts"."provider_account_id" is not null)),
	CONSTRAINT "accounts_archived_ck" CHECK (("accounts"."state" = 'archived') = ("accounts"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "balance_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"on" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"available_cents" bigint,
	"source" text NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_entries_account_on_source_uq" UNIQUE("account_id","on","source"),
	CONSTRAINT "balance_entries_source_ck" CHECK ("balance_entries"."source" in ('manual', 'provider', 'system', 'import'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"state" text NOT NULL,
	"accounts_written" integer DEFAULT 0 NOT NULL,
	"accounts_skipped" integer DEFAULT 0 NOT NULL,
	"total_cents" bigint,
	"warnings" jsonb,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_runs_user_month_uq" UNIQUE("user_id","month"),
	CONSTRAINT "snapshot_runs_state_ck" CHECK ("snapshot_runs"."state" in ('success', 'warning', 'failed')),
	CONSTRAINT "snapshot_runs_month_ck" CHECK (extract(day from "snapshot_runs"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_sort_idx" ON "accounts" USING btree ("user_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "balance_entries_account_on_idx" ON "balance_entries" USING btree ("account_id","on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "balance_entries_user_idx" ON "balance_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "snapshot_runs_user_month_idx" ON "snapshot_runs" USING btree ("user_id","month" DESC NULLS LAST);