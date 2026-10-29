-- PERS-145: the history a provider has none of is rebuilt from the complete flows of the 12 months
-- and the exchange's daily closes. It is a datum, not an estimate: `estimated` becomes
-- `reconstructed`, its coverage is complete, and its positions are priced at the daily close.
ALTER TABLE "investment_readings" DROP CONSTRAINT "investment_readings_status_ck";--> statement-breakpoint
UPDATE "investment_readings" SET "status" = 'reconstructed' WHERE "status" = 'estimated';--> statement-breakpoint
ALTER TABLE "investment_readings" ADD CONSTRAINT "investment_readings_status_ck" CHECK ("investment_readings"."status" in ('complete', 'partial', 'confirmed_zero', 'pending_zero', 'reconstructed'));--> statement-breakpoint
UPDATE "investment_reading_positions" SET "price_source" = 'close' WHERE "price_source" = 'estimated';--> statement-breakpoint
UPDATE "investment_sync_coverage" SET "status" = 'complete', "reason" = 'reconstructed'
WHERE "kind" = 'holdings' AND "stream" = 'balance_history' AND "reason" = 'estimated';
