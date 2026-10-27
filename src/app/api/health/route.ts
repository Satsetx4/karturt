import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getConnection } from "@/db/client";
import { isVerifiedNodeTlsSocket } from "@/db/pool";
import { getR3WorkerIdentity } from "@/lib/r3-worker-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const connection = getConnection();
    await connection.db.execute(sql`select 1`);
    const client = await connection.pool.connect();
    let databaseTlsVerified = false;
    try {
      databaseTlsVerified = isVerifiedNodeTlsSocket(client.connection.stream);
    } finally {
      client.release();
    }
    const workerIdentity = getR3WorkerIdentity(
      request.headers.get("x-karturt-r3-run-id"),
      process.env,
      process.env.KARTURT_COMPILED_RELEASE_SHA,
      process.pid,
    );
    return NextResponse.json({
      status: "ok",
      databaseTlsVerified,
      ...(workerIdentity ? { r3Worker: workerIdentity } : {}),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
