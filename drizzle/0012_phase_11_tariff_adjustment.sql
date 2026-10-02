DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.active_due_settlements settlement
    LEFT JOIN public.payment_allocations allocation
      ON allocation.id = settlement.allocation_id
     AND allocation.payment_id = settlement.payment_id
     AND allocation.rt_unit_id = settlement.rt_unit_id
     AND allocation.household_id = settlement.household_id
     AND allocation.monthly_due_id = settlement.monthly_due_id
     AND allocation.amount = settlement.amount
    LEFT JOIN public.payments payment
      ON payment.id = settlement.payment_id
     AND payment.rt_unit_id = settlement.rt_unit_id
     AND payment.household_id = settlement.household_id
    WHERE allocation.id IS NULL OR payment.id IS NULL
       OR EXISTS (SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id)
  ) OR EXISTS (
    SELECT 1
    FROM public.payment_allocations allocation
    JOIN public.payments payment
      ON payment.id = allocation.payment_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    LEFT JOIN public.active_due_settlements settlement
      ON settlement.allocation_id = allocation.id
     AND settlement.payment_id = allocation.payment_id
     AND settlement.rt_unit_id = allocation.rt_unit_id
     AND settlement.household_id = allocation.household_id
     AND settlement.monthly_due_id = allocation.monthly_due_id
     AND settlement.amount = allocation.amount
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
    ) AND settlement.allocation_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Phase 11 migration refused: active ownership does not map one-to-one to immutable allocations.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase11_active_ownership_preflight';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.monthly_dues due
    LEFT JOIN public.active_due_settlements settlement ON settlement.monthly_due_id = due.id
    GROUP BY due.id, due.status, due.amount
    HAVING (due.status = 'paid' AND (count(settlement.allocation_id) <> 1 OR coalesce(sum(settlement.amount), 0) <> due.amount))
        OR (due.status <> 'paid' AND count(settlement.allocation_id) <> 0)
  ) THEN
    RAISE EXCEPTION 'Phase 11 migration refused: existing paid due ownership does not match its original snapshot.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase11_due_status_preflight';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE "due_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"monthly_due_id" uuid NOT NULL,
	"amount_delta" bigint NOT NULL,
	"effective_target_after" bigint NOT NULL,
	"reason" varchar(500) NOT NULL,
	"adjusted_by_account_id" uuid NOT NULL,
	"adjusted_by_account_type" "account_type" DEFAULT 'official' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "due_adjustments_amount_delta_nonzero" CHECK ("due_adjustments"."amount_delta" <> 0),
	CONSTRAINT "due_adjustments_effective_target_positive" CHECK ("due_adjustments"."effective_target_after" > 0),
	CONSTRAINT "due_adjustments_reason_not_blank" CHECK (length(trim("due_adjustments"."reason")) > 0),
	CONSTRAINT "due_adjustments_actor_official" CHECK ("due_adjustments"."adjusted_by_account_type" = 'official'),
	CONSTRAINT "due_adjustments_idempotency_key_uuid" CHECK ("due_adjustments"."idempotency_key"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "due_adjustments_fingerprint_sha256" CHECK ("due_adjustments"."request_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DROP INDEX "active_due_settlements_allocation_uq";--> statement-breakpoint
ALTER TABLE "active_due_settlements" DROP CONSTRAINT "active_due_settlements_pkey";--> statement-breakpoint
ALTER TABLE "active_due_settlements" ADD PRIMARY KEY ("allocation_id");--> statement-breakpoint
ALTER TABLE "fee_rates" ADD COLUMN "created_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_rates" ADD COLUMN "created_by_account_type" "account_type";--> statement-breakpoint
ALTER TABLE "fee_rates" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "fee_rates" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "due_adjustments" ADD CONSTRAINT "due_adjustments_due_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."monthly_dues"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_adjustments" ADD CONSTRAINT "due_adjustments_actor_scope_fk" FOREIGN KEY ("rt_unit_id","adjusted_by_account_id","adjusted_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "due_adjustments_rt_actor_idempotency_uq" ON "due_adjustments" USING btree ("rt_unit_id","adjusted_by_account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "due_adjustments_due_created_idx" ON "due_adjustments" USING btree ("rt_unit_id","household_id","monthly_due_id","created_at");--> statement-breakpoint
ALTER TABLE "fee_rates" ADD CONSTRAINT "fee_rates_creator_scope_fk" FOREIGN KEY ("rt_unit_id","created_by_account_id","created_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_due_settlements_due_idx" ON "active_due_settlements" USING btree ("rt_unit_id","household_id","monthly_due_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rates_rt_actor_idempotency_uq" ON "fee_rates" USING btree ("rt_unit_id","created_by_account_id","idempotency_key") WHERE "fee_rates"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "fee_rates" ADD CONSTRAINT "fee_rates_f11_audit_metadata_complete" CHECK (("fee_rates"."created_by_account_id" is null and "fee_rates"."created_by_account_type" is null and "fee_rates"."idempotency_key" is null and "fee_rates"."request_fingerprint" is null) or ("fee_rates"."created_by_account_id" is not null and "fee_rates"."created_by_account_type" = 'official' and "fee_rates"."idempotency_key" is not null and "fee_rates"."request_fingerprint" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "fee_rates" ADD CONSTRAINT "fee_rates_idempotency_key_uuid" CHECK ("fee_rates"."idempotency_key" is null or "fee_rates"."idempotency_key"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
--> statement-breakpoint
ALTER TABLE public.due_adjustments
  ADD CONSTRAINT due_adjustments_effective_target_integer_range
  CHECK (effective_target_after <= 2147483647);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.due_effective_target_phase11_v1(target_due_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT due.amount::numeric + coalesce(sum(adjustment.amount_delta), 0)
  FROM public.monthly_dues due
  LEFT JOIN public.due_adjustments adjustment
    ON adjustment.monthly_due_id = due.id
   AND adjustment.rt_unit_id = due.rt_unit_id
   AND adjustment.household_id = due.household_id
  WHERE due.id = target_due_id
  GROUP BY due.amount
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.due_active_received_phase11_v1(target_due_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(allocation.amount), 0)
  FROM public.payment_allocations allocation
  JOIN public.payments payment
    ON payment.id = allocation.payment_id
   AND payment.rt_unit_id = allocation.rt_unit_id
   AND payment.household_id = allocation.household_id
  WHERE allocation.monthly_due_id = target_due_id
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_reversals reversal
      WHERE reversal.payment_id = payment.id
    )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_phase11_history_mutation_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tariff and due adjustment history is append-only.'
    USING ERRCODE = '55000', CONSTRAINT = 'phase11_history_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fee_rates_reject_update_delete_phase11_v1
BEFORE UPDATE OR DELETE ON public.fee_rates
FOR EACH ROW EXECUTE FUNCTION public.reject_phase11_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER fee_rates_reject_truncate_phase11_v1
BEFORE TRUNCATE ON public.fee_rates
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_phase11_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER due_adjustments_reject_update_delete_phase11_v1
BEFORE UPDATE OR DELETE ON public.due_adjustments
FOR EACH ROW EXECUTE FUNCTION public.reject_phase11_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER due_adjustments_reject_truncate_phase11_v1
BEFORE TRUNCATE ON public.due_adjustments
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_phase11_history_mutation_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_phase11_due_snapshot_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id OR
    NEW.household_id IS DISTINCT FROM OLD.household_id OR
    NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id OR
    NEW.fee_rate_id IS DISTINCT FROM OLD.fee_rate_id OR
    NEW.month IS DISTINCT FROM OLD.month OR
    NEW.amount IS DISTINCT FROM OLD.amount OR
    NEW.due_date IS DISTINCT FROM OLD.due_date OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'A monthly due obligation snapshot is immutable.'
      USING ERRCODE = '55000', CONSTRAINT = 'monthly_due_obligation_snapshot_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'not_due' AND NEW.status <> 'not_due' THEN
    RAISE EXCEPTION 'NOT_DUE is a terminal monthly due state.'
      USING ERRCODE = '55000', CONSTRAINT = 'not_due_status_immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status IN ('paid', 'waived') THEN
    RAISE EXCEPTION 'A monthly due cannot be inserted directly as PAID or WAIVED.'
      USING ERRCODE = '23514', CONSTRAINT = 'monthly_due_initial_status_invalid';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monthly_dues_guard_phase11_snapshot_v1
BEFORE INSERT OR UPDATE ON public.monthly_dues
FOR EACH ROW EXECUTE FUNCTION public.guard_phase11_due_snapshot_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_fee_rate_phase11_insert_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  year_row public.billing_years%ROWTYPE;
  local_year integer;
  local_month integer;
  chairman_count bigint;
BEGIN
  IF NEW.created_by_account_id IS NULL THEN
    RAISE EXCEPTION 'New tariff rows require Chairman attribution and idempotency metadata.'
      USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_f11_actor_required';
  END IF;
  IF NEW.created_by_account_type <> 'official' OR NEW.idempotency_key IS NULL OR NEW.request_fingerprint IS NULL THEN
    RAISE EXCEPTION 'A F11 tariff requires an official actor and idempotency metadata.'
      USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_f11_actor_required';
  END IF;

  SELECT * INTO year_row
  FROM public.billing_years year
  WHERE year.id = NEW.billing_year_id
    AND year.rt_unit_id = NEW.rt_unit_id
  FOR UPDATE;
  IF NOT FOUND OR year_row.status <> 'open' THEN
    RAISE EXCEPTION 'A tariff can only be scheduled in an open billing year in the same RT.'
      USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_open_year_required';
  END IF;

  SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Jakarta'))::integer,
         extract(month FROM (now() AT TIME ZONE 'Asia/Jakarta'))::integer
  INTO local_year, local_month;
  IF year_row.year < local_year OR (year_row.year = local_year AND NEW.effective_month <= local_month) THEN
    RAISE EXCEPTION 'A tariff effective period must be in the future.'
      USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_future_period_required';
  END IF;
  SELECT count(*) INTO chairman_count
  FROM public.official_assignments assignment
  JOIN public.app_accounts account
    ON account.id = assignment.app_account_id
   AND account.rt_unit_id = assignment.rt_unit_id
   AND account.account_type = 'official'
   AND account.status = 'active'
  WHERE assignment.rt_unit_id = NEW.rt_unit_id
    AND assignment.app_account_id = NEW.created_by_account_id
    AND assignment.app_account_type = 'official'
    AND assignment.role = 'rt_chairman'
    AND assignment.starts_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date
    AND (assignment.ends_on IS NULL OR assignment.ends_on >= (now() AT TIME ZONE 'Asia/Jakarta')::date);
  IF chairman_count <> 1 THEN
    RAISE EXCEPTION 'Only one active same-RT Chairman may create a tariff.'
      USING ERRCODE = '42501', CONSTRAINT = 'fee_rate_chairman_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fee_rates_validate_phase11_insert_v1
BEFORE INSERT ON public.fee_rates
FOR EACH ROW EXECUTE FUNCTION public.validate_fee_rate_phase11_insert_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.lock_adjustable_due_phase11_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  due_row public.monthly_dues%ROWTYPE;
  active_received numeric;
  target_after numeric;
  pending_request boolean;
  chairman_count bigint;
BEGIN
  SELECT * INTO due_row
  FROM public.monthly_dues due
  WHERE due.id = NEW.monthly_due_id
    AND due.rt_unit_id = NEW.rt_unit_id
    AND due.household_id = NEW.household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment target was not found in the same RT and household.'
      USING ERRCODE = 'P0002', CONSTRAINT = 'adjustment_due_not_found';
  END IF;
  IF due_row.status NOT IN ('unpaid', 'paid') THEN
    RAISE EXCEPTION 'WAIVED and NOT_DUE obligations cannot receive adjustments.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_due_state_forbidden';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payment_request_claims claim
    JOIN public.payment_requests request ON request.id = claim.request_id
    WHERE claim.monthly_due_id = NEW.monthly_due_id
      AND request.status = 'pending'
  ) INTO pending_request;
  IF pending_request THEN
    RAISE EXCEPTION 'An active pending request protects this due from adjustment.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_pending_request_blocked';
  END IF;

  SELECT count(*) INTO chairman_count
  FROM public.official_assignments assignment
  JOIN public.app_accounts account
    ON account.id = assignment.app_account_id
   AND account.rt_unit_id = assignment.rt_unit_id
   AND account.account_type = 'official'
   AND account.status = 'active'
  WHERE assignment.rt_unit_id = NEW.rt_unit_id
    AND assignment.app_account_id = NEW.adjusted_by_account_id
    AND assignment.app_account_type = 'official'
    AND assignment.role = 'rt_chairman'
    AND assignment.starts_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date
    AND (assignment.ends_on IS NULL OR assignment.ends_on >= (now() AT TIME ZONE 'Asia/Jakarta')::date);
  IF NEW.adjusted_by_account_type <> 'official' OR chairman_count <> 1 THEN
    RAISE EXCEPTION 'Only one active same-RT Chairman may adjust a due.'
      USING ERRCODE = '42501', CONSTRAINT = 'adjustment_chairman_required';
  END IF;

  active_received := public.due_active_received_phase11_v1(NEW.monthly_due_id);
  target_after := public.due_effective_target_phase11_v1(NEW.monthly_due_id) + NEW.amount_delta;
  IF target_after <= 0 OR target_after > 2147483647 THEN
    RAISE EXCEPTION 'Adjustment must leave a positive target within the supported amount range.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_effective_target_positive';
  END IF;
  IF active_received > target_after THEN
    RAISE EXCEPTION 'Adjustment cannot create a credit or overpayment.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_cannot_create_credit';
  END IF;
  IF NEW.effective_target_after::numeric <> target_after THEN
    RAISE EXCEPTION 'Adjustment target snapshot does not match the canonical balance calculation.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_target_snapshot_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER due_adjustments_lock_due_phase11_v1
BEFORE INSERT ON public.due_adjustments
FOR EACH ROW EXECUTE FUNCTION public.lock_adjustable_due_phase11_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_due_active_settlement_phase9_v1(target_due_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  due_row public.monthly_dues%ROWTYPE;
  effective_target numeric;
  active_received numeric;
  settlement_total numeric;
  settlement_count bigint;
  valid_settlement_count bigint;
BEGIN
  SELECT * INTO due_row
  FROM public.monthly_dues
  WHERE id = target_due_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.active_due_settlements WHERE monthly_due_id = target_due_id)
       OR EXISTS (SELECT 1 FROM public.due_adjustments WHERE monthly_due_id = target_due_id) THEN
      RAISE EXCEPTION 'An active financial ledger entry must reference an existing due.'
        USING ERRCODE = '23514', CONSTRAINT = 'financial_ledger_due_required';
    END IF;
    RETURN;
  END IF;

  effective_target := public.due_effective_target_phase11_v1(target_due_id);
  active_received := public.due_active_received_phase11_v1(target_due_id);
  SELECT count(*),
         count(*) FILTER (
           WHERE settlement.rt_unit_id = due_row.rt_unit_id
             AND settlement.household_id = due_row.household_id
             AND settlement.amount = allocation.amount
             AND allocation.amount > 0
             AND payment.rt_unit_id = due_row.rt_unit_id
             AND payment.household_id = due_row.household_id
             AND NOT EXISTS (
               SELECT 1 FROM public.payment_reversals reversal
               WHERE reversal.payment_id = payment.id
             )
             AND (
               (payment.method = 'transfer'
                 AND payment.payment_request_id = allocation.payment_request_id
                 AND allocation.payment_request_id IS NOT NULL
                 AND request.status = 'verified')
               OR
               (payment.method = 'cash'
                 AND payment.payment_request_id IS NULL
                 AND allocation.payment_request_id IS NULL)
             )
         ),
         coalesce(sum(settlement.amount), 0)
  INTO settlement_count, valid_settlement_count, settlement_total
  FROM public.active_due_settlements settlement
  LEFT JOIN public.payment_allocations allocation
    ON allocation.id = settlement.allocation_id
   AND allocation.payment_id = settlement.payment_id
   AND allocation.rt_unit_id = settlement.rt_unit_id
   AND allocation.household_id = settlement.household_id
   AND allocation.monthly_due_id = settlement.monthly_due_id
  LEFT JOIN public.payments payment
    ON payment.id = settlement.payment_id
   AND payment.rt_unit_id = settlement.rt_unit_id
   AND payment.household_id = settlement.household_id
  LEFT JOIN public.payment_requests request
    ON request.id = allocation.payment_request_id
   AND request.rt_unit_id = allocation.rt_unit_id
   AND request.household_id = allocation.household_id
  WHERE settlement.monthly_due_id = target_due_id;

  IF settlement_count <> valid_settlement_count OR settlement_total <> active_received THEN
    RAISE EXCEPTION 'Active settlement ownership must map every non-reversed allocation exactly.'
      USING ERRCODE = '23514', CONSTRAINT = 'active_due_ownership_matches_allocations';
  END IF;
  IF due_row.status IN ('waived', 'not_due') THEN
    IF settlement_count <> 0 OR active_received <> 0
       OR (due_row.status = 'not_due' AND EXISTS (
         SELECT 1 FROM public.due_adjustments WHERE monthly_due_id = target_due_id
       )) THEN
      RAISE EXCEPTION 'WAIVED and NOT_DUE dues cannot have payment ownership; NOT_DUE dues cannot have adjustments.'
        USING ERRCODE = '23514', CONSTRAINT = 'terminal_due_financial_ledger_empty';
    END IF;
    RETURN;
  END IF;

  IF effective_target <= 0 OR active_received > effective_target THEN
    RAISE EXCEPTION 'A due cannot have a nonpositive effective target or an over-allocation.'
      USING ERRCODE = '23514', CONSTRAINT = 'due_effective_balance_valid';
  END IF;

  IF due_row.status = 'paid' AND active_received <> effective_target THEN
    RAISE EXCEPTION 'A PAID due requires active receipts to equal the effective target.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_due_effective_balance_zero';
  END IF;
  IF due_row.status = 'unpaid' AND active_received >= effective_target THEN
    RAISE EXCEPTION 'An UNPAID due must have a positive outstanding balance.'
      USING ERRCODE = '23514', CONSTRAINT = 'unpaid_due_effective_balance_positive';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_payment_request_terminal_transition_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_item_count bigint;
  request_item_total bigint;
  owned_claim_count bigint;
  matching_claim_count bigint;
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('rejected', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' AND (
    NEW.resolved_at IS NULL OR NEW.resolved_by_account_id IS NULL OR
    NEW.resolved_by_account_type IS DISTINCT FROM 'official' OR
    NEW.resolution_reason IS NULL OR length(trim(NEW.resolution_reason)) = 0
  ) THEN
    RAISE EXCEPTION 'A rejection transition requires valid Treasurer resolution metadata.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_rejection_metadata_required';
  ELSIF NEW.status = 'cancelled' AND (
    NEW.resolved_at IS NULL OR NEW.resolved_by_account_id IS DISTINCT FROM NEW.requested_by_account_id OR
    NEW.resolved_by_account_type IS DISTINCT FROM 'resident' OR NEW.resolution_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A cancellation transition requires valid resident resolution metadata.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_cancellation_metadata_required';
  END IF;

  SELECT count(*), coalesce(sum(amount), 0)
  INTO request_item_count, request_item_total
  FROM public.payment_request_items
  WHERE request_id = OLD.id;
  IF request_item_count = 0 OR request_item_count <> OLD.item_count OR request_item_total <> OLD.total_amount THEN
    RAISE EXCEPTION 'A terminal transition requires the complete immutable request snapshot.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_snapshot_required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE payment_request_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.payment_allocations WHERE payment_request_id = OLD.id) THEN
    RAISE EXCEPTION 'A terminal transition cannot proceed when the request already has a payment ledger.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_ledger_empty';
  END IF;

  PERFORM due.id
  FROM public.monthly_dues due
  JOIN public.payment_request_items item
    ON item.rt_unit_id = due.rt_unit_id
   AND item.household_id = due.household_id
   AND item.monthly_due_id = due.id
  WHERE item.request_id = OLD.id
  ORDER BY due.id
  FOR UPDATE OF due;

  IF EXISTS (
    SELECT 1
    FROM public.payment_request_items item
    JOIN public.monthly_dues due
      ON due.rt_unit_id = item.rt_unit_id
     AND due.household_id = item.household_id
     AND due.id = item.monthly_due_id
    JOIN public.billing_years year
      ON year.rt_unit_id = due.rt_unit_id
     AND year.id = due.billing_year_id
    WHERE item.request_id = OLD.id
      AND (
        due.status <> 'unpaid'
        OR item.amount::numeric <> public.due_effective_target_phase11_v1(due.id)
          - public.due_active_received_phase11_v1(due.id)
        OR item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0')
      )
  ) THEN
    RAISE EXCEPTION 'Requested dues must remain unpaid and match their immutable outstanding snapshot when rejected or cancelled.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_due_unpaid_at_transition';
  END IF;

  PERFORM claim.monthly_due_id
  FROM public.payment_request_claims claim
  WHERE claim.request_id = OLD.id
  ORDER BY claim.monthly_due_id
  FOR UPDATE OF claim;

  SELECT count(*) INTO owned_claim_count
  FROM public.payment_request_claims
  WHERE request_id = OLD.id;
  SELECT count(*) INTO matching_claim_count
  FROM public.payment_request_items item
  JOIN public.payment_request_claims claim
    ON claim.request_id = item.request_id
   AND claim.monthly_due_id = item.monthly_due_id
  WHERE item.request_id = OLD.id;
  IF owned_claim_count <> request_item_count OR matching_claim_count <> request_item_count THEN
    RAISE EXCEPTION 'A terminal transition requires complete claims owned by the request.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_claims_complete';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_request_ledger_v1(target_request_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  request_row public.payment_requests%ROWTYPE;
  item_count bigint;
  item_total bigint;
  claim_count bigint;
  payment_count bigint;
  allocation_count bigint;
  payment_total bigint;
  allocation_total bigint;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO request_row FROM public.payment_requests WHERE id = target_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), coalesce(sum(amount), 0)
  INTO item_count, item_total
  FROM public.payment_request_items WHERE request_id = target_request_id;
  IF item_count <> request_row.item_count OR item_total <> request_row.total_amount THEN
    RAISE EXCEPTION 'Payment request snapshot totals do not match its immutable items.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_snapshot_consistent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payment_request_items item
    JOIN public.monthly_dues due
      ON due.rt_unit_id = item.rt_unit_id
     AND due.household_id = item.household_id
     AND due.id = item.monthly_due_id
    JOIN public.billing_years year
      ON year.rt_unit_id = due.rt_unit_id
     AND year.id = due.billing_year_id
    WHERE item.request_id = target_request_id
      AND item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0')
  ) THEN
    RAISE EXCEPTION 'Payment request item period must match its original due period.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_item_period_consistent';
  END IF;

  SELECT count(*) INTO claim_count FROM public.payment_request_claims WHERE request_id = target_request_id;
  SELECT count(*) INTO payment_count FROM public.payments WHERE payment_request_id = target_request_id;
  SELECT count(*), coalesce(sum(amount), 0)
  INTO allocation_count, allocation_total
  FROM public.payment_allocations WHERE payment_request_id = target_request_id;

  IF request_row.status = 'pending' THEN
    IF claim_count <> item_count OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Pending requests require every claim and cannot contain a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_ledger_consistent';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_items item
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id
        AND (due.status <> 'unpaid'
          OR item.amount::numeric <> public.due_effective_target_phase11_v1(due.id)
            - public.due_active_received_phase11_v1(due.id)
          OR item.amount <= 0)
    ) THEN
      RAISE EXCEPTION 'Pending request snapshots must equal each current positive outstanding balance.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_request_matches_effective_balance';
    END IF;
    RETURN;
  ELSIF request_row.status = 'verified' THEN
    IF claim_count <> 0 OR payment_count <> 1 OR allocation_count <> item_count THEN
      RAISE EXCEPTION 'A verified request requires one payment, complete allocations, and no claims.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_ledger_complete';
    END IF;
    SELECT amount INTO payment_total
    FROM public.payments WHERE payment_request_id = target_request_id;
    IF payment_total <> request_row.total_amount OR allocation_total <> payment_total THEN
      RAISE EXCEPTION 'Payment and allocation totals must match the immutable request snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_totals_match';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_request_items item
      WHERE item.request_id = target_request_id
        AND NOT EXISTS (
          SELECT 1 FROM public.payment_allocations allocation
          WHERE allocation.payment_request_id = target_request_id
            AND allocation.rt_unit_id = item.rt_unit_id
            AND allocation.household_id = item.household_id
            AND allocation.monthly_due_id = item.monthly_due_id
            AND allocation.amount = item.amount
        )
    ) THEN
      RAISE EXCEPTION 'Verified allocations must preserve every immutable request item snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_allocations_match';
    END IF;
    SELECT count(*), count(*) FILTER (
      WHERE actor_app_account_id = request_row.verified_by_account_id
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    ) INTO audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action = 'payment_request.verified'
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Verified request requires exactly one matching audit event.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_audit_required';
    END IF;
  ELSE
    IF claim_count <> 0 OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Unverified terminal requests cannot retain claims or a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'unverified_payment_request_ledger_empty';
    END IF;
    SELECT count(*), count(*) FILTER (
      WHERE action = CASE request_row.status
          WHEN 'rejected' THEN 'payment_request.rejected'
          ELSE 'payment_request.cancelled'
        END
        AND actor_app_account_id = request_row.resolved_by_account_id
        AND reason IS NOT DISTINCT FROM CASE
          WHEN request_row.status = 'rejected' THEN request_row.resolution_reason
          ELSE NULL
        END
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    ) INTO audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Resolved request requires exactly one matching historical transition audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_audit_required';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_paid_due_history_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id
     OR NEW.fee_rate_id IS DISTINCT FROM OLD.fee_rate_id
     OR NEW.month IS DISTINCT FROM OLD.month
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A due with financial history cannot have its obligation snapshot rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_history_immutable';
  END IF;
  IF OLD.status = 'not_due' AND NEW.status <> 'not_due' THEN
    RAISE EXCEPTION 'NOT_DUE is terminal and immutable.'
      USING ERRCODE = '55000', CONSTRAINT = 'not_due_status_immutable';
  END IF;
  IF OLD.status = 'waived' AND NEW.status <> 'waived' THEN
    RAISE EXCEPTION 'WAIVED is terminal and immutable.'
      USING ERRCODE = '55000', CONSTRAINT = 'waived_due_immutable';
  END IF;
  IF NEW.status NOT IN ('unpaid', 'paid', 'waived', 'not_due') THEN
    RAISE EXCEPTION 'Unsupported monthly due state.'
      USING ERRCODE = '23514', CONSTRAINT = 'monthly_due_state_supported';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_due_allocation_phase11_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  due_row public.monthly_dues%ROWTYPE;
  current_target numeric;
  current_received numeric;
  expected_outstanding numeric;
  matching_item_amount numeric;
  owning_request_status public.payment_request_status;
BEGIN
  SELECT * INTO due_row
  FROM public.monthly_dues due
  WHERE due.id = NEW.monthly_due_id
    AND due.rt_unit_id = NEW.rt_unit_id
    AND due.household_id = NEW.household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment allocation due must exist in the same household.'
      USING ERRCODE = '23503', CONSTRAINT = 'payment_allocation_due_required';
  END IF;
  IF due_row.status <> 'unpaid' THEN
    RAISE EXCEPTION 'A payment allocation can only settle an UNPAID due.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_allocation_due_unpaid';
  END IF;

  current_target := public.due_effective_target_phase11_v1(NEW.monthly_due_id);
  current_received := public.due_active_received_phase11_v1(NEW.monthly_due_id);
  expected_outstanding := current_target - current_received;
  IF expected_outstanding <= 0 OR NEW.amount::numeric <> expected_outstanding THEN
    RAISE EXCEPTION 'A payment allocation must equal the full current outstanding balance.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_allocation_full_outstanding_required';
  END IF;

  IF NEW.payment_request_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_claims claim
      JOIN public.payment_requests request ON request.id = claim.request_id
      WHERE claim.monthly_due_id = NEW.monthly_due_id AND request.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Cash payment cannot bypass a pending resident request.'
        USING ERRCODE = '23514', CONSTRAINT = 'cash_payment_pending_request_blocked';
    END IF;
  ELSE
    SELECT request.status, item.amount
    INTO owning_request_status, matching_item_amount
    FROM public.payment_request_items item
    JOIN public.payment_requests request ON request.id = item.request_id
    WHERE item.request_id = NEW.payment_request_id
      AND item.monthly_due_id = NEW.monthly_due_id
      AND item.rt_unit_id = NEW.rt_unit_id
      AND item.household_id = NEW.household_id;
    IF NOT FOUND OR owning_request_status <> 'pending' OR matching_item_amount <> NEW.amount THEN
      RAISE EXCEPTION 'Transfer allocation must match its active request item snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'transfer_allocation_request_snapshot_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_request_claims claim
      WHERE claim.request_id = NEW.payment_request_id
        AND claim.monthly_due_id = NEW.monthly_due_id
    ) THEN
      RAISE EXCEPTION 'Transfer allocation requires its matching request claim.'
        USING ERRCODE = '23514', CONSTRAINT = 'transfer_allocation_request_claim_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_allocations_full_balance_phase11_v1
BEFORE INSERT ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.validate_due_allocation_phase11_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_waiver_due_phase10_v1(target_due_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  due_status public.monthly_due_status;
  due_rt_unit_id uuid;
  due_household_id uuid;
  due_effective_target numeric;
  due_waived_reason varchar(500);
  due_period text;
  item_count bigint;
  matching_item_count bigint;
BEGIN
  SELECT due.status, due.rt_unit_id, due.household_id,
         public.due_effective_target_phase11_v1(due.id), due.waived_reason,
         lpad(billing_year.year::text, 4, '0') || '-' || lpad(due.month::text, 2, '0')
  INTO due_status, due_rt_unit_id, due_household_id, due_effective_target, due_waived_reason, due_period
  FROM public.monthly_dues due
  JOIN public.billing_years billing_year
    ON billing_year.id = due.billing_year_id AND billing_year.rt_unit_id = due.rt_unit_id
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
      AND item.amount::numeric = due_effective_target
      AND item.period = due_period
  ) INTO item_count, matching_item_count
  FROM public.waiver_items item
  LEFT JOIN public.waiver_actions action ON action.id = item.waiver_action_id
  WHERE item.monthly_due_id = target_due_id;

  IF due_status = 'waived' THEN
    IF item_count <> 1 OR matching_item_count <> 1 THEN
      RAISE EXCEPTION 'A WAIVED due requires one matching waiver action and effective-target snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_requires_complete_ledger';
    END IF;
    IF EXISTS (SELECT 1 FROM public.active_due_settlements settlement WHERE settlement.monthly_due_id = target_due_id)
       OR public.due_active_received_phase11_v1(target_due_id) <> 0 THEN
      RAISE EXCEPTION 'A WAIVED due cannot have active payment allocations.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_active_settlement_forbidden';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_request_claims claim
      JOIN public.payment_requests request ON request.id = claim.request_id
      WHERE claim.monthly_due_id = target_due_id AND request.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'A WAIVED due cannot have an active pending request claim.'
        USING ERRCODE = '23514', CONSTRAINT = 'waived_due_pending_claim_forbidden';
    END IF;
  ELSIF item_count <> 0 THEN
    RAISE EXCEPTION 'A waiver item can only reference a WAIVED due.'
      USING ERRCODE = '23514', CONSTRAINT = 'waiver_item_requires_waived_due';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_fee_rate_audit_phase11_v1(target_fee_rate_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  rate_row public.fee_rates%ROWTYPE;
  rate_period text;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO rate_row FROM public.fee_rates WHERE id = target_fee_rate_id;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_events audit
      WHERE audit.action = 'fee_rate.created'
        AND audit.entity_type = 'fee_rate'
        AND audit.entity_id = target_fee_rate_id::text
    ) THEN
      RAISE EXCEPTION 'A tariff audit cannot exist without its fee rate.'
        USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_audit_requires_row';
    END IF;
    RETURN;
  END IF;

  IF rate_row.created_by_account_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_events audit
      WHERE audit.action = 'fee_rate.created'
        AND audit.entity_type = 'fee_rate'
        AND audit.entity_id = target_fee_rate_id::text
    ) THEN
      RAISE EXCEPTION 'A bootstrap tariff cannot have a F11 creation audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_legacy_audit_forbidden';
    END IF;
    RETURN;
  END IF;

  SELECT lpad(year.year::text, 4, '0') || '-' || lpad(rate_row.effective_month::text, 2, '0')
  INTO rate_period
  FROM public.billing_years year
  WHERE year.id = rate_row.billing_year_id AND year.rt_unit_id = rate_row.rt_unit_id;

  SELECT count(*), count(*) FILTER (
    WHERE audit.entity_type = 'fee_rate'
      AND audit.actor_app_account_id = rate_row.created_by_account_id
      AND audit.reason IS NULL
      AND audit.context = jsonb_build_object('period', rate_period, 'monthlyAmount', rate_row.monthly_amount)
  ) INTO audit_count, matching_audit_count
  FROM public.audit_events audit
  WHERE audit.action = 'fee_rate.created' AND audit.entity_id = target_fee_rate_id::text;
  IF audit_count <> 1 OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'A F11 tariff requires exactly one matching creation audit.'
      USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_audit_required';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_due_adjustment_audit_phase11_v1(target_adjustment_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  adjustment_row public.due_adjustments%ROWTYPE;
  due_original_amount integer;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO adjustment_row FROM public.due_adjustments WHERE id = target_adjustment_id;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_events audit
      WHERE audit.action = 'billing.adjustment_created'
        AND audit.entity_type = 'due_adjustment'
        AND audit.entity_id = target_adjustment_id::text
    ) THEN
      RAISE EXCEPTION 'An adjustment audit cannot exist without its ledger entry.'
        USING ERRCODE = '23514', CONSTRAINT = 'adjustment_audit_requires_row';
    END IF;
    RETURN;
  END IF;

  SELECT due.amount INTO due_original_amount
  FROM public.monthly_dues due
  WHERE due.id = adjustment_row.monthly_due_id
    AND due.rt_unit_id = adjustment_row.rt_unit_id
    AND due.household_id = adjustment_row.household_id;
  IF NOT FOUND OR due_original_amount <= 0 THEN
    RAISE EXCEPTION 'An adjustment must reference a positive original obligation.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_original_due_required';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE audit.entity_type = 'due_adjustment'
      AND audit.actor_app_account_id = adjustment_row.adjusted_by_account_id
      AND audit.reason = adjustment_row.reason
      AND audit.context = jsonb_build_object(
        'amountDelta', adjustment_row.amount_delta,
        'effectiveTargetAfter', adjustment_row.effective_target_after,
        'originalAmount', due_original_amount
      )
  ) INTO audit_count, matching_audit_count
  FROM public.audit_events audit
  WHERE audit.action = 'billing.adjustment_created'
    AND audit.entity_id = target_adjustment_id::text;
  IF audit_count <> 1 OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'An adjustment requires exactly one matching audit with its reason and balance snapshot.'
      USING ERRCODE = '23514', CONSTRAINT = 'adjustment_audit_required';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_phase11_audit_ledger_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_fee_rate_id uuid;
  target_adjustment_id uuid;
  target_due_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'fee_rates' THEN
    target_fee_rate_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'due_adjustments' THEN
    IF TG_OP = 'DELETE' THEN
      target_adjustment_id := OLD.id;
      target_due_id := OLD.monthly_due_id;
    ELSE
      target_adjustment_id := NEW.id;
      target_due_id := NEW.monthly_due_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'audit_events' AND TG_OP <> 'DELETE' THEN
    IF NEW.action = 'fee_rate.created' THEN
      IF NEW.entity_type <> 'fee_rate' OR NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Tariff audit requires a fee rate UUID entity.'
          USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_audit_entity_valid';
      END IF;
      target_fee_rate_id := NEW.entity_id::uuid;
    ELSIF NEW.action = 'billing.adjustment_created' THEN
      IF NEW.entity_type <> 'due_adjustment'
         OR NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NEW.reason IS NULL THEN
        RAISE EXCEPTION 'Adjustment audit requires a due adjustment UUID and a mandatory reason.'
          USING ERRCODE = '23514', CONSTRAINT = 'adjustment_audit_entity_valid';
      END IF;
      target_adjustment_id := NEW.entity_id::uuid;
    END IF;
  END IF;

  IF target_fee_rate_id IS NOT NULL THEN
    PERFORM public.assert_fee_rate_audit_phase11_v1(target_fee_rate_id);
  END IF;
  IF target_adjustment_id IS NOT NULL THEN
    PERFORM public.assert_due_adjustment_audit_phase11_v1(target_adjustment_id);
  END IF;
  IF target_due_id IS NOT NULL THEN
    PERFORM public.assert_due_active_settlement_phase9_v1(target_due_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER due_adjustments_ledger_check_phase11_v1
AFTER INSERT OR UPDATE OR DELETE ON public.due_adjustments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_audit_ledger_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fee_rates_audit_check_phase11_v1
AFTER INSERT OR UPDATE OR DELETE ON public.fee_rates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_audit_ledger_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER phase11_audit_event_check_v1
AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_phase11_audit_ledger_v1();
--> statement-breakpoint
DO $$
DECLARE
  target_due_id uuid;
BEGIN
  FOR target_due_id IN SELECT id FROM public.monthly_dues ORDER BY id LOOP
    PERFORM public.assert_due_active_settlement_phase9_v1(target_due_id);
    PERFORM public.assert_waiver_due_phase10_v1(target_due_id);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_request_phase9_v1(target_request_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  request_row public.payment_requests%ROWTYPE;
  item_count bigint;
  item_total numeric;
  claim_count bigint;
  payment_count bigint;
  allocation_count bigint;
  allocation_total numeric;
  target_payment_id uuid;
  has_reversal boolean;
  transition_audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO request_row FROM public.payment_requests WHERE id = target_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), coalesce(sum(amount), 0)
  INTO item_count, item_total
  FROM public.payment_request_items
  WHERE request_id = target_request_id;
  IF item_count <> request_row.item_count OR item_total <> request_row.total_amount THEN
    RAISE EXCEPTION 'Payment request snapshot totals do not match its immutable items.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_snapshot_consistent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payment_request_items item
    JOIN public.monthly_dues due
      ON due.rt_unit_id = item.rt_unit_id
     AND due.household_id = item.household_id
     AND due.id = item.monthly_due_id
    JOIN public.billing_years year
      ON year.rt_unit_id = due.rt_unit_id
     AND year.id = due.billing_year_id
    WHERE item.request_id = target_request_id
      AND item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0')
  ) THEN
    RAISE EXCEPTION 'Payment request item period must match its original due period.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_item_period_consistent';
  END IF;

  SELECT count(*) INTO claim_count FROM public.payment_request_claims WHERE request_id = target_request_id;
  SELECT count(*) INTO payment_count FROM public.payments WHERE payment_request_id = target_request_id;
  SELECT count(*), coalesce(sum(amount), 0)
  INTO allocation_count, allocation_total
  FROM public.payment_allocations WHERE payment_request_id = target_request_id;

  IF request_row.status = 'pending' THEN
    IF claim_count <> item_count OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Pending requests require every claim and cannot contain a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_ledger_consistent';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_items item
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id
        AND (due.status <> 'unpaid'
          OR item.amount <> public.due_effective_target_phase11_v1(due.id) - public.due_active_received_phase11_v1(due.id)
          OR item.amount <= 0)
    ) THEN
      RAISE EXCEPTION 'Pending request snapshots must equal each current positive outstanding balance.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_request_matches_effective_balance';
    END IF;
    SELECT count(*) INTO transition_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request' AND entity_id = target_request_id::text;
    IF transition_audit_count <> 0 THEN
      RAISE EXCEPTION 'A pending request cannot have a terminal transition audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_terminal_audit_forbidden';
    END IF;
    RETURN;
  END IF;

  IF request_row.status = 'verified' THEN
    IF claim_count <> 0 OR payment_count <> 1 OR allocation_count <> item_count THEN
      RAISE EXCEPTION 'A verified request requires one payment, complete allocations, and no claims.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_ledger_complete';
    END IF;
    SELECT payment.id, EXISTS (
      SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
    ) INTO target_payment_id, has_reversal
    FROM public.payments payment WHERE payment.payment_request_id = target_request_id;
    IF allocation_total <> request_row.total_amount OR EXISTS (
      SELECT 1 FROM public.payments payment
      WHERE payment.id = target_payment_id AND payment.amount <> request_row.total_amount
    ) THEN
      RAISE EXCEPTION 'Verified payment and allocations must match the immutable request total.'
        USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_totals_match';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_request_items item
      WHERE item.request_id = target_request_id
        AND NOT EXISTS (
          SELECT 1 FROM public.payment_allocations allocation
          WHERE allocation.payment_id = target_payment_id
            AND allocation.payment_request_id = target_request_id
            AND allocation.rt_unit_id = item.rt_unit_id
            AND allocation.household_id = item.household_id
            AND allocation.monthly_due_id = item.monthly_due_id
            AND allocation.amount = item.amount
        )
    ) THEN
      RAISE EXCEPTION 'Verified allocations must preserve every request item snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_allocations_match';
    END IF;
    IF has_reversal AND EXISTS (
      SELECT 1 FROM public.active_due_settlements settlement WHERE settlement.payment_id = target_payment_id
    ) THEN
      RAISE EXCEPTION 'A reversed transfer payment cannot retain active ownership.'
        USING ERRCODE = '23514', CONSTRAINT = 'reversed_transfer_active_ownership_forbidden';
    ELSIF NOT has_reversal AND EXISTS (
      SELECT 1 FROM public.payment_allocations allocation
      LEFT JOIN public.active_due_settlements settlement
        ON settlement.allocation_id = allocation.id
       AND settlement.payment_id = allocation.payment_id
       AND settlement.monthly_due_id = allocation.monthly_due_id
       AND settlement.amount = allocation.amount
      WHERE allocation.payment_id = target_payment_id AND settlement.allocation_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Every active transfer allocation requires its own active ownership row.'
        USING ERRCODE = '23514', CONSTRAINT = 'active_transfer_settlements_complete';
    END IF;

    SELECT count(*), count(*) FILTER (
      WHERE action = 'payment_request.verified'
        AND actor_app_account_id = request_row.verified_by_account_id
        AND reason IS NULL
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    ) INTO transition_audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request' AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Verified request requires exactly one matching historical audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_audit_required';
    END IF;
    RETURN;
  END IF;

  IF request_row.status IN ('rejected', 'cancelled') THEN
    IF claim_count <> 0 OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Rejected or cancelled requests cannot retain claims or payment ledger rows.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_ledger_empty';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_request_items item
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status = 'not_due'
    ) THEN
      RAISE EXCEPTION 'A request history cannot reference a NOT_DUE obligation.'
        USING ERRCODE = '23514', CONSTRAINT = 'request_not_due_forbidden';
    END IF;
    SELECT count(*), count(*) FILTER (
      WHERE action = CASE request_row.status
          WHEN 'rejected' THEN 'payment_request.rejected' ELSE 'payment_request.cancelled' END
        AND actor_app_account_id = request_row.resolved_by_account_id
        AND reason IS NOT DISTINCT FROM CASE WHEN request_row.status = 'rejected' THEN request_row.resolution_reason ELSE NULL END
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    ) INTO transition_audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request' AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Resolved request requires exactly one matching historical audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_audit_required';
    END IF;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported payment request state.'
    USING ERRCODE = '23514', CONSTRAINT = 'payment_request_state_supported';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_ledger_phase9_v1(target_payment_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  allocation_count bigint;
  valid_allocation_count bigint;
  allocation_total numeric;
  reversal_count bigint;
  settlement_count bigint;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id = target_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (
    WHERE allocation.rt_unit_id = payment_row.rt_unit_id
      AND allocation.household_id = payment_row.household_id
      AND due.id IS NOT NULL
      AND allocation.amount > 0
      AND (
        (payment_row.method = 'transfer'
          AND payment_row.payment_request_id = allocation.payment_request_id
          AND allocation.payment_request_id IS NOT NULL
          AND request.status = 'verified')
        OR
        (payment_row.method = 'cash'
          AND payment_row.payment_request_id IS NULL
          AND allocation.payment_request_id IS NULL)
      )
  ), coalesce(sum(allocation.amount), 0)
  INTO allocation_count, valid_allocation_count, allocation_total
  FROM public.payment_allocations allocation
  LEFT JOIN public.monthly_dues due
    ON due.id = allocation.monthly_due_id
   AND due.rt_unit_id = allocation.rt_unit_id
   AND due.household_id = allocation.household_id
  LEFT JOIN public.payment_requests request
    ON request.id = allocation.payment_request_id
   AND request.rt_unit_id = allocation.rt_unit_id
   AND request.household_id = allocation.household_id
  WHERE allocation.payment_id = target_payment_id;

  IF allocation_count = 0 OR valid_allocation_count <> allocation_count OR allocation_total <> payment_row.amount THEN
    RAISE EXCEPTION 'Payment requires complete immutable same-household allocations matching its total and source.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_ledger_complete_phase9';
  END IF;
  SELECT count(*) INTO reversal_count FROM public.payment_reversals WHERE payment_id = target_payment_id;
  SELECT count(*) INTO settlement_count FROM public.active_due_settlements WHERE payment_id = target_payment_id;

  IF reversal_count = 0 THEN
    IF settlement_count <> allocation_count OR EXISTS (
      SELECT 1 FROM public.payment_allocations allocation
      LEFT JOIN public.active_due_settlements settlement
        ON settlement.allocation_id = allocation.id
       AND settlement.payment_id = allocation.payment_id
       AND settlement.rt_unit_id = allocation.rt_unit_id
       AND settlement.household_id = allocation.household_id
       AND settlement.monthly_due_id = allocation.monthly_due_id
       AND settlement.amount = allocation.amount
      WHERE allocation.payment_id = target_payment_id AND settlement.allocation_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Every active payment allocation must have one matching ownership row.'
        USING ERRCODE = '23514', CONSTRAINT = 'active_payment_settlements_complete';
    END IF;
  ELSIF settlement_count <> 0 THEN
    RAISE EXCEPTION 'A reversed payment cannot own active due settlements.'
      USING ERRCODE = '23514', CONSTRAINT = 'reversed_payment_active_ownership_forbidden';
  END IF;

  IF payment_row.method = 'cash' THEN
    SELECT count(*), count(*) FILTER (
      WHERE actor_app_account_id = payment_row.verified_by_account_id
        AND reason IS NULL
        AND context = jsonb_build_object('itemCount', allocation_count, 'method', 'cash', 'totalAmount', payment_row.amount)
    ) INTO audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action = 'payment.cash_recorded' AND entity_type = 'payment' AND entity_id = target_payment_id::text;
    IF audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Cash payment requires exactly one matching historical audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'cash_payment_audit_required';
    END IF;
  ELSIF payment_row.method = 'transfer' THEN
    PERFORM public.assert_payment_request_phase9_v1(payment_row.payment_request_id);
  ELSE
    RAISE EXCEPTION 'Unsupported payment method.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_method_supported_phase9';
  END IF;
  PERFORM public.assert_payment_reversal_phase9_v1(target_payment_id);
END;
$$;
