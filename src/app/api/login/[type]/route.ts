import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/db/client";
import { houses, households, officialAssignments } from "@/db/schema";
import { findUniqueLoginAccount } from "@/lib/auth/login-account";

export const runtime = "nodejs";

const payloadSchema = z.object({
  identifier: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
  website: z.string().max(200).optional(),
});

function currentDateInJakarta() {
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(fields.map((field) => [field.type, field.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function POST(request: Request, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  if (type !== "resident" && type !== "official" && type !== "system_admin") {
    return NextResponse.json({ message: "Jenis akun tidak tersedia." }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "Periksa kembali data yang diisi." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ message: "Periksa kembali data yang diisi." }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ message: "Data masuk belum cocok atau akun belum aktif." }, { status: 401 });
  if (type === "resident" && !/^\d{6}$/.test(parsed.data.password)) {
    return NextResponse.json({ message: "Nomor rumah atau PIN belum cocok." }, { status: 401 });
  }

  const identifier = type === "resident" ? parsed.data.identifier.toUpperCase() : parsed.data.identifier.toLowerCase();
  if (type === "resident" && !/^[-A-Z0-9/ ]{1,40}$/.test(identifier)) {
    return NextResponse.json({ message: "Nomor rumah atau PIN belum cocok." }, { status: 401 });
  }

  const db = getDb();
  const account = await findUniqueLoginAccount(db, type, identifier);

  if (!account || account.status !== "active") {
    return NextResponse.json({ message: "Data masuk belum cocok atau akun belum aktif." }, { status: 401 });
  }

  if (type === "resident") {
    const [activeHousehold] = await db
      .select({ id: households.id })
      .from(households)
      .innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
      .where(and(eq(households.id, account.householdId!), eq(households.status, "active"), sql`upper(${houses.number}) = ${identifier}`))
      .limit(1);
    if (!activeHousehold) return NextResponse.json({ message: "Data masuk belum cocok atau akun belum aktif." }, { status: 401 });
  }

  if (type === "official") {
    const [assignment] = await db
      .select({ id: officialAssignments.id })
      .from(officialAssignments)
      .where(and(eq(officialAssignments.appAccountId, account.id), isNull(officialAssignments.endsOn), lte(officialAssignments.startsOn, currentDateInJakarta())))
      .limit(1);
    if (!assignment) return NextResponse.json({ message: "Data masuk belum cocok atau akun belum aktif." }, { status: 401 });
  }

  const forwardedHeaders = new Headers({ "content-type": "application/json" });
  for (const name of ["origin", "cookie", "x-forwarded-for", "x-real-ip", "user-agent", "accept-language"]) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }

  const authRequest = new Request(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify({ email: account.email, password: parsed.data.password, rememberMe: false }),
  });
  const response = await getAuth().handler(authRequest);
  console.info(JSON.stringify({ event: "auth.login.completed", accountType: type, outcome: response.ok ? "accepted" : "rejected" }));
  return response;
}
