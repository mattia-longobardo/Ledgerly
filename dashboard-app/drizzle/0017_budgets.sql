CREATE TABLE "budget_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"source_kind" text DEFAULT 'none' NOT NULL,
	"source_id" uuid,
	"amount" numeric(16, 2) NOT NULL,
	"recurrence" text DEFAULT 'once' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"note" text,
	"actor_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_allocations_source_ck" CHECK ("budget_allocations"."source_kind" IN ('fund','account','none')),
	CONSTRAINT "budget_allocations_source_id_ck" CHECK (("budget_allocations"."source_kind" = 'none') = ("budget_allocations"."source_id" IS NULL)),
	CONSTRAINT "budget_allocations_recurrence_ck" CHECK ("budget_allocations"."recurrence" IN ('once','monthly')),
	CONSTRAINT "budget_allocations_dates_ck" CHECK ("budget_allocations"."effective_to" IS NULL OR "budget_allocations"."effective_from" <= "budget_allocations"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "budget_amount_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"initial_amount" numeric(16, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_scopes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	CONSTRAINT "budget_scopes_kind_ck" CHECK ("budget_scopes"."kind" IN ('account','category','label','fund'))
);
--> statement-breakpoint
CREATE TABLE "budget_usages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"transaction_id" uuid,
	"amount" numeric(16, 2) NOT NULL,
	"occurred_at" date NOT NULL,
	"matched_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_usages_matched_ck" CHECK ("budget_usages"."matched_by" IN ('scope','manual')),
	CONSTRAINT "budget_usages_tx_ck" CHECK (("budget_usages"."matched_by" = 'scope') = ("budget_usages"."transaction_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"period_kind" text DEFAULT 'none' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"goal_amount" numeric(16, 2),
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_status_ck" CHECK ("budgets"."status" IN ('active','archived')),
	CONSTRAINT "budgets_period_ck" CHECK ("budgets"."period_kind" IN ('none','monthly','quarterly','annual','custom')),
	CONSTRAINT "budgets_dates_ck" CHECK ("budgets"."end_date" IS NULL OR "budgets"."start_date" <= "budgets"."end_date")
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_amount_versions" ADD CONSTRAINT "budget_amount_versions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_events" ADD CONSTRAINT "budget_events_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scopes" ADD CONSTRAINT "budget_scopes_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usages" ADD CONSTRAINT "budget_usages_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_usages" ADD CONSTRAINT "budget_usages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_allocations_source_idx" ON "budget_allocations" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_amount_versions_uq" ON "budget_amount_versions" USING btree ("budget_id","effective_from");--> statement-breakpoint
CREATE INDEX "budget_events_budget_created_idx" ON "budget_events" USING btree ("budget_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "budget_scopes_uq" ON "budget_scopes" USING btree ("budget_id","kind","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_usages_tx_uq" ON "budget_usages" USING btree ("budget_id","transaction_id") WHERE transaction_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "budget_usages_budget_occurred_idx" ON "budget_usages" USING btree ("budget_id","occurred_at");--> statement-breakpoint
CREATE INDEX "budgets_user_status_idx" ON "budgets" USING btree ("user_id","status");
--> statement-breakpoint
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budgets_owner ON budgets
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE budget_amount_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_amount_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_amount_versions_owner ON budget_amount_versions
  USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_amount_versions.budget_id AND b.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_amount_versions.budget_id AND b.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE budget_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_allocations_owner ON budget_allocations
  USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_allocations.budget_id AND b.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_allocations.budget_id AND b.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE budget_scopes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_scopes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_scopes_owner ON budget_scopes
  USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_scopes.budget_id AND b.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_scopes.budget_id AND b.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE budget_usages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_usages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_usages_owner ON budget_usages
  USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_usages.budget_id AND b.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_usages.budget_id AND b.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE budget_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_events_owner ON budget_events
  USING (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_events.budget_id AND b.user_id = app_current_user_id()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_events.budget_id AND b.user_id = app_current_user_id()));