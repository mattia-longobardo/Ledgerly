-- Correction of N4 (decision H54, docs/design/rewrite-plan/03-releases.md "N4"): a switch may join an
-- account of the bank already imported as an account of its own. Additive: the image before this release
-- writes none of the new columns and never reads the new table. Recovery: n4-merge-rollback.sql.
CREATE TABLE "switch_merged_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"switch_id" uuid NOT NULL,
	"double_id" uuid NOT NULL,
	"kept_id" uuid NOT NULL,
	"external_id" text,
	"kept_before" jsonb,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_switches" ADD COLUMN "merged_account_id" uuid;--> statement-breakpoint
ALTER TABLE "account_switches" ADD COLUMN "merged_state" text;--> statement-breakpoint
ALTER TABLE "switch_merged_movements" ADD CONSTRAINT "switch_merged_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_merged_movements" ADD CONSTRAINT "switch_merged_movements_switch_id_account_switches_id_fk" FOREIGN KEY ("switch_id") REFERENCES "public"."account_switches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_merged_movements" ADD CONSTRAINT "switch_merged_movements_double_id_transactions_id_fk" FOREIGN KEY ("double_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_merged_movements" ADD CONSTRAINT "switch_merged_movements_kept_id_transactions_id_fk" FOREIGN KEY ("kept_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "switch_merged_movements_switch_idx" ON "switch_merged_movements" USING btree ("switch_id");--> statement-breakpoint
ALTER TABLE "account_switches" ADD CONSTRAINT "account_switches_merged_account_id_accounts_id_fk" FOREIGN KEY ("merged_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;