CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_access_tokens_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "personal_access_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "personal_access_tokens_scopes_ck" CHECK ("personal_access_tokens"."scopes" <> '{}' and "personal_access_tokens"."scopes" <@ array['read','write','imports']),
	CONSTRAINT "personal_access_tokens_name_ck" CHECK (length("personal_access_tokens"."name") between 1 and 60),
	CONSTRAINT "personal_access_tokens_prefix_ck" CHECK ("personal_access_tokens"."prefix" ~ '^[a-z0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_access_tokens_user_idx" ON "personal_access_tokens" USING btree ("user_id","created_at" DESC NULLS LAST);