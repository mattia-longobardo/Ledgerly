-- F2.5: categories on two levels (spec §6, §7.2). Written by hand from two drizzle-kit passes: the
-- generated order created the foreign key before the unique key it points at, and the free-text
-- `group` has to be moved into parents before the column goes.
ALTER TABLE "provider_links" DROP CONSTRAINT "provider_links_entity_type_ck";--> statement-breakpoint
ALTER TABLE "provider_links" ADD CONSTRAINT "provider_links_entity_type_ck" CHECK ("provider_links"."entity_type" in ('account', 'transaction', 'category', 'category_group'));--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_root" boolean GENERATED ALWAYS AS (parent_id is null) STORED;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_is_root" boolean GENERATED ALWAYS AS (case when parent_id is null then null else true end) STORED;--> statement-breakpoint
-- The person chose the group by hand: the sync never files the category elsewhere again.
ALTER TABLE "categories" ADD COLUMN "parent_set_locally" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_root_uq" UNIQUE("id","is_root");--> statement-breakpoint
-- A child points at (its parent, true): only a group has is_root = true, so a third level cannot
-- be stored. No ON DELETE action: Postgres allows none on a key with a generated column, and a
-- category is archived rather than deleted.
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id","parent_is_root") REFERENCES "public"."categories"("id","is_root") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
-- Moving `group` into parents, in three steps.
-- 1. A category whose name another one uses as its group, or whose group is its own name, becomes
--    a group itself. One statement, so every row is judged against the table as it was.
UPDATE "categories" AS c SET "group" = NULL
WHERE c."group" IS NOT NULL
  AND (
    btrim(c."group") = ''
    OR btrim(c."group") = c."name"
    OR EXISTS (
      SELECT 1 FROM "categories" AS o
      WHERE o."user_id" = c."user_id" AND o."id" <> c."id" AND btrim(o."group") = c."name"
    )
  );--> statement-breakpoint
-- 2. A group name no category carries becomes a new group, with the type of its first member by
--    name. Names were unique per user until now, so the new ones cannot collide.
INSERT INTO "categories" ("user_id", "name", "type")
SELECT DISTINCT ON (c."user_id", btrim(c."group")) c."user_id", btrim(c."group"), c."type"
FROM "categories" AS c
WHERE c."group" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "categories" AS o WHERE o."user_id" = c."user_id" AND o."name" = btrim(c."group")
  )
ORDER BY c."user_id", btrim(c."group"), c."name", c."id";--> statement-breakpoint
-- 3. Every grouped category goes under the group of that name when the two share a type (a child
--    always has its parent's type); otherwise it stays a group of its own.
UPDATE "categories" AS c SET "parent_id" = g."id"
FROM "categories" AS g
WHERE c."group" IS NOT NULL
  AND g."user_id" = c."user_id"
  AND g."name" = btrim(c."group")
  AND g."group" IS NULL
  AND g."id" <> c."id"
  AND g."type" = c."type";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_user_name_uq";--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_parent_name_uq" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name");--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "group";
