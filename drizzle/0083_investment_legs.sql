ALTER TABLE "transactions" DROP CONSTRAINT "transactions_origin_ck";--> statement-breakpoint
ALTER TABLE "investment_events" ADD COLUMN "leg_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD COLUMN "leg_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "investment_events" ADD CONSTRAINT "investment_events_leg_transaction_id_transactions_id_fk" FOREIGN KEY ("leg_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_leg_transaction_id_transactions_id_fk" FOREIGN KEY ("leg_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_events" ADD CONSTRAINT "investment_events_leg_transaction_uq" UNIQUE("leg_transaction_id");--> statement-breakpoint
ALTER TABLE "fund_operations" ADD CONSTRAINT "fund_operations_leg_transaction_uq" UNIQUE("leg_transaction_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_ck" CHECK ("transactions"."origin" in ('provider', 'manual', 'investments'));