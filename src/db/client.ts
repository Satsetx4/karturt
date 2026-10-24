import { drizzle } from "drizzle-orm/node-postgres";
import { relationalSchema } from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";
import { createDatabasePool } from "@/db/pool";

function createConnection() {
  const env = requireDatabaseEnvironment();
  const pool = createDatabasePool(env.databaseUrl, env.databaseEnv, "runtime");
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
