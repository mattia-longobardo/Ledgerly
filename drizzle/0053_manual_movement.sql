-- Release N3, first part (docs/design/rewrite-plan/03-releases.md "N3", 12-account-modes.md §12.8):
-- the movement a person writes by hand. Additive: the image before this release writes neither
-- column and reads `origin` as the default, a provider's movement. The check on the source of a
-- balance takes every value it took and `movement`, the balance after the manual movements
-- (06-data.md §6.2, rule 4: a wider check).
ALTER TABLE "balance_entries" DROP CONSTRAINT "balance_entries_source_ck";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "origin" text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_idempotency_uq" ON "transactions" USING btree ("user_id","idempotency_key") WHERE "transactions"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_source_ck" CHECK ("balance_entries"."source" in ('manual', 'provider', 'system', 'import', 'derived', 'portfolio', 'movement'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_ck" CHECK ("transactions"."origin" in ('provider', 'manual'));
