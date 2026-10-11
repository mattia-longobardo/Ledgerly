ALTER TABLE "pension_rules" ADD COLUMN "enrollment_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pension_rules" ADD COLUMN "quarter_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pension_rules" ADD CONSTRAINT "pension_rules_fees_ck" CHECK ("pension_rules"."enrollment_fee_cents" between 0 and 100000 and "pension_rules"."quarter_fee_cents" between 0 and 100000);--> statement-breakpoint
-- The fees Cometa's tariff charges (GC §6.1), for the schedules seeded before they were a setting.
UPDATE "pension_rules" SET "enrollment_fee_cents" = 1032, "quarter_fee_cents" = 300
WHERE "kind" = 'payment_schedule'
  AND "fund_id" IN (SELECT "id" FROM "funds" WHERE lower(coalesce("provider", 'cometa')) = 'cometa');
