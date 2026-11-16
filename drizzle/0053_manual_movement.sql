-- Release N3, first part (docs/design/rewrite-plan/03-releases.md "N3", 12-account-modes.md §12.8):
-- the movement a person writes by hand. Additive: the image before this release writes none of
-- the new columns, reads `origin` as the default, a provider's movement, and never reads the new
-- table. The check on the source of a balance takes every value it took and `movement`, the
-- balance after the manual movements (06-data.md §6.2, rule 4: a wider check).
CREATE TABLE "manual_movement_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balance_entries" DROP CONSTRAINT "balance_entries_source_ck";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "origin" text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "manual_movement_accounts" ADD CONSTRAINT "manual_movement_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_movement_accounts" ADD CONSTRAINT "manual_movement_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_movement_accounts_user_idx" ON "manual_movement_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_manual_idx" ON "transactions" USING btree ("account_id","occurred_at") WHERE "transactions"."origin" = 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_idempotency_uq" ON "transactions" USING btree ("user_id","idempotency_key") WHERE "transactions"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_source_ck" CHECK ("balance_entries"."source" in ('manual', 'provider', 'system', 'import', 'derived', 'portfolio', 'movement'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_ck" CHECK ("transactions"."origin" in ('provider', 'manual'));
