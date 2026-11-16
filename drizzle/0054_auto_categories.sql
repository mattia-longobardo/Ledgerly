-- Release N3, second part (docs/design/rewrite-plan/03-releases.md "N3", 04-now.md §4.4): the
-- automatic categories. Additive: the image before this release writes none of the new columns
-- and never reads the new tables. A movement it writes with a category has no origin, which the
-- new code reads as a confirmed label.
CREATE TABLE "category_group_marks" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_group_marks_user_group_uq" UNIQUE("user_id","group_key")
);
--> statement-breakpoint
CREATE TABLE "category_memory" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_memory_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "category_merge_dismissals" (
	"user_id" uuid NOT NULL,
	"first_id" uuid NOT NULL,
	"second_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_merge_dismissals_pk" PRIMARY KEY("user_id","first_id","second_id")
);
--> statement-breakpoint
CREATE TABLE "category_models" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"examples" integer DEFAULT 0 NOT NULL,
	"labelled_through" timestamp with time zone,
	"automatic_threshold" real,
	"suggestion_threshold" real,
	"model" jsonb,
	"preparing" boolean DEFAULT false NOT NULL,
	"trained_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_undos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_origin" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_confidence" real;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_model_version" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "suggested_category_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_reason" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_reason_params" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_key" text;--> statement-breakpoint
ALTER TABLE "category_group_marks" ADD CONSTRAINT "category_group_marks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_group_marks" ADD CONSTRAINT "category_group_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_memory" ADD CONSTRAINT "category_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_memory" ADD CONSTRAINT "category_memory_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_merge_dismissals" ADD CONSTRAINT "category_merge_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_merge_dismissals" ADD CONSTRAINT "category_merge_dismissals_first_id_categories_id_fk" FOREIGN KEY ("first_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_merge_dismissals" ADD CONSTRAINT "category_merge_dismissals_second_id_categories_id_fk" FOREIGN KEY ("second_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_models" ADD CONSTRAINT "category_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_undos" ADD CONSTRAINT "category_undos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_undos_user_idx" ON "category_undos" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_category_key_idx" ON "transactions" USING btree ("user_id","category_key") WHERE "transactions"."category_key" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_origin_ck" CHECK ("transactions"."category_origin" is null or "transactions"."category_origin" in ('user', 'provider', 'memory', 'model', 'table'));--> statement-breakpoint
-- Data (06-data.md §6.1): who chose the categories that are there. A category a person set here is
-- theirs; every other one came with the movement, from its source. No category changes.
UPDATE "transactions" SET "category_origin" = 'user' WHERE "category_id" IS NOT NULL AND "category_origin" IS NULL AND ('categoryId' = ANY("locally_edited") OR "origin" = 'manual');--> statement-breakpoint
UPDATE "transactions" SET "category_origin" = 'provider' WHERE "category_id" IS NOT NULL AND "category_origin" IS NULL;
