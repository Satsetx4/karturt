ALTER TABLE public.fee_rates
  ADD COLUMN household_id uuid,
  ADD COLUMN sheet2_import_batch_id uuid;
--> statement-breakpoint
CREATE TABLE public.sheet2_import_batches (
  id uuid PRIMARY KEY,
  rt_unit_id uuid NOT NULL,
  billing_year_id uuid NOT NULL,
  created_by_account_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE RESTRICT,
  imported_system_admin_account_id uuid NOT NULL REFERENCES public.app_accounts(id) ON DELETE RESTRICT,
  source_sheet varchar(16) NOT NULL DEFAULT 'Sheet2',
  as_of_date date NOT NULL,
  household_count smallint NOT NULL,
  resident_account_count smallint NOT NULL,
  official_account_count smallint NOT NULL,
  system_admin_account_count smallint NOT NULL,
  monthly_due_count integer NOT NULL,
  opening_balance_count integer NOT NULL,
  tariff_class_counts jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sheet2_import_batches_rt_year_fk
    FOREIGN KEY (rt_unit_id, billing_year_id)
    REFERENCES public.billing_years (rt_unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT sheet2_import_batches_rt_id_uq UNIQUE (rt_unit_id, id),
  CONSTRAINT sheet2_import_batches_source_sheet CHECK (source_sheet = 'Sheet2'),
  CONSTRAINT sheet2_import_batches_as_of_date CHECK (as_of_date = DATE '2026-10-27'),
  CONSTRAINT sheet2_import_batches_counts CHECK (
    household_count = 73 AND resident_account_count = 73 AND
    official_account_count = 2 AND system_admin_account_count = 1 AND
    monthly_due_count = 876 AND opening_balance_count = 626 AND
    tariff_class_counts = '[57, 16]'::jsonb
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX sheet2_import_batches_rt_year_uq
  ON public.sheet2_import_batches (rt_unit_id, billing_year_id);
--> statement-breakpoint
ALTER TABLE public.fee_rates
  ADD CONSTRAINT fee_rates_rt_household_fk
    FOREIGN KEY (rt_unit_id, household_id)
    REFERENCES public.households (rt_unit_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fee_rates_sheet2_import_batch_fk
    FOREIGN KEY (sheet2_import_batch_id)
    REFERENCES public.sheet2_import_batches (id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE public.fee_rates
  ADD CONSTRAINT fee_rates_sheet2_import_scope CHECK (
    (household_id IS NULL AND sheet2_import_batch_id IS NULL) OR
    (household_id IS NOT NULL AND sheet2_import_batch_id IS NOT NULL AND
      created_by_account_id IS NULL AND created_by_account_type IS NULL AND
      idempotency_key IS NULL AND request_fingerprint IS NULL AND effective_month = 1)
  );
--> statement-breakpoint
DROP INDEX public.fee_rates_year_month_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX fee_rates_year_month_uq
  ON public.fee_rates (billing_year_id, effective_month)
  WHERE household_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX fee_rates_household_year_month_uq
  ON public.fee_rates (billing_year_id, household_id, effective_month)
  WHERE household_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.sheet2_opening_balance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rt_unit_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  household_id uuid NOT NULL,
  monthly_due_id uuid NOT NULL,
  amount integer NOT NULL,
  source_range_start_month smallint NOT NULL,
  source_range_end_month smallint NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sheet2_opening_balance_batch_scope_fk
    FOREIGN KEY (rt_unit_id, import_batch_id)
    REFERENCES public.sheet2_import_batches (rt_unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT sheet2_opening_balance_due_scope_fk
    FOREIGN KEY (rt_unit_id, household_id, monthly_due_id)
    REFERENCES public.monthly_dues (rt_unit_id, household_id, id) ON DELETE RESTRICT,
  CONSTRAINT sheet2_opening_balance_amount_positive CHECK (amount > 0),
  CONSTRAINT sheet2_opening_balance_source_range_valid CHECK (
    source_range_start_month BETWEEN 1 AND 12 AND
    source_range_end_month BETWEEN source_range_start_month AND 12
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX sheet2_opening_balance_due_uq
  ON public.sheet2_opening_balance_items (monthly_due_id);
--> statement-breakpoint
CREATE INDEX sheet2_opening_balance_batch_idx
  ON public.sheet2_opening_balance_items (rt_unit_id, import_batch_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_fee_rate_phase11_insert_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  year_row public.billing_years%ROWTYPE;
  batch_row public.sheet2_import_batches%ROWTYPE;
  local_year integer;
  local_month integer;
  chairman_count bigint;
BEGIN
  IF NEW.sheet2_import_batch_id IS NOT NULL THEN
    SELECT * INTO batch_row
    FROM public.sheet2_import_batches batch
    WHERE batch.id = NEW.sheet2_import_batch_id
      AND batch.rt_unit_id = NEW.rt_unit_id
      AND batch.billing_year_id = NEW.billing_year_id
      AND batch.source_sheet = 'Sheet2';
    IF NOT FOUND OR NEW.household_id IS NULL OR NEW.effective_month <> 1 OR
       NEW.created_by_account_id IS NOT NULL OR NEW.created_by_account_type IS NOT NULL OR
       NEW.idempotency_key IS NOT NULL OR NEW.request_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'Sheet2 tariff rows require a matching household-scoped import batch.'
        USING ERRCODE = '23514', CONSTRAINT = 'fee_rate_sheet2_import_scope';
    END IF;
    RETURN NEW;
  END IF;

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
CREATE OR REPLACE FUNCTION public.validate_monthly_due_fee_rate_scope_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rate_household_id uuid;
BEGIN
  IF NEW.fee_rate_id IS NULL THEN RETURN NEW; END IF;
  SELECT rate.household_id INTO rate_household_id
  FROM public.fee_rates rate
  WHERE rate.billing_year_id = NEW.billing_year_id
    AND rate.id = NEW.fee_rate_id;
  IF NOT FOUND OR (rate_household_id IS NOT NULL AND rate_household_id <> NEW.household_id) THEN
    RAISE EXCEPTION 'A monthly due may use only a global or same-household tariff.'
      USING ERRCODE = '23514', CONSTRAINT = 'monthly_due_fee_rate_household_scope';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monthly_dues_fee_rate_scope_v1
BEFORE INSERT OR UPDATE OF billing_year_id, household_id, fee_rate_id ON public.monthly_dues
FOR EACH ROW EXECUTE FUNCTION public.validate_monthly_due_fee_rate_scope_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.due_active_received_phase11_v1(target_due_id uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT sum(allocation.amount)
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
  ), 0) + coalesce((
    SELECT sum(opening.amount)
    FROM public.sheet2_opening_balance_items opening
    WHERE opening.monthly_due_id = target_due_id
  ), 0)
$$;
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
  opening_balance_total numeric;
BEGIN
  SELECT * INTO due_row FROM public.monthly_dues WHERE id = target_due_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.active_due_settlements WHERE monthly_due_id = target_due_id)
       OR EXISTS (SELECT 1 FROM public.due_adjustments WHERE monthly_due_id = target_due_id)
       OR EXISTS (SELECT 1 FROM public.sheet2_opening_balance_items WHERE monthly_due_id = target_due_id) THEN
      RAISE EXCEPTION 'An active financial ledger entry must reference an existing due.'
        USING ERRCODE = '23514', CONSTRAINT = 'financial_ledger_due_required';
    END IF;
    RETURN;
  END IF;

  effective_target := public.due_effective_target_phase11_v1(target_due_id);
  active_received := public.due_active_received_phase11_v1(target_due_id);
  SELECT coalesce(sum(opening.amount), 0)
  INTO opening_balance_total
  FROM public.sheet2_opening_balance_items opening
  WHERE opening.monthly_due_id = target_due_id;

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

  IF settlement_count <> valid_settlement_count OR settlement_total + opening_balance_total <> active_received THEN
    RAISE EXCEPTION 'Active payment ownership and imported opening balances must reconcile to the due.'
      USING ERRCODE = '23514', CONSTRAINT = 'active_due_ownership_matches_allocations';
  END IF;
  IF due_row.status IN ('waived', 'not_due') THEN
    IF settlement_count <> 0 OR active_received <> 0
       OR (due_row.status = 'not_due' AND EXISTS (
         SELECT 1 FROM public.due_adjustments WHERE monthly_due_id = target_due_id
       )) THEN
      RAISE EXCEPTION 'WAIVED and NOT_DUE dues cannot have settlements or imported opening balances.'
        USING ERRCODE = '23514', CONSTRAINT = 'terminal_due_financial_ledger_empty';
    END IF;
    RETURN;
  END IF;

  IF effective_target <= 0 OR active_received > effective_target THEN
    RAISE EXCEPTION 'A due cannot have a nonpositive effective target or an over-allocation.'
      USING ERRCODE = '23514', CONSTRAINT = 'due_effective_balance_valid';
  END IF;
  IF due_row.status = 'paid' AND active_received <> effective_target THEN
    RAISE EXCEPTION 'A PAID due requires payment allocations and imported opening balances to equal its effective target.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_due_effective_balance_zero';
  END IF;
  IF due_row.status = 'unpaid' AND active_received >= effective_target THEN
    RAISE EXCEPTION 'An UNPAID due must have a positive outstanding balance.'
      USING ERRCODE = '23514', CONSTRAINT = 'unpaid_due_effective_balance_positive';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_sheet2_opening_balance_due_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.assert_due_active_settlement_phase9_v1(NEW.monthly_due_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sheet2_opening_balance_due_check_v1
AFTER INSERT ON public.sheet2_opening_balance_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_sheet2_opening_balance_due_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_paid_due_history_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status = 'paid' OR EXISTS (
    SELECT 1 FROM public.payment_allocations allocation
    WHERE allocation.rt_unit_id = OLD.rt_unit_id
      AND allocation.household_id = OLD.household_id
      AND allocation.monthly_due_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM public.sheet2_opening_balance_items opening
    WHERE opening.rt_unit_id = OLD.rt_unit_id
      AND opening.household_id = OLD.household_id
      AND opening.monthly_due_id = OLD.id
  )) AND (
    NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id OR
    NEW.household_id IS DISTINCT FROM OLD.household_id OR
    NEW.billing_year_id IS DISTINCT FROM OLD.billing_year_id OR
    NEW.month IS DISTINCT FROM OLD.month OR
    NEW.amount IS DISTINCT FROM OLD.amount
  ) THEN
    RAISE EXCEPTION 'A due with payment or imported opening-balance history cannot have its scope, period, or amount rewritten.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_history_immutable';
  END IF;

  IF OLD.status = 'paid' AND NEW.status NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'A paid due can only remain paid or return to unpaid through a positive balance change or its owning payment reversal.'
      USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_status_transition_invalid';
  END IF;

  IF OLD.status = 'paid' AND NEW.status = 'unpaid'
     AND public.due_active_received_phase11_v1(OLD.id) >= public.due_effective_target_phase11_v1(OLD.id) THEN
    RAISE EXCEPTION 'A paid due can return to unpaid only after its payment is reversed or a positive adjustment exposes an outstanding balance.'
      USING ERRCODE = '23514', CONSTRAINT = 'paid_due_unpaid_requires_owning_reversal';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_sheet2_import_history_mutation_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sheet2 import and opening-balance history is append-only.'
    USING ERRCODE = '55000', CONSTRAINT = 'sheet2_import_history_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sheet2_import_batches_reject_update_delete
BEFORE UPDATE OR DELETE ON public.sheet2_import_batches
FOR EACH ROW EXECUTE FUNCTION public.reject_sheet2_import_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER sheet2_import_batches_reject_truncate
BEFORE TRUNCATE ON public.sheet2_import_batches
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_sheet2_import_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER sheet2_opening_balance_reject_update_delete
BEFORE UPDATE OR DELETE ON public.sheet2_opening_balance_items
FOR EACH ROW EXECUTE FUNCTION public.reject_sheet2_import_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER sheet2_opening_balance_reject_truncate
BEFORE TRUNCATE ON public.sheet2_opening_balance_items
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_sheet2_import_history_mutation_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_sheet2_opening_balance_insert_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audit_events audit
    WHERE audit.action = 'billing.sheet2_opening_balance_imported'
      AND audit.entity_type = 'sheet2_import_batch'
      AND audit.entity_id = NEW.import_batch_id::text
  ) THEN
    RAISE EXCEPTION 'A completed Sheet2 import batch cannot receive additional opening-balance rows.'
      USING ERRCODE = '55000', CONSTRAINT = 'sheet2_import_batch_closed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sheet2_opening_balance_batch_open_v1
BEFORE INSERT ON public.sheet2_opening_balance_items
FOR EACH ROW EXECUTE FUNCTION public.guard_sheet2_opening_balance_insert_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_sheet2_import_batch_v1(target_batch_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  batch_row public.sheet2_import_batches%ROWTYPE;
  billing_year integer;
  audit_count bigint;
  matching_audit_count bigint;
  opening_count bigint;
  due_count bigint;
  paid_count bigint;
  past_unpaid_count bigint;
  future_unpaid_count bigint;
  household_count bigint;
  house_count bigint;
  person_count bigint;
  resident_account_count bigint;
  official_account_count bigint;
  official_assignment_count bigint;
  system_admin_count bigint;
  tariff_count bigint;
  tariff_class_counts integer[];
  payment_count bigint;
  chairman_count bigint;
  treasurer_count bigint;
BEGIN
  SELECT * INTO batch_row
  FROM public.sheet2_import_batches batch
  WHERE batch.id = target_batch_id;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_events audit
      WHERE audit.action = 'billing.sheet2_opening_balance_imported'
        AND audit.entity_type = 'sheet2_import_batch'
        AND audit.entity_id = target_batch_id::text
    ) OR EXISTS (
      SELECT 1 FROM public.sheet2_opening_balance_items opening
      WHERE opening.import_batch_id = target_batch_id
    ) THEN
      RAISE EXCEPTION 'A Sheet2 audit or opening balance cannot exist without its import batch.'
        USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_batch_required';
    END IF;
    RETURN;
  END IF;

  SELECT year.year INTO billing_year
  FROM public.billing_years year
  WHERE year.id = batch_row.billing_year_id
    AND year.rt_unit_id = batch_row.rt_unit_id;
  IF billing_year IS DISTINCT FROM 2026 THEN
    RAISE EXCEPTION 'Sheet2 imports are restricted to the validated 2026 billing year.'
      USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_year_valid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_accounts actor
    JOIN public."user" auth ON auth.id = actor.auth_user_id
    JOIN public."twoFactor" factor ON factor."userId" = auth.id
    WHERE actor.id = batch_row.created_by_account_id
      AND actor.account_type = 'system_admin'
      AND actor.status = 'active'
      AND actor.rt_unit_id IS NULL
      AND auth."twoFactorEnabled" = true
      AND factor.verified = true
  ) THEN
    RAISE EXCEPTION 'A Sheet2 import requires an active System Admin with verified MFA.'
      USING ERRCODE = '42501', CONSTRAINT = 'sheet2_import_actor_mfa_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_accounts imported_admin
    WHERE imported_admin.id = batch_row.imported_system_admin_account_id
      AND imported_admin.account_type = 'system_admin'
      AND imported_admin.status = 'active'
      AND imported_admin.rt_unit_id IS NULL
  ) THEN
    RAISE EXCEPTION 'The imported System Admin account has an invalid role scope.'
      USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_admin_scope_valid';
  END IF;

  SELECT count(*) INTO opening_count
  FROM public.sheet2_opening_balance_items opening
  WHERE opening.rt_unit_id = batch_row.rt_unit_id
    AND opening.import_batch_id = batch_row.id;
  SELECT count(*) INTO due_count
  FROM public.monthly_dues due
  WHERE due.rt_unit_id = batch_row.rt_unit_id
    AND due.billing_year_id = batch_row.billing_year_id
    AND due.household_id IN (
      SELECT rate.household_id FROM public.fee_rates rate
      WHERE rate.sheet2_import_batch_id = batch_row.id
    );
  SELECT count(*) INTO paid_count
  FROM public.monthly_dues due
  WHERE due.rt_unit_id = batch_row.rt_unit_id
    AND due.billing_year_id = batch_row.billing_year_id
    AND due.household_id IN (
      SELECT rate.household_id FROM public.fee_rates rate
      WHERE rate.sheet2_import_batch_id = batch_row.id
    )
    AND due.status = 'paid';
  SELECT count(*) INTO past_unpaid_count
  FROM public.monthly_dues due
  WHERE due.rt_unit_id = batch_row.rt_unit_id
    AND due.billing_year_id = batch_row.billing_year_id
    AND due.household_id IN (
      SELECT rate.household_id FROM public.fee_rates rate
      WHERE rate.sheet2_import_batch_id = batch_row.id
    )
    AND due.status = 'unpaid'
    AND due.due_date <= batch_row.as_of_date;
  SELECT count(*) INTO future_unpaid_count
  FROM public.monthly_dues due
  WHERE due.rt_unit_id = batch_row.rt_unit_id
    AND due.billing_year_id = batch_row.billing_year_id
    AND due.household_id IN (
      SELECT rate.household_id FROM public.fee_rates rate
      WHERE rate.sheet2_import_batch_id = batch_row.id
    )
    AND due.status = 'unpaid'
    AND due.due_date > batch_row.as_of_date;
  SELECT count(DISTINCT rate.household_id) INTO household_count
  FROM public.fee_rates rate
  WHERE rate.rt_unit_id = batch_row.rt_unit_id
    AND rate.billing_year_id = batch_row.billing_year_id
    AND rate.sheet2_import_batch_id = batch_row.id
    AND rate.household_id IS NOT NULL;
  SELECT count(DISTINCT house.id) INTO house_count
  FROM public.fee_rates rate
  JOIN public.households household
    ON household.rt_unit_id = rate.rt_unit_id
   AND household.id = rate.household_id
   AND household.status = 'active'
  JOIN public.houses house
    ON house.rt_unit_id = household.rt_unit_id
   AND house.id = household.house_id
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(*) INTO person_count
  FROM public.fee_rates rate
  JOIN public.people person
    ON person.rt_unit_id = rate.rt_unit_id
   AND person.household_id = rate.household_id
   AND person.is_active = true
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(*) INTO resident_account_count
  FROM public.fee_rates rate
  JOIN public.app_accounts account
    ON account.rt_unit_id = rate.rt_unit_id
   AND account.household_id = rate.household_id
   AND account.account_type = 'resident'
   AND account.status = 'active'
  JOIN public.people person
    ON person.rt_unit_id = account.rt_unit_id
   AND person.household_id = account.household_id
   AND person.id = account.person_id
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(DISTINCT account.id) INTO official_account_count
  FROM public.fee_rates rate
  JOIN public.people person
    ON person.rt_unit_id = rate.rt_unit_id
   AND person.household_id = rate.household_id
  JOIN public.app_accounts account
    ON account.rt_unit_id = person.rt_unit_id
   AND account.person_id = person.id
   AND account.account_type = 'official'
   AND account.status = 'active'
  JOIN public.official_assignments assignment
    ON assignment.rt_unit_id = account.rt_unit_id
   AND assignment.app_account_id = account.id
   AND assignment.app_account_type = 'official'
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(DISTINCT assignment.id) FILTER (WHERE assignment.role = 'rt_chairman'),
         count(DISTINCT assignment.id) FILTER (WHERE assignment.role = 'treasurer')
  INTO chairman_count, treasurer_count
  FROM public.fee_rates rate
  JOIN public.people person
    ON person.rt_unit_id = rate.rt_unit_id
   AND person.household_id = rate.household_id
  JOIN public.app_accounts account
    ON account.rt_unit_id = person.rt_unit_id
   AND account.person_id = person.id
   AND account.account_type = 'official'
   AND account.status = 'active'
  JOIN public.official_assignments assignment
    ON assignment.rt_unit_id = account.rt_unit_id
   AND assignment.app_account_id = account.id
   AND assignment.app_account_type = 'official'
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(DISTINCT assignment.id) INTO official_assignment_count
  FROM public.fee_rates rate
  JOIN public.people person
    ON person.rt_unit_id = rate.rt_unit_id
   AND person.household_id = rate.household_id
  JOIN public.app_accounts account
    ON account.rt_unit_id = person.rt_unit_id
   AND account.person_id = person.id
   AND account.account_type = 'official'
   AND account.status = 'active'
  JOIN public.official_assignments assignment
    ON assignment.rt_unit_id = account.rt_unit_id
   AND assignment.app_account_id = account.id
   AND assignment.app_account_type = 'official'
  WHERE rate.sheet2_import_batch_id = batch_row.id;
  SELECT count(*) INTO system_admin_count
  FROM public.app_accounts account
  WHERE account.id = batch_row.imported_system_admin_account_id
    AND account.account_type = 'system_admin';
  SELECT count(*) INTO tariff_count
  FROM public.fee_rates rate
  WHERE rate.rt_unit_id = batch_row.rt_unit_id
    AND rate.billing_year_id = batch_row.billing_year_id
    AND rate.sheet2_import_batch_id = batch_row.id
    AND rate.household_id IS NOT NULL;
  SELECT array_agg(class_count::integer ORDER BY class_count DESC)
  INTO tariff_class_counts
  FROM (
    SELECT count(*) AS class_count
    FROM public.fee_rates rate
    WHERE rate.rt_unit_id = batch_row.rt_unit_id
      AND rate.billing_year_id = batch_row.billing_year_id
      AND rate.sheet2_import_batch_id = batch_row.id
      AND rate.household_id IS NOT NULL
    GROUP BY rate.monthly_amount
  ) classes;
  SELECT count(*) INTO payment_count
  FROM public.payments payment
  WHERE payment.rt_unit_id = batch_row.rt_unit_id
  AND payment.household_id IN (
    SELECT rate.household_id FROM public.fee_rates rate
    WHERE rate.sheet2_import_batch_id = batch_row.id
  );

  IF opening_count <> 626 OR due_count <> 876 OR paid_count <> 626 OR
     past_unpaid_count <> 138 OR future_unpaid_count <> 112 OR
     household_count <> 73 OR house_count <> 73 OR person_count <> 73 OR
     resident_account_count <> 73 OR official_account_count <> 2 OR
     official_assignment_count <> 2 OR system_admin_count <> 1 OR
     chairman_count <> 1 OR treasurer_count <> 1 OR
     tariff_count <> 73 OR tariff_class_counts IS DISTINCT FROM ARRAY[57, 16]::integer[] OR
     payment_count <> 0 THEN
    RAISE EXCEPTION 'Sheet2 import totals do not match the validated aggregate contract.'
      USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_aggregate_contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sheet2_opening_balance_items opening
    JOIN public.monthly_dues due
      ON due.id = opening.monthly_due_id
     AND due.rt_unit_id = opening.rt_unit_id
     AND due.household_id = opening.household_id
    JOIN public.billing_years year
      ON year.id = due.billing_year_id
     AND year.rt_unit_id = due.rt_unit_id
    WHERE opening.import_batch_id = batch_row.id
      AND (opening.amount <> due.amount OR due.status <> 'paid' OR year.year <> 2026
        OR due.month < opening.source_range_start_month
        OR due.month > opening.source_range_end_month)
  ) OR EXISTS (
    SELECT 1
    FROM public.sheet2_opening_balance_items opening
    JOIN public.monthly_dues due
      ON due.id = opening.monthly_due_id
     AND due.rt_unit_id = opening.rt_unit_id
     AND due.household_id = opening.household_id
    WHERE opening.import_batch_id = batch_row.id
    GROUP BY opening.household_id, opening.source_range_start_month, opening.source_range_end_month
    HAVING count(*) <> max(opening.source_range_end_month - opening.source_range_start_month + 1)
       OR min(due.month) <> min(opening.source_range_start_month)
       OR max(due.month) <> max(opening.source_range_end_month)
  ) THEN
    RAISE EXCEPTION 'Sheet2 opening balances do not match the source range or due snapshots.'
      USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_opening_balance_scope';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE audit.actor_app_account_id = batch_row.created_by_account_id
      AND audit.reason IS NULL
      AND audit.context = jsonb_build_object(
        'asOfDate', batch_row.as_of_date::text,
        'householdCount', 73,
        'monthlyDueCount', 876,
        'officialAccountCount', 2,
        'openingBalanceCount', 626,
        'residentAccountCount', 73,
        'sourceSheet', 'Sheet2',
        'systemAdminAccountCount', 1,
        'tariffGroupOneCount', 57,
        'tariffGroupTwoCount', 16,
        'year', 2026
      )
  ) INTO audit_count, matching_audit_count
  FROM public.audit_events audit
  WHERE audit.action = 'billing.sheet2_opening_balance_imported'
    AND audit.entity_type = 'sheet2_import_batch'
    AND audit.entity_id = batch_row.id::text;
  IF audit_count <> 1 OR matching_audit_count <> 1 THEN
    RAISE EXCEPTION 'A Sheet2 import requires exactly one matching aggregate audit event.'
      USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_audit_required';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_sheet2_import_batch_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_batch_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'sheet2_import_batches' THEN
    target_batch_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'sheet2_opening_balance_items' THEN
    target_batch_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.import_batch_id ELSE NEW.import_batch_id END;
  ELSIF TG_TABLE_NAME = 'audit_events' AND TG_OP <> 'DELETE' AND
        NEW.action = 'billing.sheet2_opening_balance_imported' THEN
    IF NEW.entity_type <> 'sheet2_import_batch' OR NEW.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Sheet2 import audit requires a batch UUID entity.'
        USING ERRCODE = '23514', CONSTRAINT = 'sheet2_import_audit_entity_valid';
    END IF;
    target_batch_id := NEW.entity_id::uuid;
  END IF;
  IF target_batch_id IS NOT NULL THEN
    PERFORM public.assert_sheet2_import_batch_v1(target_batch_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sheet2_import_batch_audit_check_v1
AFTER INSERT OR UPDATE OR DELETE ON public.sheet2_import_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_sheet2_import_batch_v1();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sheet2_import_audit_event_check_v1
AFTER INSERT ON public.audit_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_sheet2_import_batch_v1();
