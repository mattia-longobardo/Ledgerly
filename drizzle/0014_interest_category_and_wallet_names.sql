ALTER TABLE "interest_rules" ADD COLUMN "posting_category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "locally_edited" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_posting_category_id_categories_id_fk" FOREIGN KEY ("posting_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;