ALTER TABLE "transactions" ADD COLUMN "raw_text" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "counterparty_name" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_category_code" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_transaction_code" text;