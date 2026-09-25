CREATE TYPE "public"."account_status" AS ENUM('active', 'locked', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('resident', 'official', 'system_admin');--> statement-breakpoint
CREATE TYPE "public"."billing_year_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."household_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."monthly_due_status" AS ENUM('unpaid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."monthly_due_waiver_reason" AS ENUM('not_yet_resident');--> statement-breakpoint
CREATE TYPE "public"."official_role" AS ENUM('treasurer', 'rt_chairman');--> statement-breakpoint
CREATE TABLE "app_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid,
	"auth_user_id" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"login_identifier" varchar(100) NOT NULL,
	"person_id" uuid,
	"household_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_accounts_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_accounts_rt_id_type_uq" UNIQUE("rt_unit_id","id","account_type"),
	CONSTRAINT "app_accounts_type_scope_valid" CHECK (("app_accounts"."account_type" = 'resident' and "app_accounts"."rt_unit_id" is not null and "app_accounts"."person_id" is not null and "app_accounts"."household_id" is not null) or ("app_accounts"."account_type" = 'official' and "app_accounts"."rt_unit_id" is not null and "app_accounts"."person_id" is not null and "app_accounts"."household_id" is null) or ("app_accounts"."account_type" = 'system_admin' and "app_accounts"."rt_unit_id" is null and "app_accounts"."person_id" is null and "app_accounts"."household_id" is null))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failedVerificationCount" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"twoFactorEnabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"status" "billing_year_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_years_rt_id_uq" UNIQUE("rt_unit_id","id"),
	CONSTRAINT "billing_years_year_valid" CHECK ("billing_years"."year" between 2000 and 2200)
);
--> statement-breakpoint
CREATE TABLE "fee_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"billing_year_id" uuid NOT NULL,
	"effective_month" smallint NOT NULL,
	"monthly_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_rates_year_id_uq" UNIQUE("billing_year_id","id"),
	CONSTRAINT "fee_rates_effective_month_valid" CHECK ("fee_rates"."effective_month" between 1 and 12),
	CONSTRAINT "fee_rates_positive_amount" CHECK ("fee_rates"."monthly_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"house_id" uuid NOT NULL,
	"status" "household_status" DEFAULT 'active' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_rt_id_uq" UNIQUE("rt_unit_id","id"),
	CONSTRAINT "households_dates_match_status" CHECK (("households"."status" = 'active' and "households"."ends_on" is null) or ("households"."status" = 'inactive' and "households"."ends_on" is not null and "households"."ends_on" >= "households"."starts_on"))
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"number" varchar(40) NOT NULL,
	"label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "houses_rt_id_uq" UNIQUE("rt_unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "monthly_dues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"billing_year_id" uuid NOT NULL,
	"fee_rate_id" uuid,
	"month" smallint NOT NULL,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" "monthly_due_status" DEFAULT 'unpaid' NOT NULL,
	"waived_reason" "monthly_due_waiver_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_dues_month_valid" CHECK ("monthly_dues"."month" between 1 and 12),
	CONSTRAINT "monthly_dues_due_day_ten" CHECK (extract(day from "monthly_dues"."due_date") = 10),
	CONSTRAINT "monthly_dues_status_amount_consistent" CHECK (("monthly_dues"."status" = 'unpaid' and "monthly_dues"."amount" > 0 and "monthly_dues"."fee_rate_id" is not null and "monthly_dues"."waived_reason" is null) or ("monthly_dues"."status" = 'waived' and "monthly_dues"."amount" = 0 and "monthly_dues"."fee_rate_id" is null and "monthly_dues"."waived_reason" = 'not_yet_resident'))
);
--> statement-breakpoint
CREATE TABLE "official_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"app_account_id" uuid NOT NULL,
	"app_account_type" "account_type" DEFAULT 'official' NOT NULL,
	"role" "official_role" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_assignments_official_type_only" CHECK ("official_assignments"."app_account_type" = 'official'),
	CONSTRAINT "official_assignments_dates_valid" CHECK ("official_assignments"."ends_on" is null or "official_assignments"."ends_on" >= "official_assignments"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"household_id" uuid,
	"full_name" varchar(160) NOT NULL,
	"phone" varchar(32),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_rt_id_uq" UNIQUE("rt_unit_id","id"),
	CONSTRAINT "people_name_not_blank" CHECK (length(trim("people"."full_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "rt_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rt_unit_id" uuid NOT NULL,
	"due_day" smallint DEFAULT 10 NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rt_settings_due_day_ten" CHECK ("rt_settings"."due_day" = 10),
	CONSTRAINT "rt_settings_currency_idr" CHECK ("rt_settings"."currency" = 'IDR')
);
--> statement-breakpoint
CREATE TABLE "rt_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"rw_code" varchar(40) NOT NULL,
	"village" varchar(120) NOT NULL,
	"district" varchar(120),
	"city" varchar(120),
	"province" varchar(120),
	"timezone" varchar(80) DEFAULT 'Asia/Jakarta' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_rt_person_fk" FOREIGN KEY ("rt_unit_id","person_id") REFERENCES "public"."people"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_rt_household_fk" FOREIGN KEY ("rt_unit_id","household_id") REFERENCES "public"."households"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_years" ADD CONSTRAINT "billing_years_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rates" ADD CONSTRAINT "fee_rates_rt_billing_year_fk" FOREIGN KEY ("rt_unit_id","billing_year_id") REFERENCES "public"."billing_years"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_rt_house_fk" FOREIGN KEY ("rt_unit_id","house_id") REFERENCES "public"."houses"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "houses" ADD CONSTRAINT "houses_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_rt_household_fk" FOREIGN KEY ("rt_unit_id","household_id") REFERENCES "public"."households"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_rt_billing_year_fk" FOREIGN KEY ("rt_unit_id","billing_year_id") REFERENCES "public"."billing_years"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_dues" ADD CONSTRAINT "monthly_dues_year_fee_rate_fk" FOREIGN KEY ("billing_year_id","fee_rate_id") REFERENCES "public"."fee_rates"("billing_year_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_assignments" ADD CONSTRAINT "official_assignments_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_assignments" ADD CONSTRAINT "official_assignments_official_account_fk" FOREIGN KEY ("rt_unit_id","app_account_id","app_account_type") REFERENCES "public"."app_accounts"("rt_unit_id","id","account_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_rt_household_fk" FOREIGN KEY ("rt_unit_id","household_id") REFERENCES "public"."households"("rt_unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rt_settings" ADD CONSTRAINT "rt_settings_rt_unit_id_rt_units_id_fk" FOREIGN KEY ("rt_unit_id") REFERENCES "public"."rt_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_login_identifier_uq" ON "app_accounts" USING btree ("rt_unit_id","account_type",lower("login_identifier")) WHERE "app_accounts"."account_type" <> 'system_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_system_admin_login_uq" ON "app_accounts" USING btree (lower("login_identifier")) WHERE "app_accounts"."account_type" = 'system_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_active_resident_household_uq" ON "app_accounts" USING btree ("rt_unit_id","household_id") WHERE "app_accounts"."account_type" = 'resident' and "app_accounts"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_uq" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_years_rt_year_uq" ON "billing_years" USING btree ("rt_unit_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_years_one_open_per_rt_uq" ON "billing_years" USING btree ("rt_unit_id") WHERE "billing_years"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_rates_year_month_uq" ON "fee_rates" USING btree ("billing_year_id","effective_month");--> statement-breakpoint
CREATE UNIQUE INDEX "households_one_active_per_house_uq" ON "households" USING btree ("rt_unit_id","house_id") WHERE "households"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "houses_rt_number_uq" ON "houses" USING btree ("rt_unit_id",upper("number"));--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_dues_household_year_month_uq" ON "monthly_dues" USING btree ("household_id","billing_year_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "official_assignments_one_active_role_uq" ON "official_assignments" USING btree ("rt_unit_id","role") WHERE "official_assignments"."ends_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "official_assignments_one_active_role_per_account_uq" ON "official_assignments" USING btree ("app_account_id") WHERE "official_assignments"."ends_on" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rt_settings_rt_unit_uq" ON "rt_settings" USING btree ("rt_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rt_units_code_rw_uq" ON "rt_units" USING btree ("code","rw_code","village");