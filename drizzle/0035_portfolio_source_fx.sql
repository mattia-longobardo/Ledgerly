CREATE TABLE "fx_rates" (
	"on" date NOT NULL,
	"currency" text NOT NULL,
	"eur_per_unit" numeric(20, 10) NOT NULL,
	"source" text DEFAULT 'ecb' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_pk" PRIMARY KEY("on","currency"),
	CONSTRAINT "fx_rates_currency_ck" CHECK ("fx_rates"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rates_eur_per_unit_ck" CHECK ("fx_rates"."eur_per_unit" > 0),
	CONSTRAINT "fx_rates_source_ck" CHECK ("fx_rates"."source" in ('ecb'))
);
--> statement-breakpoint
ALTER TABLE "balance_entries" DROP CONSTRAINT "balance_entries_source_ck";--> statement-breakpoint
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_source_ck" CHECK ("balance_entries"."source" in ('manual', 'provider', 'system', 'import', 'derived', 'portfolio'));