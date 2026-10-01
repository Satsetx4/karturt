ALTER TABLE "payments" DROP CONSTRAINT "payments_method_transfer_only";--> statement-breakpoint
ALTER TABLE "payment_allocations" ALTER COLUMN "payment_request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_idempotency_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_household_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","payment_id") REFERENCES "public"."payments"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_cash_idempotency_uq" ON "payments" USING btree ("rt_unit_id","verified_by_account_id","cash_idempotency_key") WHERE "payments"."method" = 'cash';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_source_consistent" CHECK (("payments"."method" = 'transfer' and "payments"."payment_request_id" is not null) or ("payments"."method" = 'cash' and "payments"."payment_request_id" is null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_idempotency_consistent" CHECK (("payments"."method" = 'cash' and "payments"."cash_idempotency_key" is not null and "payments"."cash_idempotency_key"::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and "payments"."cash_idempotency_fingerprint" ~ '^[0-9a-f]{64}$') or ("payments"."method" = 'transfer' and "payments"."cash_idempotency_key" is null and "payments"."cash_idempotency_fingerprint" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_cash_payment_ledger_v1(target_payment_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  payment_row payments%ROWTYPE;
  allocation_count bigint;
  valid_allocation_count bigint;
  allocation_total bigint;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO payment_row
  FROM payments
  WHERE id = target_payment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF payment_row.method <> 'cash' OR payment_row.payment_request_id IS NOT NULL OR
     payment_row.verified_by_account_type <> 'official' OR
     payment_row.cash_idempotency_key IS NULL OR
     payment_row.cash_idempotency_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Cash payment source, actor, and idempotency metadata are inconsistent.'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_payment_source_consistent';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE allocation.payment_request_id IS NULL
             AND allocation.rt_unit_id = payment_row.rt_unit_id
             AND allocation.household_id = payment_row.household_id
             AND due.status = 'paid'
             AND due.amount = allocation.amount
         ),
         coalesce(sum(allocation.amount), 0)
  INTO allocation_count, valid_allocation_count, allocation_total
  FROM payment_allocations allocation
  LEFT JOIN monthly_dues due
    ON due.rt_unit_id = allocation.rt_unit_id
   AND due.household_id = allocation.household_id
   AND due.id = allocation.monthly_due_id
  WHERE allocation.payment_id = target_payment_id;

  IF allocation_count = 0 OR valid_allocation_count <> allocation_count OR
     allocation_total <> payment_row.amount THEN
    RAISE EXCEPTION 'Cash payment requires complete same-household allocations matching paid dues and total.'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_payment_ledger_complete';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE actor_app_account_id = payment_row.verified_by_account_id
      AND reason IS NULL
      AND context = jsonb_build_object(
        'itemCount', allocation_count,
        'method', 'cash',
        'totalAmount', payment_row.amount
      )
  )
  INTO audit_count, matching_audit_count
  FROM audit_events
  WHERE action = 'payment.cash_recorded'
    AND entity_type = 'payment'
    AND entity_id = target_payment_id::text;

  IF audit_count <> 1 OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'Cash payment requires exactly one matching audit event.'
      USING ERRCODE = '23514', CONSTRAINT = 'cash_payment_audit_required';
  END IF;
END;
$$;
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
      SELECT 1
      FROM payment_request_items item
      JOIN monthly_dues due
        ON due.rt_unit_id = item.rt_unit_id
       AND due.household_id = item.household_id
       AND due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id
        AND due.status <> 'unpaid'
        AND NOT (
          due.status = 'paid'
          AND EXISTS (
            SELECT 1
            FROM payment_allocations allocation
            JOIN payments payment
              ON payment.id = allocation.payment_id
             AND payment.rt_unit_id = allocation.rt_unit_id
             AND payment.household_id = allocation.household_id
            LEFT JOIN payment_requests allocation_request
              ON allocation_request.id = allocation.payment_request_id
             AND allocation_request.rt_unit_id = allocation.rt_unit_id
             AND allocation_request.household_id = allocation.household_id
            WHERE allocation.rt_unit_id = due.rt_unit_id
              AND allocation.household_id = due.household_id
              AND allocation.monthly_due_id = due.id
              AND allocation.amount = due.amount
              AND (
                (payment.method = 'transfer'
                  AND payment.payment_request_id = allocation.payment_request_id
                  AND allocation_request.status = 'verified')
                OR
                (payment.method = 'cash'
                  AND payment.payment_request_id IS NULL
                  AND allocation.payment_request_id IS NULL)
              )
          )
        )
    ) THEN
      RAISE EXCEPTION 'Unverified terminal request dues must remain unpaid or be settled by a valid later payment.'
        USING ERRCODE = '23514', CONSTRAINT = 'unverified_payment_request_due_unpaid';
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
CREATE OR REPLACE FUNCTION public.validate_payment_request_ledger_change_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_request_id uuid;
  target_payment_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'payment_requests' THEN
      target_request_id := OLD.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN
      target_request_id := OLD.request_id;
    ELSIF TG_TABLE_NAME = 'payments' THEN
      target_request_id := OLD.payment_request_id;
      target_payment_id := OLD.id;
    ELSE
      target_request_id := OLD.payment_request_id;
      target_payment_id := OLD.payment_id;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'payment_requests' THEN
      target_request_id := NEW.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN
      target_request_id := NEW.request_id;
    ELSIF TG_TABLE_NAME = 'payments' THEN
      target_request_id := NEW.payment_request_id;
      target_payment_id := NEW.id;
    ELSE
      target_request_id := NEW.payment_request_id;
      target_payment_id := NEW.payment_id;
    END IF;
  END IF;

  IF target_request_id IS NOT NULL THEN
    PERFORM public.assert_payment_request_ledger_v1(target_request_id);
  ELSIF target_payment_id IS NOT NULL THEN
    PERFORM public.assert_cash_payment_ledger_v1(target_payment_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_paid_due_allocation_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  must_validate boolean := false;
BEGIN
  IF NEW.status = 'paid' THEN
    IF TG_OP = 'INSERT' THEN
      must_validate := true;
    ELSE
      must_validate := OLD.status IS DISTINCT FROM NEW.status;
    END IF;
  END IF;
  IF must_validate AND NOT EXISTS (
    SELECT 1
    FROM payment_allocations allocation
    JOIN payments payment
      ON payment.id = allocation.payment_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    LEFT JOIN payment_requests request
      ON request.id = allocation.payment_request_id
     AND request.rt_unit_id = allocation.rt_unit_id
     AND request.household_id = allocation.household_id
    WHERE allocation.rt_unit_id = NEW.rt_unit_id
      AND allocation.household_id = NEW.household_id
      AND allocation.monthly_due_id = NEW.id
      AND allocation.amount = NEW.amount
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
  ) THEN
    RAISE EXCEPTION 'A monthly due can be paid only with a valid transfer or cash allocation.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_monthly_due_requires_allocation';
  END IF;
  RETURN NULL;
END;
$$;
