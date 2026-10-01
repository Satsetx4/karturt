CREATE TABLE "active_due_settlements" (
	"monthly_due_id" uuid PRIMARY KEY NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "active_due_settlements_positive_amount" CHECK ("active_due_settlements"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"reversed_by_account_id" uuid NOT NULL,
	"reversed_by_account_type" "account_type" DEFAULT 'official' NOT NULL,
	"reason" varchar(500) NOT NULL,
	"reversed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_reason_not_blank" CHECK (length(trim("payment_reversals"."reason")) > 0),
	CONSTRAINT "payment_reversals_actor_official" CHECK ("payment_reversals"."reversed_by_account_type" = 'official')
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_active_owner_scope_uq" UNIQUE("id","payment_id","rt_unit_id","household_id","monthly_due_id");
--> statement-breakpoint
ALTER TABLE "active_due_settlements" ADD CONSTRAINT "active_due_settlements_due_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."monthly_dues"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_due_settlements" ADD CONSTRAINT "active_due_settlements_payment_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","payment_id") REFERENCES "public"."payments"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_due_settlements" ADD CONSTRAINT "active_due_settlements_allocation_scope_fk" FOREIGN KEY ("allocation_id","payment_id","rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."payment_allocations"("id","payment_id","rt_unit_id","household_id","monthly_due_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","payment_id") REFERENCES "public"."payments"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_actor_scope_fk" FOREIGN KEY ("rt_unit_id","reversed_by_account_id","reversed_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "active_due_settlements_allocation_uq" ON "active_due_settlements" USING btree ("allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "active_due_settlements_payment_due_uq" ON "active_due_settlements" USING btree ("payment_id","monthly_due_id");--> statement-breakpoint
CREATE INDEX "active_due_settlements_payment_idx" ON "active_due_settlements" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reversals_payment_uq" ON "payment_reversals" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_reversals_rt_time_idx" ON "payment_reversals" USING btree ("rt_unit_id","reversed_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT due.id
    FROM public.monthly_dues due
    LEFT JOIN LATERAL (
      SELECT count(*) AS candidate_count
      FROM public.payment_allocations allocation
      JOIN public.payments payment
        ON payment.id = allocation.payment_id
       AND payment.rt_unit_id = allocation.rt_unit_id
       AND payment.household_id = allocation.household_id
      LEFT JOIN public.payment_requests request
        ON request.id = allocation.payment_request_id
       AND request.rt_unit_id = allocation.rt_unit_id
       AND request.household_id = allocation.household_id
      WHERE allocation.monthly_due_id = due.id
        AND allocation.rt_unit_id = due.rt_unit_id
        AND allocation.household_id = due.household_id
        AND allocation.amount = due.amount
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
    ) candidate ON true
    WHERE (due.status = 'paid' AND candidate.candidate_count <> 1)
       OR (due.status <> 'paid' AND candidate.candidate_count <> 0)
  ) THEN
    RAISE EXCEPTION 'Phase 9 backfill refused: each paid due must have exactly one valid current payment allocation and non-paid dues must have none.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase9_backfill_current_settlement_consistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_allocations allocation
    LEFT JOIN public.payments payment
      ON payment.id = allocation.payment_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    LEFT JOIN public.monthly_dues due
      ON due.id = allocation.monthly_due_id
     AND due.rt_unit_id = allocation.rt_unit_id
     AND due.household_id = allocation.household_id
    LEFT JOIN public.payment_requests request
      ON request.id = allocation.payment_request_id
     AND request.rt_unit_id = allocation.rt_unit_id
     AND request.household_id = allocation.household_id
    WHERE payment.id IS NULL
       OR due.id IS NULL
       OR due.status <> 'paid'
       OR due.amount <> allocation.amount
       OR NOT (
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
    RAISE EXCEPTION 'Phase 9 backfill refused: a historical allocation does not match its current paid due and source ledger.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase9_backfill_allocation_history_consistent';
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO public.active_due_settlements (
  monthly_due_id, rt_unit_id, household_id, payment_id, allocation_id, amount
)
SELECT due.id, due.rt_unit_id, due.household_id, payment.id, allocation.id, allocation.amount
FROM public.monthly_dues due
JOIN public.payment_allocations allocation
  ON allocation.monthly_due_id = due.id
 AND allocation.rt_unit_id = due.rt_unit_id
 AND allocation.household_id = due.household_id
 AND allocation.amount = due.amount
JOIN public.payments payment
  ON payment.id = allocation.payment_id
 AND payment.rt_unit_id = allocation.rt_unit_id
 AND payment.household_id = allocation.household_id
LEFT JOIN public.payment_requests request
  ON request.id = allocation.payment_request_id
 AND request.rt_unit_id = allocation.rt_unit_id
 AND request.household_id = allocation.household_id
WHERE due.status = 'paid'
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
ORDER BY due.id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_payment_reversal_mutation_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment reversal history is append-only.'
    USING ERRCODE = '55000', CONSTRAINT = 'payment_reversal_history_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_reversals_reject_update_delete_v1
BEFORE UPDATE OR DELETE ON public.payment_reversals
FOR EACH ROW EXECUTE FUNCTION public.reject_payment_reversal_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER payment_reversals_reject_truncate_v1
BEFORE TRUNCATE ON public.payment_reversals
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_payment_reversal_mutation_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_active_due_settlement_update_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Active due settlement ownership may only be created or released by a valid ledger transition.'
    USING ERRCODE = '55000', CONSTRAINT = 'active_due_settlement_update_forbidden';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER active_due_settlements_reject_update_v1
BEFORE UPDATE ON public.active_due_settlements
FOR EACH ROW EXECUTE FUNCTION public.reject_active_due_settlement_update_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_reversal_phase9_v1(target_payment_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  payment_row public.payments%ROWTYPE;
  reversal_row public.payment_reversals%ROWTYPE;
  allocation_count bigint;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO payment_row
  FROM public.payments
  WHERE id = target_payment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO reversal_row
  FROM public.payment_reversals
  WHERE payment_id = target_payment_id;

  SELECT count(*) INTO allocation_count
  FROM public.payment_allocations
  WHERE payment_id = target_payment_id;

  SELECT count(*), count(*) FILTER (
    WHERE entity_type = 'payment'
      AND reversal_row.id IS NOT NULL
      AND actor_app_account_id = reversal_row.reversed_by_account_id
      AND reason = reversal_row.reason
      AND context = jsonb_build_object(
        'itemCount', allocation_count,
        'method', payment_row.method,
        'totalAmount', payment_row.amount
      )
  )
  INTO audit_count, matching_audit_count
  FROM public.audit_events
  WHERE action = 'payment.reversed'
    AND entity_id = target_payment_id::text;

  IF reversal_row.id IS NULL THEN
    IF audit_count <> 0 THEN
      RAISE EXCEPTION 'A payment reversal audit cannot exist without a reversal record.'
        USING ERRCODE = '23514', CONSTRAINT = 'payment_reversal_audit_without_record';
    END IF;
    RETURN;
  END IF;

  IF reversal_row.rt_unit_id <> payment_row.rt_unit_id
     OR reversal_row.household_id <> payment_row.household_id
     OR reversal_row.reversed_by_account_type <> 'official'
     OR length(trim(reversal_row.reason)) = 0
     OR allocation_count = 0
     OR audit_count <> 1
     OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'A reversed payment requires one scoped reversal record and exactly one matching audit event.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_reversal_audit_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.active_due_settlements settlement
    WHERE settlement.payment_id = target_payment_id
  ) THEN
    RAISE EXCEPTION 'A reversed payment cannot retain active due settlement ownership.'
      USING ERRCODE = '23514', CONSTRAINT = 'reversed_payment_active_ownership_forbidden';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_due_active_settlement_phase9_v1(target_due_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  due_row public.monthly_dues%ROWTYPE;
  settlement_count bigint;
  valid_settlement_count bigint;
BEGIN
  SELECT * INTO due_row
  FROM public.monthly_dues
  WHERE id = target_due_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.active_due_settlements WHERE monthly_due_id = target_due_id) THEN
      RAISE EXCEPTION 'An active due settlement must reference an existing due.'
        USING ERRCODE = '23514', CONSTRAINT = 'active_due_settlement_due_required';
    END IF;
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE settlement.rt_unit_id = due_row.rt_unit_id
      AND settlement.household_id = due_row.household_id
      AND settlement.amount = due_row.amount
      AND allocation.amount = due_row.amount
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
  )
  INTO settlement_count, valid_settlement_count
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

  IF due_row.status = 'paid' THEN
    IF settlement_count <> 1 OR valid_settlement_count <> 1 THEN
      RAISE EXCEPTION 'A paid due requires exactly one matching active payment settlement.'
        USING ERRCODE = '23514', CONSTRAINT = 'paid_due_requires_one_active_settlement';
    END IF;
  ELSIF settlement_count <> 0 THEN
    RAISE EXCEPTION 'A non-paid due cannot retain active payment settlement ownership.'
      USING ERRCODE = '23514', CONSTRAINT = 'nonpaid_due_has_no_active_settlement';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_payment_request_phase9_v1(target_request_id uuid) RETURNS void
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
  target_ledger_payment_id uuid;
  has_reversal boolean;
  transition_audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO request_row
  FROM public.payment_requests
  WHERE id = target_request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

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
      AND (item.amount <> due.amount OR item.period <> year.year::text || '-' || lpad(due.month::text, 2, '0'))
  ) THEN
    RAISE EXCEPTION 'Payment request item no longer matches its due period and amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_request_item_due_consistent';
  END IF;

  SELECT count(*) INTO claim_count
  FROM public.payment_request_claims
  WHERE request_id = target_request_id;
  SELECT count(*) INTO payment_count
  FROM public.payments
  WHERE payment_request_id = target_request_id;
  SELECT count(*), coalesce(sum(amount), 0)
  INTO allocation_count, allocation_total
  FROM public.payment_allocations
  WHERE payment_request_id = target_request_id;

  IF request_row.status = 'pending' THEN
    IF claim_count <> item_count OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Pending payment request must keep all claims and have no payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_ledger_consistent';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_items item
      JOIN public.monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status <> 'unpaid'
    ) THEN
      RAISE EXCEPTION 'Pending payment request items must remain unpaid.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_due_unpaid';
    END IF;
    SELECT count(*) INTO transition_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 0 THEN
      RAISE EXCEPTION 'A pending request cannot have a terminal transition audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_terminal_audit_forbidden';
    END IF;
    RETURN;
  END IF;

  IF request_row.status = 'verified' THEN
    IF claim_count <> 0 OR payment_count <> 1 OR allocation_count <> item_count THEN
      RAISE EXCEPTION 'Verified request requires one historical payment, complete allocations, and no claims.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_ledger_complete';
    END IF;
    SELECT payment.id, payment.amount, EXISTS (
      SELECT 1 FROM public.payment_reversals reversal WHERE reversal.payment_id = payment.id
    )
    INTO target_ledger_payment_id, payment_total, has_reversal
    FROM public.payments payment
    WHERE payment.payment_request_id = target_request_id;
    IF payment_total <> request_row.total_amount OR allocation_total <> payment_total THEN
      RAISE EXCEPTION 'Payment and allocation totals must match the request snapshot.'
        USING ERRCODE = '23514', CONSTRAINT = 'payment_request_ledger_totals_match';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_items item
      WHERE item.request_id = target_request_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.payment_allocations allocation
          WHERE allocation.payment_id = target_ledger_payment_id
            AND allocation.payment_request_id = target_request_id
            AND allocation.rt_unit_id = item.rt_unit_id
            AND allocation.household_id = item.household_id
            AND allocation.monthly_due_id = item.monthly_due_id
            AND allocation.amount = item.amount
        )
    ) THEN
      RAISE EXCEPTION 'Verified request allocations must preserve every immutable request item.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_allocations_match';
    END IF;
    IF has_reversal THEN
      IF EXISTS (
        SELECT 1 FROM public.active_due_settlements settlement
        WHERE settlement.payment_id = target_ledger_payment_id
      ) THEN
        RAISE EXCEPTION 'A reversed transfer payment cannot own an active settlement.'
          USING ERRCODE = '23514', CONSTRAINT = 'reversed_transfer_active_ownership_forbidden';
      END IF;
    ELSIF EXISTS (
      SELECT 1
      FROM public.payment_allocations allocation
      JOIN public.monthly_dues due
        ON due.id = allocation.monthly_due_id
       AND due.rt_unit_id = allocation.rt_unit_id
       AND due.household_id = allocation.household_id
      LEFT JOIN public.active_due_settlements settlement
        ON settlement.allocation_id = allocation.id
       AND settlement.payment_id = allocation.payment_id
       AND settlement.monthly_due_id = allocation.monthly_due_id
      WHERE allocation.payment_id = target_ledger_payment_id
        AND (due.status <> 'paid' OR settlement.monthly_due_id IS NULL OR settlement.amount <> allocation.amount)
    ) THEN
      RAISE EXCEPTION 'An active transfer payment requires its own complete active settlements on paid dues.'
        USING ERRCODE = '23514', CONSTRAINT = 'active_transfer_payment_settlements_complete';
    END IF;

    SELECT count(*), count(*) FILTER (
      WHERE action = 'payment_request.verified'
        AND actor_app_account_id = request_row.verified_by_account_id
        AND reason IS NULL
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    )
    INTO transition_audit_count, matching_audit_count
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Verified request requires exactly one matching historical verification audit.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_audit_required';
    END IF;
    RETURN;
  END IF;

  IF request_row.status IN ('rejected', 'cancelled') THEN
    IF claim_count <> 0 OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Rejected or cancelled request cannot retain claims or a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'resolved_payment_request_ledger_empty';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payment_request_items item
      JOIN public.monthly_dues due
        ON due.rt_unit_id = item.rt_unit_id
       AND due.household_id = item.household_id
       AND due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id
        AND due.status <> 'unpaid'
        AND NOT (
          due.status = 'paid'
          AND EXISTS (
            SELECT 1
            FROM public.active_due_settlements settlement
            WHERE settlement.rt_unit_id = due.rt_unit_id
              AND settlement.household_id = due.household_id
              AND settlement.monthly_due_id = due.id
              AND settlement.amount = due.amount
          )
        )
    ) THEN
      RAISE EXCEPTION 'Terminal request items must remain unpaid or be owned by a later active settlement.'
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
    FROM public.audit_events
    WHERE action IN ('payment_request.verified', 'payment_request.rejected', 'payment_request.cancelled')
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF transition_audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Resolved request requires exactly one matching historical transition audit.'
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
  allocation_total bigint;
  reversal_count bigint;
  settlement_count bigint;
  audit_count bigint;
  matching_audit_count bigint;
