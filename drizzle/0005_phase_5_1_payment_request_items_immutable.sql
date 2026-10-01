CREATE OR REPLACE FUNCTION public.reject_payment_request_item_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'payment_request_items are immutable request snapshots',
		CONSTRAINT = 'payment_request_items_immutable';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_request_items_immutable_rows
BEFORE UPDATE OR DELETE ON public.payment_request_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_payment_request_item_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER payment_request_items_immutable_truncate
BEFORE TRUNCATE ON public.payment_request_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.reject_payment_request_item_mutation_v1();
