CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_access_tokens_hash_uq" ON "personal_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "personal_access_tokens_user_idx" ON "personal_access_tokens" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE personal_access_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE personal_access_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personal_access_tokens_owner ON personal_access_tokens
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR user_id = app_current_user_id());
