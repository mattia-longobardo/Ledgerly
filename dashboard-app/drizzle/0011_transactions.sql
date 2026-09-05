CREATE TABLE "recurring_patterns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"payee" text NOT NULL,
	"cadence" text NOT NULL,
	"amount_low" numeric(16, 2) NOT NULL,
	"amount_high" numeric(16, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"next_expected_at" timestamp with time zone,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_patterns_cadence_ck" CHECK ("recurring_patterns"."cadence" IN ('weekly','biweekly','monthly','quarterly','annual'))
);
--> statement-breakpoint
CREATE TABLE "transaction_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group_name" text,
	"kind" text DEFAULT 'expense' NOT NULL,
	"color" text,
	"parent_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_categories_kind_ck" CHECK ("transaction_categories"."kind" IN ('income','expense','transfer','system')),
	CONSTRAINT "transaction_categories_source_ck" CHECK ("transaction_categories"."source" IN ('manual','provider','system','migration'))
);
--> statement-breakpoint
CREATE TABLE "transaction_label_links" (
	"transaction_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "transaction_label_links_transaction_id_label_id_pk" PRIMARY KEY("transaction_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_labels_source_ck" CHECK ("transaction_labels"."source" IN ('manual','provider','system','migration'))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"booked_at" timestamp with time zone,
	"amount" numeric(16, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"type" text DEFAULT 'expense' NOT NULL,
	"state" text DEFAULT 'cleared' NOT NULL,
	"category_id" uuid,
	"payee" text,
	"note" text,
	"transfer_group_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"sync_run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type_ck" CHECK ("transactions"."type" IN ('income','expense','transfer')),
	CONSTRAINT "transactions_state_ck" CHECK ("transactions"."state" IN ('pending','cleared','reconciled')),
	CONSTRAINT "transactions_currency_ck" CHECK (char_length("transactions"."currency") = 3)
);
--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_label_links" ADD CONSTRAINT "transaction_label_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_label_links" ADD CONSTRAINT "transaction_label_links_label_id_transaction_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."transaction_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_patterns_user_payee_uq" ON "recurring_patterns" USING btree ("user_id","payee");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_categories_user_name_uq" ON "transaction_categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_labels_user_name_uq" ON "transaction_labels" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_occurred_idx" ON "transactions" USING btree ("account_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id","occurred_at");
--> statement-breakpoint
ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_categories_owner ON transaction_categories
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transaction_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_labels_owner ON transaction_labels
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_owner ON transactions
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE transaction_label_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transaction_label_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_label_links_owner ON transaction_label_links
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = transaction_id AND t.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = transaction_id AND t.user_id = app_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE recurring_patterns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recurring_patterns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_patterns_owner ON recurring_patterns
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
