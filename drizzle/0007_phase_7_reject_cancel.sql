ALTER TABLE "payment_requests" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "resolved_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "resolved_by_account_type" "account_type";--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "resolution_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_resolved_by_scope_fk" FOREIGN KEY ("rt_unit_id","resolved_by_account_id","resolved_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_requests_requester_created_idx" ON "payment_requests" USING btree ("requested_by_account_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_resolution_metadata_consistent" CHECK (("payment_requests"."status" in ('pending', 'verified') and "payment_requests"."resolved_at" is null and "payment_requests"."resolved_by_account_id" is null and "payment_requests"."resolved_by_account_type" is null and "payment_requests"."resolution_reason" is null) or ("payment_requests"."status" = 'rejected' and "payment_requests"."resolved_at" is not null and "payment_requests"."resolved_by_account_id" is not null and "payment_requests"."resolved_by_account_type" = 'official' and "payment_requests"."resolution_reason" is not null and length(trim("payment_requests"."resolution_reason")) > 0) or ("payment_requests"."status" = 'cancelled' and "payment_requests"."resolved_at" is not null and "payment_requests"."resolved_by_account_id" = "payment_requests"."requested_by_account_id" and "payment_requests"."resolved_by_account_type" = 'resident' and "payment_requests"."resolution_reason" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_payment_request_history_v2() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment request history cannot be deleted.'
      USING ERRCODE = '55000', CONSTRAINT = 'payment_request_history_retained';
  END IF;

  IF ROW(
    NEW.id, NEW.request_code, NEW.rt_unit_id, NEW.household_id,
    NEW.requested_by_account_id, NEW.requested_by_account_type,
    NEW.idempotency_key, NEW.request_fingerprint, NEW.total_amount,
    NEW.item_count, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.request_code, OLD.rt_unit_id, OLD.household_id,
    OLD.requested_by_account_id, OLD.requested_by_account_type,
    OLD.idempotency_key, OLD.request_fingerprint, OLD.total_amount,
    OLD.item_count, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Payment request snapshot fields are immutable.'
      USING ERRCODE = '55000', CONSTRAINT = 'payment_request_snapshot_immutable';
  END IF;

  IF OLD.status <> 'pending' AND ROW(
    NEW.status, NEW.verified_by_account_id, NEW.verified_by_account_type, NEW.verified_at,
    NEW.resolved_at, NEW.resolved_by_account_id, NEW.resolved_by_account_type, NEW.resolution_reason
  ) IS DISTINCT FROM ROW(
    OLD.status, OLD.verified_by_account_id, OLD.verified_by_account_type, OLD.verified_at,
    OLD.resolved_at, OLD.resolved_by_account_id, OLD.resolved_by_account_type, OLD.resolution_reason
  ) THEN
    RAISE EXCEPTION 'Processed payment request history cannot be rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'payment_request_state_terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER payment_requests_guard_history_v1 ON public.payment_requests;
--> statement-breakpoint
CREATE TRIGGER payment_requests_guard_history_v2
BEFORE UPDATE OR DELETE ON public.payment_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_request_history_v2();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_request_ledger_v1(target_request_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  request_row payment_requests%ROWTYPE;
  item_count bigint;
  item_total bigint;
  claim_count bigint;
  payment_count bigint;
  allocation_count bigint;
  payment_total bigint;
  allocation_total bigint;
  transition_audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO request_row
  FROM payment_requests
  WHERE id = target_request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), coalesce(sum(amount), 0)
  INTO item_count, item_total
  FROM payment_request_items
  WHERE request_id = target_request_id;
  IF item_count <> request_row.item_count OR item_total <> request_row.total_amount THEN
    RAISE EXCEPTION 'Payment request snapshot totals do not match its items.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_snapshot_consistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_request_items item
    JOIN monthly_dues due
      ON due.rt_unit_id = item.rt_unit_id
     AND due.household_id = item.household_id
     AND due.id = item.monthly_due_id
    JOIN billing_years year
      ON year.rt_unit_id = due.rt_unit_id
     AND year.id = due.billing_year_id
    WHERE item.request_id = target_request_id
      AND (item.amount <> due.amount OR item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0'))
  ) THEN
    RAISE EXCEPTION 'Payment request item no longer matches its due period and amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_item_due_consistent';
  END IF;

  SELECT count(*) INTO claim_count
  FROM payment_request_claims
  WHERE request_id = target_request_id;
  SELECT count(*) INTO payment_count
  FROM payments
  WHERE payment_request_id = target_request_id;
  SELECT count(*), coalesce(sum(amount), 0)
  INTO allocation_count, allocation_total
  FROM payment_allocations
  WHERE payment_request_id = target_request_id;

  IF request_row.status = 'pending' THEN
    IF claim_count <> item_count OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Pending payment request must keep its complete claims and have no ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_ledger_consistent';
    END IF;
    IF EXISTS (
      SELECT 1 FROM payment_request_items item
      JOIN monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status <> 'unpaid'
    ) THEN
      RAISE EXCEPTION 'Pending payment request items must remain unpaid.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_due_unpaid';
    END IF;
    SELECT count(*) INTO transition_audit_count
    FROM audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 0 THEN
      RAISE EXCEPTION 'Pending request cannot have a terminal transition audit event.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_terminal_audit_forbidden';
    END IF;
  ELSIF request_row.status = 'verified' THEN
    IF claim_count <> 0 OR payment_count <> 1 OR allocation_count <> item_count THEN
      RAISE EXCEPTION 'Verified request requires one payment, a complete allocation set, and no claims.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_ledger_complete';
    END IF;
    SELECT amount INTO payment_total
    FROM payments
    WHERE payment_request_id = target_request_id;
    IF payment_total <> request_row.total_amount OR allocation_total <> payment_total THEN
      RAISE EXCEPTION 'Payment and allocation totals must match the request snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_totals_match';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM payment_allocations allocation
      JOIN monthly_dues due
        ON due.rt_unit_id = allocation.rt_unit_id
       AND due.household_id = allocation.household_id
       AND due.id = allocation.monthly_due_id
      WHERE allocation.payment_request_id = target_request_id
        AND (due.status <> 'paid' OR due.amount <> allocation.amount)
    ) THEN
      RAISE EXCEPTION 'Verified request allocations must match paid due rows.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_due_allocations_match';
    END IF;
    SELECT count(*), count(*) FILTER (
      WHERE action = 'payment_request.verified'
        AND actor_app_account_id = request_row.verified_by_account_id
        AND reason IS NULL
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    )
    INTO transition_audit_count, matching_audit_count
    FROM audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Verified request requires exactly one matching transition audit event.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_audit_required';
    END IF;
  ELSIF request_row.status IN ('rejected', 'cancelled') THEN
    IF claim_count <> 0 OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Rejected or cancelled request cannot retain claims or a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_ledger_empty';
    END IF;
    IF EXISTS (
      SELECT 1 FROM payment_request_items item
      JOIN monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status <> 'unpaid'
    ) THEN
      RAISE EXCEPTION 'Rejected or cancelled request items must remain unpaid.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_due_unpaid';
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
    )
    INTO transition_audit_count, matching_audit_count
    FROM audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Resolved request requires exactly one matching transition audit event.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_audit_required';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported payment request state.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_state_supported';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.validate_payment_request_transition_audit_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_request_id uuid;
BEGIN
  IF NEW.action NOT IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
     OR NEW.entity_type <> 'payment_request' THEN
    RETURN NULL;
  END IF;
  BEGIN
    target_request_id := NEW.entity_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Payment request transition audit must reference an existing request.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_transition_audit_target';
  END;
  IF NOT EXISTS (SELECT 1 FROM payment_requests WHERE id = target_request_id) THEN
    RAISE EXCEPTION 'Payment request transition audit must reference an existing request.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_transition_audit_target';
  END IF;
  PERFORM assert_payment_request_ledger_v1(target_request_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_transition_audit_check_v1
AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_request_transition_audit_v1();
