-- N3.4 (categories-and-rules.md §4, §10): the rules of a person. Additive: two tables, one nullable
-- column and the value `rule` in the check of `category_origin`. The image before ignores them all;
-- the way back is docs/design/rewrite-plan/n3-4-rollback.sql.
CREATE TABLE "category_rule_undos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"category_id" uuid NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_origin_ck";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "category_rule_undos" ADD CONSTRAINT "category_rule_undos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_rule_undos_user_idx" ON "category_rule_undos" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "category_rules_user_idx" ON "category_rules" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "category_rules_category_idx" ON "category_rules" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_id_category_rules_id_fk" FOREIGN KEY ("category_rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_origin_ck" CHECK ("transactions"."category_origin" is null or "transactions"."category_origin" in ('user', 'provider', 'memory', 'model', 'table', 'rule'));