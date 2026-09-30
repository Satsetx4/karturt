ALTER TABLE "monthly_dues" DROP CONSTRAINT "monthly_dues_status_amount_consistent";--> statement-breakpoint
ALTER TABLE "monthly_dues" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."monthly_due_status_new" AS ENUM('not_due', 'unpaid', 'paid', 'waived');--> statement-breakpoint
ALTER TABLE "monthly_dues" ALTER COLUMN "status" SET DATA TYPE "public"."monthly_due_status_new" USING (CASE WHEN "status"::text = 'waived' THEN 'not_due' ELSE "status"::text END)::"public"."monthly_due_status_new";--> statement-breakpoint
ALTER TYPE "public"."monthly_due_status" RENAME TO "monthly_due_status_legacy";--> statement-breakpoint
ALTER TYPE "public"."monthly_due_status_new" RENAME TO "monthly_due_status";--> statement-breakpoint
ALTER TABLE "monthly_dues" ALTER COLUMN "status" SET DEFAULT 'unpaid';--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_app_account_id" uuid NOT NULL,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(160) NOT NULL,
	"reason" varchar(500),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_action_not_blank" CHECK (length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_entity_type_not_blank" CHECK (length(trim("audit_events"."entity_type")) > 0),
	CONSTRAINT "audit_events_entity_id_not_blank" CHECK (length(trim("audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_reason_not_blank" CHECK ("audit_events"."reason" is null or length(trim("audit_events"."reason")) > 0)
);
--> statement-breakpoint
DROP INDEX "official_assignments_one_active_role_uq";--> statement-breakpoint
DROP INDEX "official_assignments_one_active_role_per_account_uq";--> statement-breakpoint
ALTER TABLE "monthly_dues" ALTER COLUMN "waived_reason" SET DATA TYPE varchar(500) USING (CASE WHEN "waived_reason"::text = 'not_yet_resident' THEN NULL ELSE "waived_reason"::text END);--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_app_account_id_app_accounts_id_fk" FOREIGN KEY ("actor_app_account_id") REFERENCES "public"."app_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" USING btree ("actor_app_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_time_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_failed_login_attempts_valid" CHECK ("app_accounts"."failed_login_attempts" between 0 and 5);--> statement-breakpoint
ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_status_amount_consistent" CHECK (("monthly_dues"."status" = 'not_due' and "monthly_dues"."amount" = 0 and "monthly_dues"."fee_rate_id" is null and "monthly_dues"."waived_reason" is null) or ("monthly_dues"."status" in ('unpaid', 'paid') and "monthly_dues"."amount" > 0 and "monthly_dues"."fee_rate_id" is not null and "monthly_dues"."waived_reason" is null) or ("monthly_dues"."status" = 'waived' and "monthly_dues"."amount" > 0 and "monthly_dues"."fee_rate_id" is not null and "monthly_dues"."waived_reason" is not null and length(trim("monthly_dues"."waived_reason")) > 0));--> statement-breakpoint
DROP TYPE "public"."monthly_due_waiver_reason";--> statement-breakpoint
DROP TYPE "public"."monthly_due_status_legacy";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.official_assignments a
    JOIN public.official_assignments b ON a.id < b.id
    WHERE ((a.rt_unit_id = b.rt_unit_id AND a.role = b.role) OR a.app_account_id = b.app_account_id)
      AND (a.ends_on IS NULL OR b.starts_on <= a.ends_on)
      AND (b.ends_on IS NULL OR a.starts_on <= b.ends_on)
  ) THEN
    RAISE EXCEPTION 'Existing official assignment periods overlap; resolve them before applying this migration.';
  END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION public.enforce_official_assignment_temporal_exclusivity() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM public.rt_units WHERE id = NEW.rt_unit_id FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.official_assignments existing
    WHERE existing.id <> NEW.id
      AND (existing.role = NEW.role OR existing.app_account_id = NEW.app_account_id)
      AND existing.rt_unit_id = NEW.rt_unit_id
      AND (NEW.ends_on IS NULL OR existing.starts_on <= NEW.ends_on)
      AND (existing.ends_on IS NULL OR existing.ends_on >= NEW.starts_on)
  ) THEN
    RAISE EXCEPTION 'Official assignment periods may not overlap for the same RT role or account.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER official_assignments_temporal_exclusivity
BEFORE INSERT OR UPDATE OF rt_unit_id, app_account_id, role, starts_on, ends_on
ON public.official_assignments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_official_assignment_temporal_exclusivity();--> statement-breakpoint
CREATE FUNCTION public.reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only.'
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE
ON public.audit_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_audit_event_mutation();--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE
ON public.audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION public.reject_audit_event_mutation();
