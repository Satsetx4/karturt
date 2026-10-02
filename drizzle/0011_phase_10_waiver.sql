DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.monthly_dues
    WHERE status = 'waived'
  ) THEN
    RAISE EXCEPTION 'Phase 10 migration refused: legacy WAIVED dues have no structured waiver history.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase10_legacy_waived_dues';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE "waiver_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"waived_by_account_id" uuid NOT NULL,
	"waived_by_account_type" "account_type" DEFAULT 'official' NOT NULL,
	"reason" varchar(500) NOT NULL,
	"item_count" integer NOT NULL,
	"total_amount" bigint NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_actions_rt_household_id_uq" UNIQUE("rt_unit_id","household_id","id"),
	CONSTRAINT "waiver_actions_actor_official" CHECK ("waiver_actions"."waived_by_account_type" = 'official'),
	CONSTRAINT "waiver_actions_reason_not_blank" CHECK (length(trim("waiver_actions"."reason")) > 0),
	CONSTRAINT "waiver_actions_positive_item_count" CHECK ("waiver_actions"."item_count" > 0),
	CONSTRAINT "waiver_actions_positive_total" CHECK ("waiver_actions"."total_amount" > 0),
	CONSTRAINT "waiver_actions_idempotency_key_uuid" CHECK ("waiver_actions"."idempotency_key"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "waiver_actions_fingerprint_sha256" CHECK ("waiver_actions"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "waiver_items" (
	"waiver_action_id" uuid NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"monthly_due_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_items_pk" PRIMARY KEY("waiver_action_id","monthly_due_id"),
	CONSTRAINT "waiver_items_period_valid" CHECK ("waiver_items"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "waiver_items_amount_positive" CHECK ("waiver_items"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "waiver_actions" ADD CONSTRAINT "waiver_actions_rt_household_fk" FOREIGN KEY ("rt_unit_id","household_id") REFERENCES "public"."households"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_actions" ADD CONSTRAINT "waiver_actions_actor_scope_fk" FOREIGN KEY ("rt_unit_id","waived_by_account_id","waived_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_items" ADD CONSTRAINT "waiver_items_action_scope_fk" FOREIGN KEY ("waiver_action_id","rt_unit_id","household_id") REFERENCES "public"."waiver_actions"("id","rt_unit_id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_items" ADD CONSTRAINT "waiver_items_due_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."monthly_dues"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_actions_rt_actor_idempotency_uq" ON "waiver_actions" USING btree ("rt_unit_id","waived_by_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "waiver_actions_household_created_idx" ON "waiver_actions" USING btree ("rt_unit_id","household_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_items_monthly_due_uq" ON "waiver_items" USING btree ("monthly_due_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_items_action_period_uq" ON "waiver_items" USING btree ("waiver_action_id","period");--> statement-breakpoint
CREATE INDEX "waiver_items_household_period_idx" ON "waiver_items" USING btree ("rt_unit_id","household_id","period");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_waiver_due_phase10_v1(target_due_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  due_status public.monthly_due_status;
  due_rt_unit_id uuid;
  due_household_id uuid;
  due_amount integer;
  due_waived_reason varchar(500);
  due_period text;
  item_count bigint;
  matching_item_count bigint;
BEGIN
  SELECT due.status,
         due.rt_unit_id,
         due.household_id,
         due.amount,
         due.waived_reason,
         lpad(billing_year.year::text, 4, '0') || '-' || lpad(due.month::text, 2, '0')
  INTO due_status, due_rt_unit_id, due_household_id, due_amount, due_waived_reason, due_period
  FROM public.monthly_dues due
  JOIN public.billing_years billing_year
    ON billing_year.id = due.billing_year_id
   AND billing_year.rt_unit_id = due.rt_unit_id
  WHERE due.id = target_due_id;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.waiver_items item WHERE item.monthly_due_id = target_due_id) THEN
      RAISE EXCEPTION 'A waiver item must reference an existing monthly due.'
        USING ERRCODE = '23514', CONSTRAINT = 'waiver_item_due_required';
    END IF;
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE action.id IS NOT NULL
      AND action.rt_unit_id = due_rt_unit_id
      AND action.household_id = due_household_id
      AND action.reason = due_waived_reason
      AND item.rt_unit_id = due_rt_unit_id
      AND item.household_id = due_household_id
      AND item.amount = due_amount
      AND item.period = due_period
  )
  INTO item_count, matching_item_count
  FROM public.waiver_items item
  LEFT JOIN public.waiver_actions action ON action.id = item.waiver_action_id
  WHERE item.monthly_due_id = target_due_id;

  IF due_status = 'waived' THEN
    IF item_count <> 1 OR matching_item_count <> 1 THEN
      RAISE EXCEPTION 'A WAIVED due requires exactly one matching waiver action item and snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_requires_complete_ledger';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.active_due_settlements settlement
      WHERE settlement.monthly_due_id = target_due_id
    ) THEN
      RAISE EXCEPTION 'A WAIVED due cannot have active payment settlement ownership.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_active_settlement_forbidden';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_claims claim
      JOIN public.payment_requests request ON request.id = claim.request_id
      WHERE claim.monthly_due_id = target_due_id
        AND request.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'A WAIVED due cannot have an active pending payment request claim.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_pending_claim_forbidden';
    END IF;
  ELSIF item_count <> 0 THEN
    RAISE EXCEPTION 'A waiver item can only reference a WAIVED due.'
      USING ERRCODE = '23514', CONSTRAINT = 'waiver_item_requires_waived_due';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_waiver_action_phase10_v1(target_action_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  action_row public.waiver_actions%ROWTYPE;
  item_count bigint;
  item_total numeric;
  item_periods text;
  audit_count bigint;
  matching_audit_count bigint;
  target_due_id uuid;
BEGIN
  SELECT * INTO action_row
  FROM public.waiver_actions
  WHERE id = target_action_id;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_events audit
      WHERE audit.action = 'waiver.created'
        AND audit.entity_type = 'waiver_action'
        AND audit.entity_id = target_action_id::text
    ) THEN
      RAISE EXCEPTION 'A waiver creation audit cannot exist without its waiver action.'
        USING ERRCODE = '23514', CONSTRAINT = 'waiver_audit_requires_action';
    END IF;
    RETURN;
  END IF;

  SELECT count(item.monthly_due_id),
         coalesce(sum(item.amount), 0),
         string_agg(item.period, ',' ORDER BY item.period)
  INTO item_count, item_total, item_periods
  FROM public.waiver_items item
  WHERE item.waiver_action_id = target_action_id;

  IF item_count <> action_row.item_count OR item_total <> action_row.total_amount THEN
    RAISE EXCEPTION 'A waiver action requires a complete item count and matching total.'
      USING ERRCODE = '23514', CONSTRAINT = 'waiver_action_items_total_match';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE audit.actor_app_account_id = action_row.waived_by_account_id
      AND audit.reason = action_row.reason
      AND audit.context = jsonb_build_object(
        'itemCount', action_row.item_count,
        'periods', item_periods,
        'totalAmount', action_row.total_amount
      )
  )
  INTO audit_count, matching_audit_count
  FROM public.audit_events audit
  WHERE audit.action = 'waiver.created'
    AND audit.entity_type = 'waiver_action'
    AND audit.entity_id = target_action_id::text;

  IF audit_count <> 1 OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'A waiver action requires exactly one matching creation audit.'
      USING ERRCODE = '23514', CONSTRAINT = 'waiver_action_audit_required';
  END IF;

  FOR target_due_id IN
    SELECT item.monthly_due_id
    FROM public.waiver_items item
    WHERE item.waiver_action_id = target_action_id
    ORDER BY item.monthly_due_id
  LOOP
    PERFORM public.assert_waiver_due_phase10_v1(target_due_id);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_waiver_ledger_phase10_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_action_id uuid;
  target_due_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'waiver_actions' THEN
    IF TG_OP = 'DELETE' THEN
      target_action_id := OLD.id;
    ELSE
      target_action_id := NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'waiver_items' THEN
    IF TG_OP = 'DELETE' THEN
      target_action_id := OLD.waiver_action_id;
      target_due_id := OLD.monthly_due_id;
    ELSE
      target_action_id := NEW.waiver_action_id;
      target_due_id := NEW.monthly_due_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'monthly_dues' THEN
    IF TG_OP = 'DELETE' THEN
      target_due_id := OLD.id;
    ELSE
      target_due_id := NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'active_due_settlements' THEN
    IF TG_OP = 'DELETE' THEN
      target_due_id := OLD.monthly_due_id;
    ELSE
      target_due_id := NEW.monthly_due_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_request_claims' THEN
    IF TG_OP = 'DELETE' THEN
      target_due_id := OLD.monthly_due_id;
    ELSE
      target_due_id := NEW.monthly_due_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'audit_events' AND TG_OP <> 'DELETE' THEN
    IF NEW.action = 'waiver.created' THEN
      IF NEW.entity_type <> 'waiver_action'
         OR NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NEW.reason IS NULL THEN
        RAISE EXCEPTION 'Waiver creation audit requires its action UUID and mandatory reason.'
          USING ERRCODE = '23514', CONSTRAINT = 'waiver_audit_entity_valid';
      END IF;
      PERFORM public.assert_waiver_action_phase10_v1(NEW.entity_id::uuid);
    END IF;
    RETURN NULL;
  END IF;

  IF target_action_id IS NOT NULL THEN
    PERFORM public.assert_waiver_action_phase10_v1(target_action_id);
  END IF;
  IF target_due_id IS NOT NULL THEN
    PERFORM public.assert_waiver_due_phase10_v1(target_due_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_waiver_due_transition_phase10_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'waived' THEN
      RAISE EXCEPTION 'A monthly due cannot be created directly in WAIVED status.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_requires_unpaid_transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'waived' THEN
    RAISE EXCEPTION 'A WAIVED due is immutable; Fase 10 has no unwaive or reversal transition.'
      USING ERRCODE = '55000', CONSTRAINT = 'waived_due_immutable';
  END IF;

  IF NEW.status = 'waived' THEN
    IF OLD.status <> 'unpaid' THEN
      RAISE EXCEPTION 'Only an UNPAID due can transition to WAIVED.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_requires_unpaid_transition';
    END IF;
    IF NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id
       OR NEW.household_id IS DISTINCT FROM OLD.household_id
       OR NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id
       OR NEW.fee_rate_id IS DISTINCT FROM OLD.fee_rate_id
       OR NEW.month IS DISTINCT FROM OLD.month
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Waiving a due cannot rewrite its household, period, amount, or creation timestamp.'
        USING ERRCODE = '55000', CONSTRAINT = 'waived_due_snapshot_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_waiver_ledger_mutation_phase10_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Waiver actions and items are append-only.'
    USING ERRCODE = '55000', CONSTRAINT = 'waiver_ledger_append_only';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lock_unwaived_due_for_active_owner_phase10_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  due_status public.monthly_due_status;
BEGIN
  IF TG_TABLE_NAME = 'active_due_settlements' THEN
    SELECT due.status INTO due_status
    FROM public.monthly_dues due
    WHERE due.id = NEW.monthly_due_id
    FOR UPDATE;
  ELSE
    SELECT due.status INTO due_status
    FROM public.payment_request_items item
    JOIN public.monthly_dues due ON due.id = item.monthly_due_id
    WHERE item.request_id = NEW.request_id
      AND item.monthly_due_id = NEW.monthly_due_id
    FOR UPDATE OF due;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active payment owner must reference an existing monthly due.'
      USING ERRCODE = '23503', CONSTRAINT = 'active_owner_due_required';
  END IF;
  IF due_status = 'waived' THEN
    RAISE EXCEPTION 'A WAIVED due cannot receive active payment ownership.'
      USING ERRCODE = '23514', CONSTRAINT = 'waived_due_active_owner_forbidden';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER waiver_actions_append_only_phase10_v1
BEFORE UPDATE OR DELETE ON public.waiver_actions
FOR EACH ROW EXECUTE FUNCTION public.reject_waiver_ledger_mutation_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER waiver_items_append_only_phase10_v1
BEFORE UPDATE OR DELETE ON public.waiver_items
FOR EACH ROW EXECUTE FUNCTION public.reject_waiver_ledger_mutation_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER waiver_actions_reject_truncate_phase10_v1
BEFORE TRUNCATE ON public.waiver_actions
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_waiver_ledger_mutation_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER waiver_items_reject_truncate_phase10_v1
BEFORE TRUNCATE ON public.waiver_items
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_waiver_ledger_mutation_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER monthly_dues_guard_waiver_transition_phase10_v1
BEFORE INSERT OR UPDATE ON public.monthly_dues
FOR EACH ROW EXECUTE FUNCTION public.guard_waiver_due_transition_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER payment_request_claims_lock_unwaived_due_phase10_v1
BEFORE INSERT OR UPDATE ON public.payment_request_claims
FOR EACH ROW EXECUTE FUNCTION public.lock_unwaived_due_for_active_owner_phase10_v1();
--> statement-breakpoint
CREATE TRIGGER active_due_settlements_lock_unwaived_due_phase10_v1
BEFORE INSERT OR UPDATE ON public.active_due_settlements
FOR EACH ROW EXECUTE FUNCTION public.lock_unwaived_due_for_active_owner_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waiver_actions_ledger_check_phase10_v1
AFTER INSERT OR UPDATE OR DELETE ON public.waiver_actions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER waiver_items_ledger_check_phase10_v1
AFTER INSERT OR UPDATE OR DELETE ON public.waiver_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER monthly_dues_waiver_ledger_check_phase10_v1
AFTER INSERT OR UPDATE OR DELETE ON public.monthly_dues
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_claims_waiver_check_phase10_v1
AFTER INSERT OR UPDATE OR DELETE ON public.payment_request_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER active_due_settlements_waiver_check_phase10_v1
AFTER INSERT OR UPDATE OR DELETE ON public.active_due_settlements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER audit_events_waiver_check_phase10_v1
AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_waiver_ledger_phase10_v1();
