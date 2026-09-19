ALTER TABLE "budget_limits" DROP CONSTRAINT "budget_limits_category_month_uq";--> statement-breakpoint
ALTER TABLE "budget_limits" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_scope_month_uq" UNIQUE NULLS NOT DISTINCT("user_id","category_id","account_id","from_month");--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_scope_ck" CHECK ("budget_limits"."category_id" is not null or "budget_limits"."account_id" is not null);