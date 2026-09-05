CREATE TABLE "idempotency_keys" (
	"principal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_principal_id_key_pk" PRIMARY KEY("principal_id","key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"principal_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_windows_principal_id_window_start_pk" PRIMARY KEY("principal_id","window_start")
);
