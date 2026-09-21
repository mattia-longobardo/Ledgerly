CREATE TABLE "account_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_connections_channel_ck" CHECK ("account_connections"."channel" in ('iban', 'card')),
	CONSTRAINT "account_connections_name_ck" CHECK (length(btrim("account_connections"."name")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_connections_uq" ON "account_connections" USING btree ("account_id","channel",lower("name"));--> statement-breakpoint
CREATE INDEX "account_connections_user_idx" ON "account_connections" USING btree ("user_id","account_id");