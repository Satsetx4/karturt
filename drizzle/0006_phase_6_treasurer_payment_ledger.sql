CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"monthly_due_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_positive_amount" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" varchar(16) DEFAULT 'transfer' NOT NULL,
	"verified_by_account_id" uuid NOT NULL,
	"verified_by_account_type" "account_type" DEFAULT 'official' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_rt_household_id_uq" UNIQUE("rt_unit_id","household_id","id"),
	CONSTRAINT "payments_id_request_scope_uq" UNIQUE("id","payment_request_id","rt_unit_id","household_id"),
	CONSTRAINT "payments_positive_amount" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_method_transfer_only" CHECK ("payments"."method" = 'transfer'),
	CONSTRAINT "payments_verified_by_official" CHECK ("payments"."verified_by_account_type" = 'official')
);
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "verified_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "verified_by_account_type" "account_type" DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_scope_amount_uq" UNIQUE("request_id","rt_unit_id","household_id","monthly_due_id","amount");--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_scope_fk" FOREIGN KEY ("payment_id","payment_request_id","rt_unit_id","household_id") REFERENCES "public"."payments"("id","payment_request_id","rt_unit_id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_request_item_scope_amount_fk" FOREIGN KEY ("payment_request_id","rt_unit_id","household_id","monthly_due_id","amount") REFERENCES "public"."payment_request_items"("request_id","rt_unit_id","household_id","monthly_due_id","amount") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_due_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","monthly_due_id") REFERENCES "public"."monthly_dues"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_request_scope_fk" FOREIGN KEY ("rt_unit_id","household_id","payment_request_id") REFERENCES "public"."payment_requests"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_scope_fk" FOREIGN KEY ("rt_unit_id","verified_by_account_id","verified_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_due_uq" ON "payment_allocations" USING btree ("payment_id","monthly_due_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_request_due_uq" ON "payment_allocations" USING btree ("payment_request_id","monthly_due_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_due_history_idx" ON "payment_allocations" USING btree ("rt_unit_id","household_id","monthly_due_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_payment_request_uq" ON "payments" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX "payments_household_verified_idx" ON "payments" USING btree ("rt_unit_id","household_id","verified_at");--> statement-breakpoint
CREATE INDEX "payments_treasurer_verified_idx" ON "payments" USING btree ("rt_unit_id","verified_by_account_id","verified_at");--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_verified_by_scope_fk" FOREIGN KEY ("rt_unit_id","verified_by_account_id","verified_by_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_verified_by_official" CHECK ("payment_requests"."verified_by_account_type" = 'official');--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_verification_metadata_consistent" CHECK (("payment_requests"."status" = 'verified' and "payment_requests"."verified_at" is not null and "payment_requests"."verified_by_account_id" is not null) or ("payment_requests"."status" <> 'verified' and "payment_requests"."verified_at" is null and "payment_requests"."verified_by_account_id" is null));
--> statement-breakpoint
CREATE FUNCTION reject_payment_ledger_mutation_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment ledger rows are append-only.'
    USING ERRCODE = '55000', CONSTRAINT = 'payment_ledger_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payments_reject_update_delete_v1
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER payments_reject_truncate_v1
BEFORE TRUNCATE ON payments
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_reject_update_delete_v1
BEFORE UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION reject_payment_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_reject_truncate_v1
BEFORE TRUNCATE ON payment_allocations
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_ledger_mutation_v1();
--> statement-breakpoint
CREATE FUNCTION guard_payment_request_history_v1() RETURNS trigger
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

  IF OLD.status <> 'pending' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.verified_by_account_id IS DISTINCT FROM OLD.verified_by_account_id OR
    NEW.verified_by_account_type IS DISTINCT FROM OLD.verified_by_account_type OR
    NEW.verified_at IS DISTINCT FROM OLD.verified_at
  ) THEN
    RAISE EXCEPTION 'Processed payment request history cannot be rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'payment_request_state_terminal';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_requests_guard_history_v1
BEFORE UPDATE OR DELETE ON payment_requests
FOR EACH ROW EXECUTE FUNCTION guard_payment_request_history_v1();
--> statement-breakpoint
CREATE FUNCTION reject_payment_request_claim_update_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment request claims may only be closed, not rewritten.'
    USING ERRCODE = '55000', CONSTRAINT = 'payment_request_claim_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_request_claims_reject_update_v1
BEFORE UPDATE ON payment_request_claims
FOR EACH ROW EXECUTE FUNCTION reject_payment_request_claim_update_v1();
--> statement-breakpoint
CREATE FUNCTION assert_payment_request_ledger_v1(target_request_id uuid) RETURNS void
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
  audit_count bigint;
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
      SELECT 1
      FROM payment_request_items item
      JOIN monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status <> 'unpaid'
    ) THEN
      RAISE EXCEPTION 'Pending payment request items must remain unpaid.'
        USING ERRCODE = '23514', CONSTRAINT = 'pending_payment_request_due_unpaid';
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
      WHERE actor_app_account_id = request_row.verified_by_account_id
        AND context = jsonb_build_object('itemCount', request_row.item_count, 'totalAmount', request_row.total_amount)
    )
    INTO audit_count, matching_audit_count
    FROM audit_events
    WHERE action = 'payment_request.verified'
      AND entity_type = 'payment_request'
      AND entity_id = target_request_id::text;
    IF audit_count <> 1 OR matching_audit_count <> 1 THEN
      RAISE EXCEPTION 'Verified request requires exactly one matching audit event.'
        USING ERRCODE = '23514', CONSTRAINT = 'verified_payment_request_audit_required';
    END IF;
  ELSE
    IF claim_count <> 0 OR payment_count <> 0 OR allocation_count <> 0 THEN
      RAISE EXCEPTION 'Unverified terminal request cannot retain claims or a payment ledger.'
        USING ERRCODE = '23514', CONSTRAINT = 'unverified_payment_request_ledger_empty';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM payment_request_items item
      JOIN monthly_dues due ON due.id = item.monthly_due_id
      WHERE item.request_id = target_request_id AND due.status <> 'unpaid'
    ) THEN
      RAISE EXCEPTION 'Unverified terminal request items must remain unpaid.'
        USING ERRCODE = '23514', CONSTRAINT = 'unverified_payment_request_due_unpaid';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION validate_payment_request_ledger_change_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_request_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'payment_requests' THEN target_request_id := OLD.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN target_request_id := OLD.request_id;
    ELSE target_request_id := OLD.payment_request_id; END IF;
  ELSE
    IF TG_TABLE_NAME = 'payment_requests' THEN target_request_id := NEW.id;
    ELSIF TG_TABLE_NAME IN ('payment_request_items', 'payment_request_claims') THEN target_request_id := NEW.request_id;
    ELSE target_request_id := NEW.payment_request_id; END IF;
  END IF;
  PERFORM assert_payment_request_ledger_v1(target_request_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_requests_ledger_check_v1
AFTER INSERT OR UPDATE OR DELETE ON payment_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payment_request_ledger_change_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_items_ledger_check_v1
AFTER INSERT ON payment_request_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payment_request_ledger_change_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_request_claims_ledger_check_v1
AFTER INSERT OR DELETE ON payment_request_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payment_request_ledger_change_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_ledger_check_v1
AFTER INSERT OR UPDATE OR DELETE ON payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payment_request_ledger_change_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_allocations_ledger_check_v1
AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_payment_request_ledger_change_v1();
--> statement-breakpoint
CREATE FUNCTION guard_paid_due_history_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id OR
    NEW.household_id IS DISTINCT FROM OLD.household_id OR
    NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id OR
    NEW.month IS DISTINCT FROM OLD.month OR
    NEW.amount IS DISTINCT FROM OLD.amount
  ) THEN
    RAISE EXCEPTION 'Paid monthly due history cannot be rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_history_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monthly_dues_guard_paid_history_v1
BEFORE UPDATE ON monthly_dues
FOR EACH ROW EXECUTE FUNCTION guard_paid_due_history_v1();
--> statement-breakpoint
CREATE FUNCTION assert_paid_due_allocation_v1() RETURNS trigger
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
     AND payment.payment_request_id = allocation.payment_request_id
     AND payment.rt_unit_id = allocation.rt_unit_id
     AND payment.household_id = allocation.household_id
    JOIN payment_requests request
      ON request.id = allocation.payment_request_id
     AND request.rt_unit_id = allocation.rt_unit_id
     AND request.household_id = allocation.household_id
    WHERE allocation.rt_unit_id = NEW.rt_unit_id
      AND allocation.household_id = NEW.household_id
      AND allocation.monthly_due_id = NEW.id
      AND allocation.amount = NEW.amount
      AND request.status = 'verified'
  ) THEN
    RAISE EXCEPTION 'A monthly due can be paid only with a valid payment allocation.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_monthly_due_requires_allocation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER monthly_dues_paid_allocation_check_v1
AFTER INSERT OR UPDATE OF status ON monthly_dues
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_paid_due_allocation_v1();
