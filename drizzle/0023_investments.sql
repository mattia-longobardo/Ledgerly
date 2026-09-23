CREATE TABLE "investment_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"on" date NOT NULL,
	"transaction_id" uuid,
	"note" text,
	"sheet_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_movements_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "investment_movements_sheet_uq" UNIQUE("user_id","sheet_key"),
	CONSTRAINT "investment_movements_kind_ck" CHECK ("investment_movements"."kind" in ('deposit', 'withdrawal')),
	CONSTRAINT "investment_movements_amount_ck" CHECK ("investment_movements"."amount_cents" > 0),
	CONSTRAINT "investment_movements_note_ck" CHECK ("investment_movements"."note" is null or length(btrim("investment_movements"."note")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "investment_platforms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_platforms_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "investment_platforms_name_ck" CHECK (length(btrim("investment_platforms"."name")) between 1 and 60),
	CONSTRAINT "investment_platforms_url_ck" CHECK ("investment_platforms"."url" is null or ("investment_platforms"."url" ~ '^https?://' and length("investment_platforms"."url") <= 500))
);
--> statement-breakpoint
CREATE TABLE "investment_valuations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"on" date NOT NULL,
	"value_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_valuations_platform_on_uq" UNIQUE("platform_id","on"),
	CONSTRAINT "investment_valuations_value_ck" CHECK ("investment_valuations"."value_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_platform_id_investment_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."investment_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_platforms" ADD CONSTRAINT "investment_platforms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_platform_id_investment_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."investment_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_movements_user_on_idx" ON "investment_movements" USING btree ("user_id","on");--> statement-breakpoint
CREATE INDEX "investment_movements_platform_idx" ON "investment_movements" USING btree ("platform_id");--> statement-breakpoint
CREATE INDEX "investment_valuations_user_idx" ON "investment_valuations" USING btree ("user_id");