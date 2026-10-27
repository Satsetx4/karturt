ALTER TABLE "app_accounts" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "pin_change_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD COLUMN "pin_change_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_pin_change_failed_attempts_valid" CHECK ("app_accounts"."pin_change_failed_attempts" between 0 and 5);
--> statement-breakpoint
UPDATE "app_accounts" AS app_account
SET "pin_hash" = credential."password"
FROM "account" AS credential
WHERE app_account."account_type" = 'resident'
  AND credential."providerId" = 'credential'
  AND credential."userId" = app_account."auth_user_id"
  AND credential."password" IS NOT NULL
  AND app_account."pin_hash" IS NULL;
