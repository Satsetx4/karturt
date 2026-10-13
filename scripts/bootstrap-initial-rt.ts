import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { closeDb, getDb } from "@/db/client";
import { initializeFirstBillingYear } from "@/lib/billing/chairman-fee-rates";
import { isValidAccountPassword } from "@/lib/auth/account-password";
import { hashApplicationPassword } from "@/lib/auth/password-hash";
import { requireLocalDevelopmentBootstrapDatabaseEnvironment } from "@/lib/env";
import { bootstrapFirstOperationalRt, bootstrapInitialChairman } from "@/lib/rt/bootstrap";
import { jakartaBusinessDate } from "@/lib/time/jakarta";

const confirmation = "INITIALIZE_EMPTY_KARTUR_RT";

const inputSchema = z.object({
  confirmation: z.literal(confirmation),
  rtCode: z.string().trim().min(1).max(40),
  rwCode: z.string().trim().min(1).max(40),
  rtName: z.string().trim().min(1).max(120),
  village: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  chairmanLogin: z.string().trim().min(1).max(100),
  chairmanName: z.string().trim().min(1).max(160),
  chairmanPassword: z.string().min(6).max(128),
  billingYear: z.coerce.number().int().min(2000).max(2200),
  januaryMonthlyAmount: z.coerce.number().int().positive().max(2_147_483_647),
  billingIdempotencyKey: z.string().uuid(),
});

function required(name: string) {
  return process.env[name]?.trim();
}

async function main() {
  loadEnvConfig(process.cwd());
  requireLocalDevelopmentBootstrapDatabaseEnvironment();
  const parsed = inputSchema.safeParse({
    confirmation: required("KARTUR_INITIAL_SETUP_CONFIRMATION"),
    rtCode: required("KARTUR_RT_CODE"),
    rwCode: required("KARTUR_RW_CODE"),
    rtName: required("KARTUR_RT_NAME"),
    village: required("KARTUR_VILLAGE"),
    district: required("KARTUR_DISTRICT") || undefined,
    city: required("KARTUR_CITY") || undefined,
    province: required("KARTUR_PROVINCE") || undefined,
    chairmanLogin: required("KARTUR_INITIAL_CHAIRMAN_LOGIN"),
    chairmanName: required("KARTUR_INITIAL_CHAIRMAN_NAME"),
    chairmanPassword: process.env.KARTUR_INITIAL_CHAIRMAN_PASSWORD,
    billingYear: process.env.KARTUR_INITIAL_BILLING_YEAR,
    januaryMonthlyAmount: process.env.KARTUR_INITIAL_JANUARY_MONTHLY_AMOUNT,
    billingIdempotencyKey: required("KARTUR_INITIAL_BILLING_IDEMPOTENCY_KEY"),
  });
  if (!parsed.success) {
    throw new Error("Initial setup values are incomplete or invalid. Check the operator-only setup variables in README.md.");
  }
  const input = parsed.data;
  if (!isValidAccountPassword("official", input.chairmanPassword)) {
    throw new Error("The initial Chairman password does not meet the official-account password policy.");
  }
  const currentYear = Number(jakartaBusinessDate().slice(0, 4));
  if (input.billingYear <= currentYear) {
    throw new Error("The initial billing year must be a future calendar year.");
  }

  const database = getDb();
  const rt = await bootstrapFirstOperationalRt(database, {
    code: input.rtCode,
    rwCode: input.rwCode,
    name: input.rtName,
    village: input.village,
    district: input.district ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
  });
  const chairman = await bootstrapInitialChairman(database, {
    rtUnitId: rt.id,
    loginIdentifier: input.chairmanLogin,
    displayName: input.chairmanName,
    passwordHash: await hashApplicationPassword(input.chairmanPassword),
    startsOn: jakartaBusinessDate(),
  });
  const billing = await initializeFirstBillingYear(database, chairman.principal, {
    year: input.billingYear,
    monthlyAmount: input.januaryMonthlyAmount,
    idempotencyKey: input.billingIdempotencyKey,
  });

  console.info(JSON.stringify({
    event: "karturt.initial_rt_bootstrapped",
    rtUnitId: rt.id,
    rtCreated: rt.created,
    chairmanAccountId: chairman.appAccountId,
    chairmanPersonId: chairman.personId,
    chairmanCreated: chairman.created,
    billingYearId: billing.billingYearId,
    feeRateId: billing.feeRateId,
    year: billing.year,
    billingYearCreated: !billing.idempotentReplay,
  }));
}

main()
  .catch((error: unknown) => {
    console.error("Initial RT setup failed.", error instanceof Error ? error.message : "Unexpected failure.");
    process.exitCode = 1;
  })
  .finally(closeDb);
