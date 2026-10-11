CREATE TABLE "pocket_expense_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pocket_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pocket_expense_links_transaction_uq" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "pocket_planned_expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pocket_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pocket_planned_expenses_amount_ck" CHECK ("pocket_planned_expenses"."amount_cents" > 0),
	CONSTRAINT "pocket_planned_expenses_description_ck" CHECK (length(btrim("pocket_planned_expenses"."description")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "pocket_expense_links" ADD CONSTRAINT "pocket_expense_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_expense_links" ADD CONSTRAINT "pocket_expense_links_pocket_id_pockets_id_fk" FOREIGN KEY ("pocket_id") REFERENCES "public"."pockets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_expense_links" ADD CONSTRAINT "pocket_expense_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_planned_expenses" ADD CONSTRAINT "pocket_planned_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pocket_planned_expenses" ADD CONSTRAINT "pocket_planned_expenses_pocket_id_pockets_id_fk" FOREIGN KEY ("pocket_id") REFERENCES "public"."pockets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pocket_expense_links_pocket_idx" ON "pocket_expense_links" USING btree ("pocket_id");--> statement-breakpoint
CREATE INDEX "pocket_expense_links_user_idx" ON "pocket_expense_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pocket_planned_expenses_pocket_due_idx" ON "pocket_planned_expenses" USING btree ("pocket_id","due_on");--> statement-breakpoint
CREATE INDEX "pocket_planned_expenses_user_idx" ON "pocket_planned_expenses" USING btree ("user_id");