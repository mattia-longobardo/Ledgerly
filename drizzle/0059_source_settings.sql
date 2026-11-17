CREATE TABLE "source_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"instance_key" text DEFAULT '' NOT NULL,
	"schedule" jsonb NOT NULL,
	"cursors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_settings_uq" UNIQUE("user_id","provider","instance_key")
);
--> statement-breakpoint
CREATE TABLE "source_skipped_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_skipped_accounts_uq" UNIQUE("user_id","provider","external_id"),
	CONSTRAINT "source_skipped_accounts_external_id_ck" CHECK (length(btrim("source_skipped_accounts"."external_id")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "source_settings" ADD CONSTRAINT "source_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_skipped_accounts" ADD CONSTRAINT "source_skipped_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The accounts a connection left out, from its cursor to the memory of the core (N7.1). The cursor
-- keeps its key: the image before this release still reads it.
INSERT INTO "source_skipped_accounts" ("user_id", "provider", "external_id")
SELECT j."user_id", c."provider", s.id
FROM "sync_jobs" j
JOIN "integration_connections" c ON c."id" = j."connection_id"
CROSS JOIN LATERAL (SELECT (j."cursor"->>'skipped')::jsonb AS list) l
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(l.list) = 'array' THEN l.list ELSE '[]'::jsonb END
) AS s(id)
WHERE j."kind" = 'accounts'
  AND length(btrim(s.id)) BETWEEN 1 AND 200
ON CONFLICT DO NOTHING;
