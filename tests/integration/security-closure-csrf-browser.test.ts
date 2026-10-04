import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  auth: undefined as { handler: (request: Request) => Promise<Response>; api: { getSession: (input: { headers: Headers }) => Promise<unknown> } } | undefined,
  requestHeaders: new Headers(),
  publicAppUrl: "",
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.requestHeaders }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => mocks.publicAppUrl }));
vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return { ...actual, getAuth: () => mocks.auth };
});

import { hashPassword } from "better-auth/crypto";
import type { AppDatabase } from "@/db/client";
import { POST as cashPayment } from "@/app/api/treasurer/cash-payments/route";
import { POST as recoverTwoFactor } from "@/app/api/system-admin/accounts/[accountId]/recover-two-factor/route";
import { appAccounts, auditEvents, authAccount, authSession, authTwoFactor, authUser, paymentAllocations, payments } from "@/db/schema";
import { createAuth } from "@/lib/auth/server";
import { createAuthUser, createHousehold, createRt, createTestDatabase } from "../helpers/database";

type BrowserTarget = { type: string; webSocketDebuggerUrl: string };
type CdpMessage = { id?: number; method?: string; error?: unknown; result?: Record<string, unknown> };

describe("S10 two-origin browser CSRF closure", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let appServer: Server | undefined;
  let attackerServer: Server | undefined;
  let browserProcess: ChildProcess | undefined;
  let browserProfile: string | undefined;
  let socket: WebSocket | undefined;
  let auth: ReturnType<typeof createAuth>;
  let appOrigin = "";
  let attackerOrigin = "";
  let treasurerAccountId = "";
  let residentHouseholdId = "";
  let recoveryTargetAccountId = "";
  let recoveryTargetUserId = "";
  let treasurerEmail = "";
  let treasurerPassword = "";
  let adminEmail = "";
  let adminPassword = "";
  let adminTotpSecret = "";
  let cdpId = 0;
  const pending = new Map<number, (message: CdpMessage) => void>();
  const serverProof: Array<{ endpoint: string; origin: string | null; cookiePresent: boolean; sessionValid: boolean; status?: number }> = [];

  async function listen(server: Server) {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", rejectListen);
        resolveListen();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback server did not receive an ephemeral TCP port.");
    return address.port;
  }

  async function requestBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) throw new Error("Browser harness request exceeded its bounded body size.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function toHeaders(request: IncomingMessage) {
    const headers = new Headers();
    for (let index = 0; index < request.rawHeaders.length; index += 2) headers.append(request.rawHeaders[index]!, request.rawHeaders[index + 1]!);
    return headers;
  }

  async function send(response: ServerResponse, result: Response) {
    response.statusCode = result.status;
    result.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") response.setHeader(key, value);
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("set-cookie", cookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  }

  async function appHandler(request: IncomingMessage, response: ServerResponse) {
    const headers = toHeaders(request);
    const body = await requestBody(request);
    const path = request.url ?? "/";
    if (path.startsWith("/api/auth/")) {
      const result = await auth.handler(new Request(appOrigin + path, {
        method: request.method,
        headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
      }));
      await send(response, result);
      return;
    }

    const session = headers.has("cookie") ? await auth.api.getSession({ headers }) : null;
    const endpoint = new URL(path, appOrigin).pathname;
    const proof: { endpoint: string; origin: string | null; cookiePresent: boolean; sessionValid: boolean; status?: number } = {
      endpoint,
      origin: headers.get("origin"),
      cookiePresent: headers.has("cookie"),
      sessionValid: Boolean(session),
    };
    serverProof.push(proof);
    mocks.requestHeaders = headers;
    const requestUrl = appOrigin + path;
    let result: Response;
    if (endpoint === "/api/treasurer/cash-payments" && request.method === "POST") {
      result = await cashPayment(new Request(requestUrl, { method: "POST", headers, body }));
    } else {
      const match = endpoint.match(/^\/api\/system-admin\/accounts\/([^/]+)\/recover-two-factor$/);
      if (!match || request.method !== "POST") {
        result = new Response("Not found", { status: 404 });
      } else {
        result = await recoverTwoFactor(new Request(requestUrl, { method: "POST", headers, body }), {
          params: Promise.resolve({ accountId: match[1]! }),
        });
      }
    }
    proof.status = result.status;
    await send(response, result);
  }

  async function attackerHandler(_request: IncomingMessage, response: ServerResponse) {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(`<!doctype html><meta charset="utf-8"><title>Cross-origin form proof</title>
      <form id="financial" method="post" action="${appOrigin}/api/treasurer/cash-payments" enctype="application/x-www-form-urlencoded">
        <input name="householdId" value="${residentHouseholdId}"><input name="period" value="2099-01"><button id="submit-financial">Submit financial mutation</button>
      </form>
      <form id="recovery" method="post" action="${appOrigin}/api/system-admin/accounts/${recoveryTargetAccountId}/recover-two-factor" enctype="application/x-www-form-urlencoded">
        <input name="reason" value="cross-origin browser proof"><input name="recoveryReference" value="synthetic-reference"><button id="submit-recovery">Submit 2FA recovery</button>
      </form>`);
  }

  async function cdp(method: string, params: Record<string, unknown> = {}) {
    const id = ++cdpId;
    const result = new Promise<CdpMessage>((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectMessage(new Error("Browser command timed out."));
      }, 30000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) rejectMessage(new Error("Browser command failed."));
        else resolveMessage(message);
      });
    });
    socket!.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async function evaluate<T>(expression: string) {
    const message = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const outcome = message.result?.result as { value?: T; exceptionDetails?: unknown } | undefined;
    if (outcome?.exceptionDetails) throw new Error("Browser evaluation failed.");
    return outcome?.value as T;
  }

  async function navigate(url: string) {
    await cdp("Page.navigate", { url });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const done = await evaluate<boolean>(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`);
      if (done) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    throw new Error("Browser did not finish navigation.");
  }

  async function launchBrowser() {
    const candidates = [
      process.env.CHROME_PATH,
      process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
      process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
      process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));
    const binary = candidates.find((candidate) => existsSync(candidate));
    if (!binary) throw new Error("Chrome or Edge is required for the S10 browser proof.");
    const tempBase = resolve(tmpdir());
    browserProfile = mkdtempSync(join(tempBase, "karturt-f21-csrf-"));
    if (!resolve(browserProfile).startsWith(tempBase + sep)) throw new Error("Temporary browser profile escaped the temp directory.");
    browserProcess = spawn(binary, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--remote-allow-origins=*", "--user-data-dir=" + browserProfile, "about:blank"], { stdio: "ignore", windowsHide: true });
    const activePort = join(browserProfile, "DevToolsActivePort");
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (existsSync(activePort)) break;
      if (browserProcess.exitCode !== null) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    if (!existsSync(activePort)) throw new Error("Chrome DevTools did not start.");
    const debugPort = readFileSync(activePort, "utf8").split(/\r?\n/)[0];
    const targets = await (await fetch("http://127.0.0.1:" + debugPort + "/json/list")).json() as BrowserTarget[];
    const target = targets.find((item) => item.type === "page");
    if (!target) throw new Error("Chrome did not expose a page target.");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (typeof message.id === "number") {
        const resolveMessage = pending.get(message.id);
        pending.delete(message.id);
        resolveMessage?.(message);
      }
    });
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => rejectOpen(new Error("Chrome DevTools connection failed.")), { once: true });
    });
    await cdp("Page.enable");
    await cdp("Runtime.enable");
  }

  async function createAccount(kind: "treasurer" | "system_admin") {
    const user = await createAuthUser(testDatabase.db, `F2.1 browser ${kind}`);
    const password = `F21-${randomUUID()}-Pwd`;
    await testDatabase.db.insert(authAccount).values({
      id: randomUUID(), accountId: user.id, providerId: "credential", userId: user.id, password: await hashPassword(password),
    });
    const [account] = await testDatabase.db.insert(appAccounts).values({
      authUserId: user.id,
      accountType: kind === "treasurer" ? "official" : "system_admin",
      loginIdentifier: `${kind}-${randomUUID()}`,
      ...(kind === "treasurer" ? { rtUnitId: rtUnitIdForTreasurer, personId: treasurerPersonId } : {}),
    }).returning({ id: appAccounts.id });
    return { userId: user.id, accountId: account!.id, email: user.email, password };
  }

  let rtUnitIdForTreasurer = "";
  let treasurerPersonId = "";

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    const appPort = await listen(appServer = createServer((request, response) => {
      void appHandler(request, response).catch(() => {
        if (!response.headersSent) response.statusCode = 500;
        response.end("Local test harness failure");
      });
    }));
    const attackerPort = await listen(attackerServer = createServer((request, response) => {
      void attackerHandler(request, response).catch(() => {
        response.statusCode = 500;
        response.end("Local test harness failure");
      });
    }));
    appOrigin = `http://localhost:${appPort}`;
    attackerOrigin = `http://localhost:${attackerPort}`;
    mocks.publicAppUrl = appOrigin;
    mocks.database = testDatabase.db as unknown as AppDatabase;
    auth = createAuth(testDatabase.db as unknown as AppDatabase, {
      secret: `f2.1-local-browser-only-${randomUUID()}-secret-32-characters`,
      baseURL: appOrigin,
    });
    mocks.auth = auth;

    rtUnitIdForTreasurer = await createRt(testDatabase.db);
    const household = await createHousehold(testDatabase.db, rtUnitIdForTreasurer);
    residentHouseholdId = household.householdId;
    treasurerPersonId = household.personId;
    const treasurer = await createAccount("treasurer");
    treasurerAccountId = treasurer.accountId;
    treasurerEmail = treasurer.email;
    treasurerPassword = treasurer.password;
    await testDatabase.db.insert((await import("@/db/schema")).officialAssignments).values({
      rtUnitId: rtUnitIdForTreasurer,
      appAccountId: treasurer.accountId,
      role: "treasurer",
      startsOn: "2000-01-01",
    });

    const admin = await createAccount("system_admin");
    const target = await createAccount("system_admin");
    recoveryTargetAccountId = target.accountId;
    recoveryTargetUserId = target.userId;
    adminEmail = admin.email;
    adminPassword = admin.password;
    await testDatabase.db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, target.userId));
    await testDatabase.db.insert(authTwoFactor).values({
      id: randomUUID(), userId: target.userId, secret: "synthetic-verified-factor", backupCodes: "[]", verified: true,
    });

    const enrollmentLogin = await auth.handler(new Request(appOrigin + "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: appOrigin, "x-forwarded-for": "198.18.0.41" },
      body: JSON.stringify({ email: admin.email, password: admin.password, rememberMe: false }),
    }));
    if (!enrollmentLogin.ok) throw new Error("Synthetic System Admin could not start Better Auth enrollment.");
    const enrollmentCookie = enrollmentLogin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const enrollment = await auth.api.enableTwoFactor({
      body: { password: admin.password, method: "totp", issuer: "KartuRT" },
      headers: new Headers({ cookie: enrollmentCookie, "x-forwarded-for": "198.18.0.41" }),
    });
    if (enrollment.method !== "totp") throw new Error("Synthetic System Admin TOTP enrollment failed.");
    const base32 = (await import("@better-auth/utils/base32")).base32;
    adminTotpSecret = new TextDecoder().decode(base32.decode(new URL(enrollment.totpURI).searchParams.get("secret")!));
    const enrollmentCode = await auth.api.generateTOTP({ body: { secret: adminTotpSecret } });
    await auth.api.verifyTOTP({
      body: { code: enrollmentCode.code, trustDevice: false },
      headers: new Headers({ cookie: enrollmentCookie, "x-forwarded-for": "198.18.0.41" }),
    });
  }, 120000);

  afterAll(async () => {
    socket?.close();
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
      if (process.platform === "win32" && browserProcess.pid) {
        const killer = spawn("taskkill", ["/PID", String(browserProcess.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        await Promise.race([once(killer, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))]);
        await Promise.race([once(browserProcess, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))]).catch(() => undefined);
      } else {
        browserProcess.kill();
        await Promise.race([once(browserProcess, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))]);
      }
    }
    const tempBase = resolve(tmpdir());
    const resolvedProfile = browserProfile ? resolve(browserProfile) : "";
    if (resolvedProfile.startsWith(tempBase + sep)) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        }
      }
      if (lastError) throw lastError;
    }
    for (const server of [appServer, attackerServer]) {
      if (server?.listening) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
    await testDatabase?.close();
  }, 30000);

  it("blocks cross-origin financial and System Admin recovery forms with real cookie sessions", async () => {
    await launchBrowser();

    const login = async (email: string, password: string, totpSecret?: string) => {
      await navigate(appOrigin + "/");
      const code = totpSecret ? (await auth.api.generateTOTP({ body: { secret: totpSecret } })).code : undefined;
      return evaluate<{ status: number; sessionValid: boolean }>(`(async()=>{const r=await fetch(${JSON.stringify(appOrigin + "/api/auth/sign-in/email")},{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(password)},rememberMe:false})});if(${Boolean(code)})await fetch(${JSON.stringify(appOrigin + "/api/auth/two-factor/verify-totp")},{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({code:${JSON.stringify(code ?? "")},trustDevice:false})});const s=await fetch(${JSON.stringify(appOrigin + "/api/auth/get-session")},{credentials:"include"});let session=null;try{session=await s.json()}catch{}return {status:r.status,sessionValid:Boolean(session?.user?.id)}})()`);
    };

    const treasurerLogin = await login(treasurerEmail, treasurerPassword);
    expect(treasurerLogin).toEqual({ status: 200, sessionValid: true });
    const beforeFinancial = {
      payments: (await testDatabase.db.select({ id: payments.id }).from(payments)).length,
      allocations: (await testDatabase.db.select({ id: paymentAllocations.paymentId }).from(paymentAllocations)).length,
      audit: (await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)).length,
    };
    await navigate(attackerOrigin + "/attack");
    await evaluate<void>(`document.querySelector("#financial")?.requestSubmit()`);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await evaluate<string>("location.pathname")).startsWith("/api/treasurer/cash-payments")) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const financeResponse = await evaluate<{ path: string; contentType: string }>(`({path:location.pathname,contentType:document.contentType})`);
    const afterFinancial = {
      payments: (await testDatabase.db.select({ id: payments.id }).from(payments)).length,
      allocations: (await testDatabase.db.select({ id: paymentAllocations.paymentId }).from(paymentAllocations)).length,
      audit: (await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)).length,
    };

    const adminLogin = await login(adminEmail, adminPassword, adminTotpSecret);
    expect(adminLogin).toEqual({ status: 200, sessionValid: true });
    await navigate(attackerOrigin + "/attack");
    await evaluate<void>(`document.querySelector("#recovery")?.requestSubmit()`);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await evaluate<string>("location.pathname")).includes("/recover-two-factor")) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const recoveryResponse = await evaluate<{ path: string; contentType: string }>(`({path:location.pathname,contentType:document.contentType})`);
    const afterRecovery = {
      targetFactors: (await testDatabase.db.select({ id: authTwoFactor.id }).from(authTwoFactor).where(eq(authTwoFactor.userId, recoveryTargetUserId))).length,
      targetSessions: (await testDatabase.db.select({ id: authSession.id }).from(authSession).where(eq(authSession.userId, recoveryTargetUserId))).length,
      audit: (await testDatabase.db.select({ id: auditEvents.id }).from(auditEvents)).length,
    };

    const financeProof = serverProof.find((proof) => proof.endpoint === "/api/treasurer/cash-payments");
    const recoveryProof = serverProof.find((proof) => proof.endpoint.endsWith("/recover-two-factor"));
    expect(financeResponse).toEqual({ path: "/api/treasurer/cash-payments", contentType: "application/json" });
    expect(recoveryResponse.path).toContain("/recover-two-factor");
    expect(recoveryResponse.contentType).toBe("application/json");
    expect(financeProof).toMatchObject({ origin: attackerOrigin, cookiePresent: true, sessionValid: true, status: 403 });
    expect(recoveryProof).toMatchObject({ origin: attackerOrigin, cookiePresent: true, sessionValid: true, status: 403 });
    expect(afterFinancial).toEqual(beforeFinancial);
    expect(afterRecovery).toEqual({ targetFactors: 1, targetSessions: 0, audit: beforeFinancial.audit });
    expect(treasurerAccountId).toMatch(/^[0-9a-f-]{36}$/i);
    console.info(JSON.stringify({
      evidenceType: "s10-two-origin-browser-csrf",
      result: "PASS",
      origins: "distinct-localhost-ports",
      browser: "headless Chromium/Chrome",
      financial: { status: financeProof?.status, cookieDelivered: financeProof?.cookiePresent, sessionValidated: financeProof?.sessionValid, originRejected: financeProof?.status === 403, stateUnchanged: JSON.stringify(afterFinancial) === JSON.stringify(beforeFinancial) },
      systemAdminRecovery: { status: recoveryProof?.status, cookieDelivered: recoveryProof?.cookiePresent, sessionValidated: recoveryProof?.sessionValid, originRejected: recoveryProof?.status === 403, targetStateUnchanged: afterRecovery.targetFactors === 1 && afterRecovery.targetSessions === 0 && afterRecovery.audit === beforeFinancial.audit },
      secretsPersisted: false,
    }));
  }, 120000);
});
