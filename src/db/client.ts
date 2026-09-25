import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";

function createConnection() {
  const env = requireDatabaseEnvironment();
  const pool = new Pool({ connectionString: env.databaseUrl, max: 5, connectionTimeoutMillis: 10_000 });
  return { pool, db: drizzle({ client: pool, schema }) };
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
