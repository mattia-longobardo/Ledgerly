CREATE TABLE "account_switches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"from_provider" text NOT NULL,
	"from_provider_account_id" text NOT NULL,
	"to_provider" text NOT NULL,
	"to_provider_account_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"cut_date" date NOT NULL,
	"iban_taken" boolean DEFAULT false NOT NULL,
	"interest_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "switch_transfer_pairs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"switch_id" uuid NOT NULL,
	"out_id" uuid NOT NULL,
	"in_id" uuid NOT NULL,
	"out_before" jsonb NOT NULL,
	"in_before" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_switches" ADD CONSTRAINT "account_switches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_switches" ADD CONSTRAINT "account_switches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_transfer_pairs" ADD CONSTRAINT "switch_transfer_pairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_transfer_pairs" ADD CONSTRAINT "switch_transfer_pairs_switch_id_account_switches_id_fk" FOREIGN KEY ("switch_id") REFERENCES "public"."account_switches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_transfer_pairs" ADD CONSTRAINT "switch_transfer_pairs_out_id_transactions_id_fk" FOREIGN KEY ("out_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_transfer_pairs" ADD CONSTRAINT "switch_transfer_pairs_in_id_transactions_id_fk" FOREIGN KEY ("in_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_switches_open_uq" ON "account_switches" USING btree ("account_id") WHERE "account_switches"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "account_switches_user_idx" ON "account_switches" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE INDEX "switch_transfer_pairs_switch_idx" ON "switch_transfer_pairs" USING btree ("switch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "switch_transfer_pairs_out_uq" ON "switch_transfer_pairs" USING btree ("out_id") WHERE "switch_transfer_pairs"."undone_at" is null;