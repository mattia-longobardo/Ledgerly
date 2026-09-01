CREATE TABLE "leave_days" (
	"date" date PRIMARY KEY NOT NULL,
	"fraction" numeric(2, 1) NOT NULL,
	"kind" text NOT NULL,
	"trek_entry_id" integer,
	"origin" text DEFAULT 'trek' NOT NULL,
	"note" text,
	"pending_op" text DEFAULT 'none' NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_days_fraction_ck" CHECK ("leave_days"."fraction" IN (0.5, 1)),
	CONSTRAINT "leave_days_kind_ck" CHECK ("leave_days"."kind" IN ('vacation','comp')),
	CONSTRAINT "leave_days_origin_ck" CHECK ("leave_days"."origin" IN ('trek','dashboard')),
	CONSTRAINT "leave_days_pending_op_ck" CHECK ("leave_days"."pending_op" IN ('none','upsert','delete'))
);
--> statement-breakpoint
CREATE INDEX "leave_days_pending_idx" ON "leave_days" USING btree ("pending_op") WHERE pending_op <> 'none';