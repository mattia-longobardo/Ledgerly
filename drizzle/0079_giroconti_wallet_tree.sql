-- Giroconti without a category (2026-11-25, replaces QC7 of categories-and-rules.md). Way back:
-- docs/design/rewrite-plan/giroconti-rollback.sql, after the dump `pre-*` of the release.
CREATE TABLE "giroconto_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"out_id" uuid NOT NULL,
	"in_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giroconto_proposals_pair_uq" UNIQUE("out_id","in_id"),
	CONSTRAINT "giroconto_proposals_state_ck" CHECK ("giroconto_proposals"."state" in ('open', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_type_ck";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_outside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "giroconto_proposals" ADD CONSTRAINT "giroconto_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giroconto_proposals" ADD CONSTRAINT "giroconto_proposals_out_id_transactions_id_fk" FOREIGN KEY ("out_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giroconto_proposals" ADD CONSTRAINT "giroconto_proposals_in_id_transactions_id_fk" FOREIGN KEY ("in_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giroconto_proposals_user_idx" ON "giroconto_proposals" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "giroconto_proposals_in_idx" ON "giroconto_proposals" USING btree ("in_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- data:giroconti — every giroconto loses its category and its suggestion. A movement filed under a
-- category of Transfers already counts as a transfer and carries the `type` marker, which keeps it
-- one ("Scegli il conto" until the person chooses the other account). Idempotent: the integration
-- test runs the statements between the two `data:giroconti` markers again on a fixture.
UPDATE "transactions" SET "category_id" = NULL, "category_origin" = NULL, "category_confidence" = NULL, "category_model_version" = NULL, "category_reason" = NULL, "category_reason_params" = NULL, "category_rule_id" = NULL, "suggested_category_id" = NULL WHERE "type" = 'transfer' AND ("category_id" IS NOT NULL OR "suggested_category_id" IS NOT NULL);--> statement-breakpoint
-- The categories of Transfers go ("Savings", "Credit card"), and what points at them: their budgets
-- and rules (cascade), the suggestions and the subscriptions that named them (set null).
DELETE FROM "categories" WHERE "type" = 'transfer';--> statement-breakpoint
-- data:giroconti end
ALTER TABLE "categories" ADD CONSTRAINT "categories_type_ck" CHECK ("categories"."type" in ('income', 'expense'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_category_ck" CHECK ("transactions"."type" <> 'transfer' or "transactions"."category_id" is null);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_outside_ck" CHECK (not "transactions"."transfer_outside" or ("transactions"."type" = 'transfer' and "transactions"."transfer_group_id" is null and "transactions"."transfer_account_id" is null));