BEGIN
  SELECT * INTO payment_row
  FROM public.payments
  WHERE id = target_payment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE allocation.rt_unit_id = payment_row.rt_unit_id
      AND allocation.household_id = payment_row.household_id
      AND due.id IS NOT NULL
      AND due.amount = allocation.amount
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
    RAISE EXCEPTION 'Payment requires complete immutable same-household allocations matching its source and total.'
      USING ERRCODE = '23514', CONSTRAINT = 'payment_ledger_complete_phase9';
  END IF;

  SELECT count(*) INTO reversal_count
  FROM public.payment_reversals
  WHERE payment_id = target_payment_id;
  SELECT count(*) INTO settlement_count
  FROM public.active_due_settlements
  WHERE payment_id = target_payment_id;

  IF reversal_count = 0 THEN
    IF settlement_count <> allocation_count OR EXISTS (
      SELECT 1
      FROM public.payment_allocations allocation
      JOIN public.monthly_dues due
        ON due.id = allocation.monthly_due_id
       AND due.rt_unit_id = allocation.rt_unit_id
       AND due.household_id = allocation.household_id
      LEFT JOIN public.active_due_settlements settlement
        ON settlement.allocation_id = allocation.id
       AND settlement.payment_id = allocation.payment_id
       AND settlement.rt_unit_id = allocation.rt_unit_id
       AND settlement.household_id = allocation.household_id
       AND settlement.monthly_due_id = allocation.monthly_due_id
      WHERE allocation.payment_id = target_payment_id
        AND (due.status <> 'paid' OR settlement.monthly_due_id IS NULL OR settlement.amount <> allocation.amount)
    ) THEN
      RAISE EXCEPTION 'An active payment must own one matching active settlement for each allocation.'
        USING ERRCODE = '23514', CONSTRAINT = 'active_payment_settlements_complete';
    END IF;
  ELSIF settlement_count <> 0 THEN
    RAISE EXCEPTION 'A reversed payment cannot own an active due settlement.'
      USING ERRCODE = '23514', CONSTRAINT = 'reversed_payment_active_ownership_forbidden';
  END IF;

  IF payment_row.method = 'cash' THEN
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
    FROM public.audit_events
    WHERE action = 'payment.cash_recorded'
      AND entity_type = 'payment'
      AND entity_id = target_payment_id::text;
    IF audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Cash payment requires exactly one matching historical cash audit.'
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_payment_lifecycle_phase9_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_request_id uuid;
  target_payment_id uuid;
  target_due_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'payment_requests' THEN
      target_request_id := OLD.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN
      target_request_id := OLD.request_id;
    ELSIF TG_TABLE_NAME = 'payments' THEN
      target_payment_id := OLD.id;
    ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
      target_payment_id := OLD.payment_id;
      target_request_id := OLD.payment_request_id;
    ELSIF TG_TABLE_NAME = 'payment_reversals' THEN
      target_payment_id := OLD.payment_id;
    ELSIF TG_TABLE_NAME = 'active_due_settlements' THEN
      target_payment_id := OLD.payment_id;
      target_due_id := OLD.monthly_due_id;
    ELSIF TG_TABLE_NAME = 'monthly_dues' THEN
      target_due_id := OLD.id;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'payment_requests' THEN
      target_request_id := NEW.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN
      target_request_id := NEW.request_id;
    ELSIF TG_TABLE_NAME = 'payments' THEN
      target_payment_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
      target_payment_id := NEW.payment_id;
      target_request_id := NEW.payment_request_id;
    ELSIF TG_TABLE_NAME = 'payment_reversals' THEN
      target_payment_id := NEW.payment_id;
    ELSIF TG_TABLE_NAME = 'active_due_settlements' THEN
      target_payment_id := NEW.payment_id;
      target_due_id := NEW.monthly_due_id;
    ELSIF TG_TABLE_NAME = 'monthly_dues' THEN
      target_due_id := NEW.id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'audit_events' AND TG_OP <> 'DELETE' THEN
    IF NEW.action = 'payment.reversed' THEN
      IF NEW.entity_type <> 'payment' OR NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Payment reversal audit requires a payment UUID entity.'
          USING ERRCODE = '23514', CONSTRAINT = 'payment_reversal_audit_entity_valid';
      END IF;
      PERFORM public.assert_payment_reversal_phase9_v1(NEW.entity_id::uuid);
    END IF;
    RETURN NULL;
  END IF;

  IF target_request_id IS NOT NULL THEN
    PERFORM public.assert_payment_request_phase9_v1(target_request_id);
  END IF;
  IF target_payment_id IS NOT NULL THEN
    PERFORM public.assert_payment_ledger_phase9_v1(target_payment_id);
  END IF;
  IF target_due_id IS NOT NULL THEN
    PERFORM public.assert_due_active_settlement_phase9_v1(target_due_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_paid_due_history_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status = 'paid' OR EXISTS (
    SELECT 1
    FROM public.payment_allocations allocation
    WHERE allocation.rt_unit_id = OLD.rt_unit_id
      AND allocation.household_id = OLD.household_id
      AND allocation.monthly_due_id = OLD.id
  )) AND (
    NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id OR
    NEW.household_id IS DISTINCT FROM OLD.household_id OR
    NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id OR
    NEW.month IS DISTINCT FROM OLD.month OR
    NEW.amount IS DISTINCT FROM OLD.amount
  ) THEN
    RAISE EXCEPTION 'A due with payment history cannot have its scope, period, or amount rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_history_immutable';
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'A paid due can only remain paid or return to unpaid through its owning payment reversal.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_status_transition_invalid';
  END IF;

  IF OLD.status = 'paid' AND NEW.status = 'unpaid' AND NOT EXISTS (
    SELECT 1
    FROM public.active_due_settlements settlement
    JOIN public.payment_reversals reversal
      ON reversal.payment_id = settlement.payment_id
     AND reversal.rt_unit_id = settlement.rt_unit_id
     AND reversal.household_id = settlement.household_id
    WHERE settlement.monthly_due_id = OLD.id
      AND settlement.rt_unit_id = OLD.rt_unit_id
      AND settlement.household_id = OLD.household_id
      AND settlement.amount = OLD.amount
  ) THEN
    RAISE EXCEPTION 'A paid due can return to unpaid only while its active owner is being reversed.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_due_unpaid_requires_owning_reversal';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_active_due_settlement_truncate_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Active due settlement ownership cannot be truncated.'
    USING ERRCODE = '55000', CONSTRAINT = 'active_due_settlement_truncate_forbidden';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_requests_ledger_check_v1 ON public.payment_requests;
