import { drizzle } from "drizzle-orm/node-postgres";
import { relationalSchema } from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";
import { createDatabasePool } from "@/db/pool";

const r3Scenarios = [
  "R3-RACE-REQUEST",
  "R3-RACE-VERIFY",
  "R3-RACE-CASH",
  "R3-RACE-REVERSAL",
] as const;

function getR3PoolIdentity() {
  const runId = process.env.KARTURT_R3_RUN_ID;
  const scenario = process.env.KARTURT_R3_SCENARIO;
  const workerTag = process.env.KARTURT_R3_WORKER_TAG;
  const isConfigured = Boolean(runId || scenario || workerTag);
  if (!isConfigured) return undefined;

  if (
    process.env.APP_ENV !== "staging" ||
    process.env.DATABASE_ENV !== "staging" ||
    !runId ||
    !/^[a-z0-9]{8,20}$/.test(runId) ||
    !scenario ||
    !(r3Scenarios as readonly string[]).includes(scenario) ||
    (workerTag !== "a" && workerTag !== "b") ||
    !/^[0-9a-f]{40}$/.test(process.env.KARTURT_COMPILED_RELEASE_SHA ?? "")
  ) {
    throw new Error("R3 worker configuration must match a staged release build and one bounded race scenario.");
  }

  return { applicationName: `krt-r3-${runId}-${scenario}-${workerTag}`, max: 1 as const };
}

function createConnection() {
  const env = requireDatabaseEnvironment();
  const r3PoolIdentity = getR3PoolIdentity();
  const pool = createDatabasePool(
    env.databaseUrl,
    env.databaseEnv,
    "runtime",
    r3PoolIdentity?.max,
    r3PoolIdentity?.applicationName,
  );
  return { pool, db: drizzle({ client: pool, schema: relationalSchema }) };
}

type Connection = ReturnType<typeof createConnection>;
const shared = globalThis as typeof globalThis & { karturtConnection?: Connection };

export function getConnection() {
  shared.karturtConnection ??= createConnection();
  return shared.karturtConnection;
}

export function getDb() {
  return getConnection().db;
}

export async function closeDb() {
  const current = shared.karturtConnection;
  if (!current) return;
  shared.karturtConnection = undefined;
  await current.pool.end();
}

export type AppDatabase = ReturnType<typeof getDb>;
