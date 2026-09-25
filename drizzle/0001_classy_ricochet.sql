ALTER TABLE "people" ADD CONSTRAINT "people_rt_household_id_uq" UNIQUE("rt_unit_id","household_id","id");--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_resident_person_household_fk" FOREIGN KEY ("rt_unit_id","household_id","person_id") REFERENCES "public"."people"("rt_unit_id","household_id","id") ON DELETE restrict ON UPDATE no action;