DROP TRIGGER IF EXISTS payment_request_items_ledger_check_v1 ON public.payment_request_items;
DROP TRIGGER IF EXISTS payment_request_claims_ledger_check_v1 ON public.payment_request_claims;
DROP TRIGGER IF EXISTS payments_ledger_check_v1 ON public.payments;
DROP TRIGGER IF EXISTS payment_allocations_ledger_check_v1 ON public.payment_allocations;
DROP TRIGGER IF EXISTS monthly_dues_paid_allocation_check_v1 ON public.monthly_dues;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_requests_ledger_check_phase9_v1
AFTER INSERT OR UPDATE OR DELETE ON public.payment_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_items_ledger_check_phase9_v1
AFTER INSERT OR UPDATE OR DELETE ON public.payment_request_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_claims_ledger_check_phase9_v1
AFTER INSERT OR DELETE ON public.payment_request_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_ledger_check_phase9_v1
AFTER INSERT ON public.payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_allocations_ledger_check_phase9_v1
AFTER INSERT ON public.payment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_reversals_ledger_check_phase9_v1
AFTER INSERT ON public.payment_reversals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER active_due_settlements_ledger_check_phase9_v1
AFTER INSERT OR DELETE ON public.active_due_settlements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER monthly_dues_active_settlement_check_phase9_v1
AFTER INSERT OR UPDATE OR DELETE ON public.monthly_dues
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_reversal_audit_check_phase9_v1
AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_lifecycle_phase9_v1();
--> statement-breakpoint
CREATE TRIGGER active_due_settlements_reject_truncate_v1
BEFORE TRUNCATE ON public.active_due_settlements
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_active_due_settlement_truncate_v1();
--> statement-breakpoint
DO $$
DECLARE
  target_id uuid;
BEGIN
  FOR target_id IN SELECT id FROM public.payment_requests ORDER BY id LOOP
    PERFORM public.assert_payment_request_phase9_v1(target_id);
  END LOOP;
  FOR target_id IN SELECT id FROM public.payments ORDER BY id LOOP
    PERFORM public.assert_payment_ledger_phase9_v1(target_id);
  END LOOP;
  FOR target_id IN SELECT id FROM public.monthly_dues ORDER BY id LOOP
    PERFORM public.assert_due_active_settlement_phase9_v1(target_id);
  END LOOP;
END;
$$;
