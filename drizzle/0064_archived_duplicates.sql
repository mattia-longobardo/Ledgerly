-- The archived accounts that double another account (decision H58): additive, empty at the release.
CREATE TABLE "duplicate_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"twin_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duplicate_accounts" ADD CONSTRAINT "duplicate_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_accounts" ADD CONSTRAINT "duplicate_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_accounts" ADD CONSTRAINT "duplicate_accounts_twin_account_id_accounts_id_fk" FOREIGN KEY ("twin_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_accounts_account_uq" ON "duplicate_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "duplicate_accounts_user_idx" ON "duplicate_accounts" USING btree ("user_id");