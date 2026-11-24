-- Release R5f.1 (rewrite plan 03-releases.md "R5f", 06-data.md §6.1): the code reads a payslip by its
-- kind and extra payment, not by its old type. Additive only: the unique key of an applied month by
-- kind beside the old one by type, and the kind on a fund's competence, filled from the old type.
-- The old columns stay written until R5f.2. Way back: the image `pre-r5f-1` alone — it writes the
-- type and the kind both, so the two keys agree, and it leaves the two new columns of a competence
-- null, which R5f.2 fills again before it drops the old type.
UPDATE "payslips" SET "kind" = CASE "type" WHEN 'thirteenth' THEN 'extra' WHEN 'fourteenth' THEN 'extra' WHEN 'fifteenth' THEN 'extra' ELSE "type" END, "extra_number" = CASE "type" WHEN 'thirteenth' THEN 1 WHEN 'fourteenth' THEN 2 WHEN 'fifteenth' THEN 3 END WHERE "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "pension_competences" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "pension_competences" ADD COLUMN "extra_number" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_active_kind_uq" ON "payslips" USING btree ("user_id","employer_key","employee_key","year","kind",coalesce("extra_number", 0),coalesce("period", '0001-01-01'::date)) WHERE "payslips"."active";
--> statement-breakpoint
UPDATE "pension_competences" SET "kind" = CASE "payslip_type" WHEN 'thirteenth' THEN 'extra' WHEN 'fourteenth' THEN 'extra' WHEN 'fifteenth' THEN 'extra' ELSE "payslip_type" END, "extra_number" = CASE "payslip_type" WHEN 'thirteenth' THEN 1 WHEN 'fourteenth' THEN 2 WHEN 'fifteenth' THEN 3 END WHERE "kind" IS NULL;
