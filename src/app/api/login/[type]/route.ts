import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { clearResidentLoginFailures, isResidentLoginLocked, recordFailedResidentLogin } from "@/lib/auth/login-lockout";
import { toPublicLoginResponse } from "@/lib/auth/login-response";
import { getDb } from "@/db/client";
import { appAccounts, authAccount, authSession, houses, households, officialAssignments, people } from "@/db/schema";
import { findUniqueLoginAccount } from "@/lib/auth/login-account";
import { officialAssignmentActiveOn, jakartaBusinessDate } from "@/lib/officials/lifecycle";

export const runtime = "nodejs";

type ResidentCredentialSnapshot = { id: string; password: string };

async function readResidentCredentialSnapshot(database: ReturnType<typeof getDb>, authUserId: string) {
  const credentials = await database
    .select({ id: authAccount.id, password: authAccount.password })
    .from(authAccount)
    .where(and(eq(authAccount.userId, authUserId), eq(authAccount.providerId, "credential")))
    .limit(2);
  if (credentials.length !== 1 || !credentials[0]?.password) return null;
  return credentials[0] as ResidentCredentialSnapshot;
}

async function residentLoginStateMatches(
  database: ReturnType<typeof getDb>,
  account: NonNullable<Awaited<ReturnType<typeof findUniqueLoginAccount>>>,
  identifier: string,
  credential: ResidentCredentialSnapshot,
) {
  if (!account.rtUnitId || !account.householdId || !account.personId) return false;

  const currentIdentifierAccount = await findUniqueLoginAccount(database, "resident", identifier);
  if (!currentIdentifierAccount || currentIdentifierAccount.id !== account.id) return false;

  const current = await database
    .select({
      appAccountId: appAccounts.id,
      authUserId: appAccounts.authUserId,
      rtUnitId: appAccounts.rtUnitId,
      householdId: appAccounts.householdId,
      personId: appAccounts.personId,
      credentialId: authAccount.id,
      credentialPassword: authAccount.password,
    })
    .from(appAccounts)
    .innerJoin(households, and(
      eq(households.id, appAccounts.householdId),
      eq(households.rtUnitId, appAccounts.rtUnitId),
    ))
    .innerJoin(houses, and(
      eq(houses.id, households.houseId),
      eq(houses.rtUnitId, households.rtUnitId),
    ))
    .innerJoin(people, and(
      eq(people.id, appAccounts.personId),
      eq(people.rtUnitId, appAccounts.rtUnitId),
      eq(people.householdId, appAccounts.householdId),
    ))
    .innerJoin(authAccount, and(
      eq(authAccount.userId, appAccounts.authUserId),
      eq(authAccount.providerId, "credential"),
    ))
    .where(and(
      eq(appAccounts.id, account.id),
      eq(appAccounts.authUserId, account.authUserId),
      eq(appAccounts.accountType, "resident"),
      eq(appAccounts.status, "active"),
      eq(appAccounts.rtUnitId, account.rtUnitId),
      eq(appAccounts.householdId, account.householdId),
      eq(appAccounts.personId, account.personId),
      eq(households.status, "active"),
      isNull(households.endsOn),
      lte(households.startsOn, jakartaBusinessDate()),
      eq(people.isActive, true),
      sql`upper(${houses.number}) = ${identifier}`,
    ))
    .limit(2);

  return current.length === 1
    && current[0]?.appAccountId === account.id
    && current[0]?.authUserId === account.authUserId
    && current[0]?.credentialId === credential.id
    && current[0]?.credentialPassword === credential.password;
}

async function rejectChangedResidentLogin(database: ReturnType<typeof getDb>, authUserId: string) {
  await database.delete(authSession).where(eq(authSession.userId, authUserId));
  console.info(JSON.stringify({ event: "auth.login.completed", accountType: "resident", outcome: "rejected" }));
  return toPublicLoginResponse(new Response(null, { status: 401 }));
}

const payloadSchema = z.object({
  identifier: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
  website: z.string().max(200).optional(),
});

function createCredentialAuthRequest(request: Request, email: string, password: string) {
  const forwardedHeaders = new Headers({ "content-type": "application/json" });
  for (const name of ["origin", "cookie", "x-forwarded-for", "x-real-ip", "user-agent", "accept-language"]) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }
  return new Request(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers: forwardedHeaders,
    body: JSON.stringify({ email, password, rememberMe: false }),
  });
}

async function rejectLoginAttempt(request: Request, type: string, password: string) {
  const response = await getAuth().handler(createCredentialAuthRequest(
    request,
    "unmatched-login@accounts.karturt.invalid",
    password,
  ));
  console.info(JSON.stringify({ event: "auth.login.completed", accountType: type, outcome: "rejected" }));
  return toPublicLoginResponse(response);
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
    return rejectLoginAttempt(request, type, parsed.data.password);
  }

  if (type === "resident" && await isResidentLoginLocked(db, account.id)) {
    return rejectLoginAttempt(request, type, parsed.data.password);
  }

  if (type === "resident") {
    const businessDate = jakartaBusinessDate();
    const [activeHousehold] = await db
      .select({ id: households.id })
      .from(households)
      .innerJoin(houses, and(eq(houses.id, households.houseId), eq(houses.rtUnitId, households.rtUnitId)))
      .innerJoin(people, and(
        eq(people.rtUnitId, households.rtUnitId),
        eq(people.householdId, households.id),
        eq(people.id, account.personId!),
      ))
      .where(and(
        eq(households.id, account.householdId!),
        eq(households.status, "active"),
        isNull(households.endsOn),
        lte(households.startsOn, businessDate),
        eq(people.isActive, true),
        sql`upper(${houses.number}) = ${identifier}`,
      ))
      .limit(1);
    if (!activeHousehold) return rejectLoginAttempt(request, type, parsed.data.password);
  }

  const residentCredential = type === "resident"
    ? await readResidentCredentialSnapshot(db, account.authUserId)
    : null;
  if (type === "resident" && !residentCredential) {
    return rejectLoginAttempt(request, type, parsed.data.password);
  }

  if (type === "official") {
    const assignments = await db
      .select({ id: officialAssignments.id })
      .from(officialAssignments)
      .where(and(eq(officialAssignments.appAccountId, account.id), officialAssignmentActiveOn(jakartaBusinessDate())))
      .limit(2);
    if (assignments.length !== 1) return rejectLoginAttempt(request, type, parsed.data.password);
  }

  const authRequest = createCredentialAuthRequest(request, account.email, parsed.data.password);
  const response = await getAuth().handler(authRequest);
  if (type === "resident" && response.ok && residentCredential) {
    const stillCurrent = await residentLoginStateMatches(db, account, identifier, residentCredential);
    if (!stillCurrent) return rejectChangedResidentLogin(db, account.authUserId);
  }
  if (type === "resident" && response.status === 401) await recordFailedResidentLogin(db, account.id);
  if (type === "resident" && response.ok) await clearResidentLoginFailures(db, account.id);
  console.info(JSON.stringify({ event: "auth.login.completed", accountType: type, outcome: response.ok ? "accepted" : "rejected" }));
  return toPublicLoginResponse(response);
}
