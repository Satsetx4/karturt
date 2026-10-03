DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.households first_period
    JOIN public.households second_period
      ON second_period.rt_unit_id = first_period.rt_unit_id
     AND second_period.house_id = first_period.house_id
     AND second_period.id > first_period.id
     AND first_period.starts_on <= coalesce(second_period.ends_on, 'infinity'::date)
     AND (first_period.ends_on IS NULL OR first_period.ends_on >= second_period.starts_on)
  ) THEN
    RAISE EXCEPTION 'Phase 12 migration refused: household periods already overlap for a physical house.'
      USING ERRCODE = '23514', CONSTRAINT = 'phase12_household_period_overlap_preflight';
  END IF;
END;
$$;
--> statement-breakpoint
DROP INDEX public.app_accounts_login_identifier_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX app_accounts_resident_login_uq
  ON public.app_accounts USING btree (rt_unit_id, account_type, lower(login_identifier))
  WHERE account_type = 'resident' AND status <> 'disabled';
--> statement-breakpoint
CREATE UNIQUE INDEX app_accounts_official_login_uq
  ON public.app_accounts USING btree (rt_unit_id, account_type, lower(login_identifier))
  WHERE account_type = 'official';
--> statement-breakpoint
CREATE INDEX households_rt_house_period_idx
  ON public.households USING btree (rt_unit_id, house_id, starts_on, ends_on);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_phase12_household_period_v1() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Household history cannot be deleted.'
      USING ERRCODE = '55000', CONSTRAINT = 'household_delete_forbidden';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.rt_unit_id IS DISTINCT FROM OLD.rt_unit_id
    OR NEW.house_id IS DISTINCT FROM OLD.house_id
    OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Household identity and start fields are immutable.'
      USING ERRCODE = '55000', CONSTRAINT = 'household_identity_start_immutable';
  END IF;

  PERFORM 1
  FROM public.houses house
  WHERE house.rt_unit_id = NEW.rt_unit_id
    AND house.id = NEW.house_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Household parent house does not exist in the same RT.'
      USING ERRCODE = '23503', CONSTRAINT = 'households_rt_house_fk';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.households other_period
    WHERE other_period.rt_unit_id = NEW.rt_unit_id
      AND other_period.house_id = NEW.house_id
      AND other_period.id IS DISTINCT FROM NEW.id
      AND other_period.starts_on <= coalesce(NEW.ends_on, 'infinity'::date)
      AND (other_period.ends_on IS NULL OR other_period.ends_on >= NEW.starts_on)
  ) THEN
    RAISE EXCEPTION 'Household period overlaps another household at this house.'
      USING ERRCODE = '23514', CONSTRAINT = 'households_period_overlap';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER households_guard_phase12_period_v1
BEFORE INSERT OR UPDATE OR DELETE ON public.households
FOR EACH ROW EXECUTE FUNCTION public.guard_phase12_household_period_v1();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.phase12_can_reconcile_future_due_v1(
  previous_due public.monthly_dues,
  next_due public.monthly_dues
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  household_state text;
  household_end date;
  due_period integer;
  end_period integer;
BEGIN
  IF previous_due.id IS DISTINCT FROM next_due.id
     OR previous_due.rt_unit_id IS DISTINCT FROM next_due.rt_unit_id
     OR previous_due.household_id IS DISTINCT FROM next_due.household_id
     OR previous_due.billing_year_id IS DISTINCT FROM next_due.billing_year_id
     OR previous_due.month IS DISTINCT FROM next_due.month
     OR previous_due.due_date IS DISTINCT FROM next_due.due_date
     OR previous_due.created_at IS DISTINCT FROM next_due.created_at
     OR previous_due.status <> 'unpaid'
     OR next_due.status <> 'not_due'
     OR next_due.amount <> 0
     OR next_due.fee_rate_id IS NOT NULL
     OR next_due.waived_reason IS NOT NULL THEN
    RETURN false;
  END IF;

  SELECT household.status::text,
         household.ends_on,
         billing_year.year * 100 + next_due.month,
         extract(year FROM household.ends_on)::integer * 100 + extract(month FROM household.ends_on)::integer
  INTO household_state, household_end, due_period, end_period
  FROM public.households household
  JOIN public.billing_years billing_year
    ON billing_year.rt_unit_id = household.rt_unit_id
   AND billing_year.id = next_due.billing_year_id
  WHERE household.rt_unit_id = next_due.rt_unit_id
    AND household.id = next_due.household_id;

  IF NOT FOUND
     OR household_state <> 'inactive'
     OR household_end IS NULL
     OR due_period <= end_period
     OR next_due.due_date <= (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_allocations allocation
    WHERE allocation.rt_unit_id = next_due.rt_unit_id
      AND allocation.household_id = next_due.household_id
      AND allocation.monthly_due_id = next_due.id
  ) OR EXISTS (
    SELECT 1 FROM public.payment_request_items item
    WHERE item.rt_unit_id = next_due.rt_unit_id
      AND item.household_id = next_due.household_id
      AND item.monthly_due_id = next_due.id
  ) OR EXISTS (
    SELECT 1 FROM public.payment_request_claims claim
    WHERE claim.monthly_due_id = next_due.id
  ) OR EXISTS (
    SELECT 1 FROM public.waiver_items item
    WHERE item.rt_unit_id = next_due.rt_unit_id
      AND item.household_id = next_due.household_id
      AND item.monthly_due_id = next_due.id
  ) OR EXISTS (
    SELECT 1 FROM public.due_adjustments adjustment
    WHERE adjustment.rt_unit_id = next_due.rt_unit_id
      AND adjustment.household_id = next_due.household_id
      AND adjustment.monthly_due_id = next_due.id
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
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
  ) AND NOT public.phase12_can_reconcile_future_due_v1(OLD, NEW) THEN
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
    IF NOT public.phase12_can_reconcile_future_due_v1(OLD, NEW) THEN
      RAISE EXCEPTION 'A due with financial history cannot have its obligation snapshot rewritten.'
        USING ERRCODE = '55000', CONSTRAINT = 'paid_monthly_due_history_immutable';
    END IF;
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
