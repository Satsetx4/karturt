CREATE TYPE "public"."payment_request_status" AS ENUM('pending', 'verified', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "payment_request_claims" (
	"monthly_due_id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_request_items" (
	"request_id" uuid NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"monthly_due_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_request_items_request_due_uq" UNIQUE("request_id","monthly_due_id"),
	CONSTRAINT "payment_request_items_request_period_uq" UNIQUE("request_id","period"),
	CONSTRAINT "payment_request_items_period_valid" CHECK ("payment_request_items"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payment_request_items_amount_positive" CHECK ("payment_request_items"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_code" varchar(24) NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"requested_by_account_id" uuid NOT NULL,
	"requested_by_account_type" "account_type" DEFAULT 'resident' NOT NULL,
	"status" "payment_request_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(36) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"total_amount" bigint NOT NULL,
	"item_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_rt_household_id_uq" UNIQUE("rt_unit_id","household_id","id"),
	CONSTRAINT "payment_requests_resident_only" CHECK ("payment_requests"."requested_by_account_type" = 'resident'),
	CONSTRAINT "payment_requests_idempotency_key_uuid" CHECK ("payment_requests"."idempotency_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "payment_requests_fingerprint_sha256" CHECK ("payment_requests"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_requests_positive_total" CHECK ("payment_requests"."total_amount" > 0),
	CONSTRAINT "payment_requests_positive_item_count" CHECK ("payment_requests"."item_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_rt_household_id_type_uq" UNIQUE("rt_unit_id","household_id","id","account_type");--> statement-breakpoint
ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_rt_household_id_uq" UNIQUE("rt_unit_id","household_id","id");--> statement-breakpoint
ALTER TABLE "payment_request_claims" ADD CONSTRAINT "payment_request_claims_item_fk" FOREIGN KEY ("request_id","monthly_due_id") REFERENCES "public"."payment_request_items"("request_id","monthly_due_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_request_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","request_id") REFERENCES "public"."payment_requests"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_due_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."monthly_dues"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_rt_household_fk" FOREIGN KEY ("rt_unit_id","household_id") REFERENCES "public"."households"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_resident_account_fk" FOREIGN KEY ("rt_unit_id","household_id","requested_by_account_id","requested_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","household_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_request_claims_request_idx" ON "payment_request_claims" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "payment_request_items_due_idx" ON "payment_request_items" USING btree ("rt_unit_id","household_id","monthly_due_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_request_code_uq" ON "payment_requests" USING btree ("request_code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_requester_idempotency_uq" ON "payment_requests" USING btree ("requested_by_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_requests_household_status_created_idx" ON "payment_requests" USING btree ("rt_unit_id","household_id","status","created_at");
