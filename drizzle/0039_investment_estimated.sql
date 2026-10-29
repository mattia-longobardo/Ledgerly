ALTER TABLE "investment_readings" DROP CONSTRAINT "investment_readings_status_ck";--> statement-breakpoint
ALTER TABLE "investment_readings" ADD CONSTRAINT "investment_readings_status_ck" CHECK ("investment_readings"."status" in ('complete', 'partial', 'confirmed_zero', 'pending_zero', 'estimated'));--> statement-breakpoint
-- PERS-100: an unpriced position under 0.001 units is dust, never a missing price (B5).
UPDATE "investment_readings" AS r SET "missing_prices" = (
	SELECT count(*)::integer FROM "investment_reading_positions" AS p
	WHERE p."reading_id" = r."id" AND p."value_cents" IS NULL AND p."quantity" >= 0.001
) WHERE r."missing_prices" > 0;
