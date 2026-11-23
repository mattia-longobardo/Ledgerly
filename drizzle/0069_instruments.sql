CREATE TABLE "instrument_listings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"mic" text NOT NULL,
	"ticker" text,
	"currency" text NOT NULL,
	"price_source" text,
	"unpriced_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_listings_mic_ck" CHECK ("instrument_listings"."mic" ~ '^[A-Z0-9]{4}$'),
	CONSTRAINT "instrument_listings_ticker_ck" CHECK ("instrument_listings"."ticker" is null or length(btrim("instrument_listings"."ticker")) between 1 and 20),
	CONSTRAINT "instrument_listings_currency_ck" CHECK ("instrument_listings"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "instrument_listings_price_source_ck" CHECK ("instrument_listings"."price_source" is null or "instrument_listings"."price_source" ~ '^[a-z][a-z0-9-]{1,30}$'),
	CONSTRAINT "instrument_listings_reason_ck" CHECK ("instrument_listings"."unpriced_reason" is null or length("instrument_listings"."unpriced_reason") <= 40)
);
--> statement-breakpoint
CREATE TABLE "instrument_prices" (
	"listing_id" uuid NOT NULL,
	"on" date NOT NULL,
	"close" numeric(30, 12) NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_prices_pk" PRIMARY KEY("listing_id","on","source"),
	CONSTRAINT "instrument_prices_close_ck" CHECK ("instrument_prices"."close" > 0),
	CONSTRAINT "instrument_prices_currency_ck" CHECK ("instrument_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "instrument_prices_source_ck" CHECK ("instrument_prices"."source" ~ '^[a-z][a-z0-9-]{1,30}$')
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"isin" text,
	"figi" text,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"cfi" text,
	"currency" text NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_key_ck" CHECK ("instruments"."isin" is not null or "instruments"."figi" is not null),
	CONSTRAINT "instruments_isin_ck" CHECK ("instruments"."isin" is null or "instruments"."isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
	CONSTRAINT "instruments_name_ck" CHECK (length(btrim("instruments"."name")) between 1 and 200),
	CONSTRAINT "instruments_class_ck" CHECK ("instruments"."class" in ('stock', 'etf', 'fund', 'bond', 'other')),
	CONSTRAINT "instruments_cfi_ck" CHECK ("instruments"."cfi" is null or "instruments"."cfi" ~ '^[A-Z]{6}$'),
	CONSTRAINT "instruments_currency_ck" CHECK ("instruments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "investment_assets" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument_listings" ADD CONSTRAINT "instrument_listings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_listing_id_instrument_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."instrument_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_listings_market_uq" ON "instrument_listings" USING btree ("instrument_id","mic");--> statement-breakpoint
CREATE INDEX "instrument_prices_last_idx" ON "instrument_prices" USING btree ("listing_id","on" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_isin_uq" ON "instruments" USING btree ("isin") WHERE "instruments"."isin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_figi_uq" ON "instruments" USING btree ("figi") WHERE "instruments"."figi" is not null;--> statement-breakpoint
ALTER TABLE "investment_assets" ADD CONSTRAINT "investment_assets_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_assets_instrument_idx" ON "investment_assets" USING btree ("instrument_id");