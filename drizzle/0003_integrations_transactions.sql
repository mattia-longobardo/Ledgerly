CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials" "bytea" NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_user_provider_uq" UNIQUE("user_id","provider"),
	CONSTRAINT "integration_connections_state_ck" CHECK ("integration_connections"."state" in ('active', 'error', 'revoked')),
	CONSTRAINT "integration_connections_provider_ck" CHECK (length(btrim("integration_connections"."provider")) between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "provider_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"metadata" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_links_external_uq" UNIQUE("user_id","provider","entity_type","external_id"),
	CONSTRAINT "provider_links_entity_uq" UNIQUE("user_id","provider","entity_type","entity_id"),
	CONSTRAINT "provider_links_entity_type_ck" CHECK ("provider_links"."entity_type" in ('account', 'transaction', 'category')),
	CONSTRAINT "provider_links_external_id_ck" CHECK (length(btrim("provider_links"."external_id")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cursor" jsonb,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_jobs_connection_kind_uq" UNIQUE("connection_id","kind"),
	CONSTRAINT "sync_jobs_kind_ck" CHECK ("sync_jobs"."kind" in ('accounts', 'transactions'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_runs_kind_ck" CHECK ("sync_runs"."kind" in ('accounts', 'transactions')),
	CONSTRAINT "sync_runs_state_ck" CHECK ("sync_runs"."state" in ('running', 'success', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group" text,
	"type" text DEFAULT 'expense' NOT NULL,
	"color" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "categories_type_ck" CHECK ("categories"."type" in ('income', 'expense', 'transfer')),
	CONSTRAINT "categories_name_ck" CHECK (length(btrim("categories"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "labels_name_ck" CHECK (length(btrim("labels"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "recurring_patterns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"payee_key" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"sign" smallint NOT NULL,
	"interval_days" integer NOT NULL,
	"median_cents" bigint NOT NULL,
	"next_expected_on" date NOT NULL,
	"occurrences" integer NOT NULL,
	"last_seen_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_patterns_key_uq" UNIQUE("user_id","payee_key","currency","sign"),
	CONSTRAINT "recurring_patterns_sign_ck" CHECK ("recurring_patterns"."sign" in (-1, 1)),
	CONSTRAINT "recurring_patterns_currency_ck" CHECK ("recurring_patterns"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "recurring_patterns_interval_ck" CHECK ("recurring_patterns"."interval_days" between 1 and 400),
	CONSTRAINT "recurring_patterns_occurrences_ck" CHECK ("recurring_patterns"."occurrences" >= 3)
);
--> statement-breakpoint
CREATE TABLE "transaction_labels" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_labels_pk" PRIMARY KEY("transaction_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"type" text NOT NULL,
	"state" text DEFAULT 'cleared' NOT NULL,
	"category_id" uuid,
	"payee" text,
	"note" text,
	"transfer_group_id" uuid,
	"hidden_at" timestamp with time zone,
	"removed_upstream_at" timestamp with time zone,
	"locally_edited" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type_ck" CHECK ("transactions"."type" in ('income', 'expense', 'transfer')),
	CONSTRAINT "transactions_state_ck" CHECK ("transactions"."state" in ('cleared', 'pending')),
	CONSTRAINT "transactions_currency_ck" CHECK ("transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_sign_ck" CHECK ("transactions"."type" <> 'expense' or "transactions"."amount_cents" <= 0),
	CONSTRAINT "transactions_income_sign_ck" CHECK ("transactions"."type" <> 'income' or "transactions"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_links" ADD CONSTRAINT "provider_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_group_id_transactions_id_fk" FOREIGN KEY ("transfer_group_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_links_lookup_idx" ON "provider_links" USING btree ("user_id","provider","entity_type","last_seen_at");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_started_idx" ON "sync_runs" USING btree ("connection_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_idx" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "categories_user_name_idx" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "recurring_patterns_user_next_idx" ON "recurring_patterns" USING btree ("user_id","next_expected_on");--> statement-breakpoint
CREATE INDEX "transaction_labels_label_idx" ON "transaction_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "transaction_labels_user_idx" ON "transaction_labels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "transactions_account_occurred_idx" ON "transactions" USING btree ("account_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group_idx" ON "transactions" USING btree ("transfer_group_id");