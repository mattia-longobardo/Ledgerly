CREATE TABLE "account_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance" numeric(16, 2) NOT NULL,
	"available" numeric(16, 2),
	"source" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_balances_source_ck" CHECK ("account_balances"."source" IN ('manual','provider','system','migration'))
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"origin" text NOT NULL,
	"provider" text,
	"status" text DEFAULT 'active' NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "accounts_type_ck" CHECK ("accounts"."type" IN ('checking','savings','cash','investment','pension_fund','crypto','credit','other')),
	CONSTRAINT "accounts_origin_ck" CHECK ("accounts"."origin" IN ('manual','synced')),
	CONSTRAINT "accounts_status_ck" CHECK ("accounts"."status" IN ('active','unavailable','archived')),
	CONSTRAINT "accounts_currency_ck" CHECK (char_length("accounts"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "provider_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"external_parent_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_since" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_links" ADD CONSTRAINT "provider_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_balances_uq" ON "account_balances" USING btree ("account_id","as_of","source");--> statement-breakpoint
CREATE INDEX "account_balances_account_asof_idx" ON "account_balances" USING btree ("account_id","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_user_name_uq" ON "account_groups" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_links_external_uq" ON "provider_links" USING btree ("provider","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_links_entity_uq" ON "provider_links" USING btree ("provider","entity_type","entity_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role', true) = 'system' $$;
--> statement-breakpoint
ALTER TABLE account_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_groups_owner ON account_groups USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_owner ON accounts USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_balances_owner ON account_balances USING (app_is_system() OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_id AND a.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_id AND a.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE provider_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_links_owner ON provider_links USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());