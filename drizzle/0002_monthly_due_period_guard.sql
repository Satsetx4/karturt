ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_due_month_matches_month" CHECK (extract(month from "monthly_dues"."due_date") = "monthly_dues"."month");
--> statement-breakpoint
CREATE FUNCTION public.enforce_monthly_due_billing_period() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_year smallint;
BEGIN
  SELECT year INTO expected_year
  FROM public.billing_years
  WHERE id = NEW.billing_year_id AND rt_unit_id = NEW.rt_unit_id;

  IF expected_year IS NOT NULL AND extract(year FROM NEW.due_date)::integer <> expected_year THEN
    RAISE EXCEPTION 'monthly due date year must match its billing year'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER monthly_dues_billing_period_check
BEFORE INSERT OR UPDATE OF rt_unit_id, billing_year_id, due_date
ON public.monthly_dues
FOR EACH ROW
EXECUTE FUNCTION public.enforce_monthly_due_billing_period();
