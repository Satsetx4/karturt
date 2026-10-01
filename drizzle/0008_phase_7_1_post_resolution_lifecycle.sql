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
  FROM payment_request_items
  WHERE request_id = OLD.id;
  IF request_item_count = 0 OR request_item_count <> OLD.item_count OR request_item_total <> OLD.total_amount THEN
    RAISE EXCEPTION 'A terminal transition requires the complete immutable request snapshot.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_snapshot_required';
  END IF;

  PERFORM due.id
  FROM monthly_dues due
  JOIN payment_request_items item
    ON item.rt_unit_id = due.rt_unit_id
   AND item.household_id = due.household_id
   AND item.monthly_due_id = due.id
  WHERE item.request_id = OLD.id
  ORDER BY due.id
  FOR UPDATE OF due;

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
    WHERE item.request_id = OLD.id
      AND (due.status <> 'unpaid' OR item.amount <> due.amount OR item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0'))
  ) THEN
    RAISE EXCEPTION 'Requested dues must still be unpaid and match their immutable snapshot when rejected or cancelled.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_due_unpaid_at_transition';
  END IF;

  PERFORM claim.monthly_due_id
  FROM payment_request_claims claim
  WHERE claim.request_id = OLD.id
  ORDER BY claim.monthly_due_id
  FOR UPDATE OF claim;

  SELECT count(*) INTO owned_claim_count
  FROM payment_request_claims
  WHERE request_id = OLD.id;
  SELECT count(*) INTO matching_claim_count
  FROM payment_request_items item
  JOIN payment_request_claims claim
    ON claim.request_id = item.request_id
   AND claim.monthly_due_id = item.monthly_due_id
  WHERE item.request_id = OLD.id;
  IF owned_claim_count <> request_item_count OR matching_claim_count <> request_item_count THEN
    RAISE EXCEPTION 'A terminal transition requires complete claims owned by the request.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_claims_complete';
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE payment_request_id = OLD.id)
     OR EXISTS (SELECT 1 FROM payment_allocations WHERE payment_request_id = OLD.id) THEN
    RAISE EXCEPTION 'A terminal transition cannot proceed when the request already has a payment ledger.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_terminal_ledger_empty';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_requests_guard_terminal_transition_v1
BEFORE UPDATE OF status ON public.payment_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_request_terminal_transition_v1();
