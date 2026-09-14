CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job" text NOT NULL,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"detail" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);