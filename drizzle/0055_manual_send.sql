-- Release N3.1 (docs/design/rewrite-plan/03-releases.md "N3.1", 12-account-modes.md §12.2-§12.3):
-- the state of a manual movement that waits for its source, and the match between a source's
-- categories and the ones here. Additive: the image before this release writes none of the new
-- columns and never reads the new tables. A movement it finds "to send" stays a manual movement.
CREATE TABLE "source_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"group_name" text,
	"category_id" uuid,
	"added_category_id" uuid,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_categories_external_uq" UNIQUE("user_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "source_category_undos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_category_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "send_state" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "send_asked_on" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source_category_id" uuid;--> statement-breakpoint
ALTER TABLE "source_categories" ADD CONSTRAINT "source_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_categories" ADD CONSTRAINT "source_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_categories" ADD CONSTRAINT "source_categories_added_category_id_categories_id_fk" FOREIGN KEY ("added_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_category_undos" ADD CONSTRAINT "source_category_undos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_category_undos" ADD CONSTRAINT "source_category_undos_source_category_id_source_categories_id_fk" FOREIGN KEY ("source_category_id") REFERENCES "public"."source_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_categories_category_idx" ON "source_categories" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "source_category_undos_user_idx" ON "source_category_undos" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_category_id_source_categories_id_fk" FOREIGN KEY ("source_category_id") REFERENCES "public"."source_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_send_idx" ON "transactions" USING btree ("user_id","account_id") WHERE "transactions"."send_state" is not null;--> statement-breakpoint
CREATE INDEX "transactions_source_category_idx" ON "transactions" USING btree ("source_category_id") WHERE "transactions"."source_category_id" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_send_state_ck" CHECK ("transactions"."send_state" is null or ("transactions"."send_state" in ('to_send', 'not_sent') and "transactions"."origin" = 'manual'));
--> statement-breakpoint
-- Data (06-data.md §6.1): one row "added" for each category a source gives today, towards the
-- category it already is here, with the name the source last gave it. Nothing is marked "New".
INSERT INTO "source_categories" ("user_id", "provider", "external_id", "name", "group_name", "category_id", "added_category_id", "seen_at")
SELECT l."user_id", l."provider", l."external_id", coalesce(c."provider_name", c."name"), coalesce(g."provider_name", g."name"), c."id", c."id", now()
FROM "provider_links" l
JOIN "categories" c ON c."id" = l."entity_id" AND c."user_id" = l."user_id"
LEFT JOIN "categories" g ON g."id" = c."parent_id"
WHERE l."entity_type" = 'category'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Data: the source's category on the movements that still carry it. `category_id` is not touched.
UPDATE "transactions" t
SET "source_category_id" = s."id"
FROM "source_categories" s, "accounts" a
WHERE a."id" = t."account_id"
  AND a."provider" = s."provider"
  AND s."user_id" = t."user_id"
  AND s."added_category_id" = t."category_id"
  AND t."origin" = 'provider'
  AND t."category_origin" = 'provider'
  AND t."source_category_id" IS NULL;
