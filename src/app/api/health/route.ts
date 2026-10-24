import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getR3WorkerIdentity } from "@/lib/r3-worker-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await getDb().execute(sql`select 1`);
    const workerIdentity = getR3WorkerIdentity(
      request.headers.get("x-karturt-r3-run-id"),
      process.env,
      process.env.KARTURT_COMPILED_RELEASE_SHA,
      process.pid,
    );
    return NextResponse.json({
      status: "ok",
      ...(workerIdentity ? { r3Worker: workerIdentity } : {}),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
