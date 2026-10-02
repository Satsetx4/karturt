import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import {
  activeDueSettlements,
  appAccounts,
  auditEvents,
  authAccount,
  authSession,
  authUser,
  billingYears,
  feeRates,
  households,
  houses,
  monthlyDues,
  officialAssignments,
  paymentAllocations,
  paymentRequestClaims,
  paymentRequests,
  paymentReversals,
  payments,
  people,
  rtSettings,
  rtUnits,
  waiverActions,
  waiverItems,
} from "@/db/schema";
import { requireDatabaseEnvironment } from "@/lib/env";

const target = {
  projectId: "billowing-base-57949906",
  branchId: "br-crimson-band-az6i637k",
  endpointId: "ep-quiet-cake-azrhjiyh",
  databaseName: "neondb",
};
const root = process.cwd();
const expectedPort = 3200;
const browserViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const userIds: string[] = [];
let nextProcess: ChildProcess | undefined;
let browserProcess: ChildProcess | undefined;
let devtoolsSocket: WebSocket | undefined;
let browserProfile: string | undefined;
let currentStage = "initialization";

type FixturePerson = {
  accountId: string;
  userId: string;
  householdId: string;
  personId: string;
  houseNumber: string;
  identifier: string;
  password: string;
};

function assertDevelopmentTarget() {
  const env = requireDatabaseEnvironment();
  if (env.appEnv !== "development" || env.databaseEnv !== "development") {
    throw new Error("Both application and database labels must be development.");
  }
  const expected = {
    KARTURT_NEON_DEV_PROJECT_ID: target.projectId,
    KARTURT_NEON_DEV_BRANCH_ID: target.branchId,
    KARTURT_NEON_DEV_ENDPOINT_ID: target.endpointId,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) throw new Error(`The verified development target is required in ${key}.`);
  }
  const databaseUrl = new URL(env.databaseUrl);
  if (
    databaseUrl.hostname.split(".")[0] !== target.endpointId ||
    databaseUrl.hostname.includes("pooler") ||
    databaseUrl.pathname !== `/${target.databaseName}`
  ) {
    throw new Error("DATABASE_URL must use the direct karturt-development endpoint and neondb database.");
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("The local HTTP smoke URL is required.");
  const parsedAppUrl = new URL(appUrl);
  if (parsedAppUrl.hostname !== "127.0.0.1" || Number(parsedAppUrl.port) !== expectedPort) {
    throw new Error(`The HTTP smoke must use http://127.0.0.1:${expectedPort}.`);
  }
  return { baseUrl: parsedAppUrl.origin, databaseHost: databaseUrl.hostname };
}

async function verifyMigrationHead() {
  const expectedHash = createHash("sha256")
    .update(readFileSync(resolve(root, "drizzle/0011_phase_10_waiver.sql")))
    .digest("hex");
  const result = await getDb().execute(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const rows = (result as unknown as { rows: Array<{ hash: string }> }).rows;
  if (rows?.[0]?.hash !== expectedHash) {
    throw new Error("Development migration head is not the current 0011_phase_10_waiver migration.");
  }
  await getDb().select({ id: waiverActions.id }).from(waiverActions).limit(0);
  return expectedHash;
}

async function startNext(baseUrl: string) {
  const appUrl = new URL(baseUrl);
  let spawnFailure: NodeJS.ErrnoException | undefined;
  let lastHttpStatus: number | undefined;
  nextProcess = spawn(process.execPath, [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(expectedPort),
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "test",
      DATABASE_ENV: "test",
      NEXT_PUBLIC_APP_URL: appUrl.origin,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  nextProcess.on("error", (error) => {
    spawnFailure = error as NodeJS.ErrnoException;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (spawnFailure) throw new Error(`Local server could not start (${spawnFailure.code ?? spawnFailure.name}).`);
    if (nextProcess.exitCode !== null) {
      throw new Error(`Local server exited before becoming ready (code ${nextProcess.exitCode}, signal ${nextProcess.signalCode ?? "none"}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/login/pengurus`, { cache: "no-store" });
      lastHttpStatus = response.status;
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Local server did not become ready (last HTTP status ${lastHttpStatus ?? "none"}).`);
}

function getChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Chrome or Edge is required for the responsive browser smoke.");
  return executable;
}

function cookiePairs(cookie: string) {
  return cookie.split("; ").map((part) => {
    const separator = part.indexOf("=");
    return { name: part.slice(0, separator), value: part.slice(separator + 1) };
  });
}

async function testBrowserFlow(
  baseUrl: string,
  chairmanCookie: string,
  residentCookie: string,
  households: {
    main: string;
    pending: string;
    paid: string;
    notDue: string;
    eligible: string;
  },
) {
  const tempRoot = resolve(tmpdir());
  browserProfile = mkdtempSync(join(tempRoot, "karturt-phase-10-chrome-"));
  const resolvedProfile = resolve(browserProfile);
  if (!resolvedProfile.startsWith(`${tempRoot}${sep}`)) throw new Error("The temporary browser profile escaped its safe directory.");
  browserProcess = spawn(getChromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${resolvedProfile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  const activePortPath = join(resolvedProfile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(activePortPath); attempt += 1) {
    if (browserProcess.exitCode !== null) throw new Error("The browser exited before its debug port opened.");
    await delay(100);
  }
  if (!existsSync(activePortPath)) throw new Error("The browser debug port did not open.");
  const debugPort = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const pageTarget = targets.find((item) => item.type === "page");
  if (!pageTarget) throw new Error("The browser did not provide a page target.");

  devtoolsSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const pageErrors: string[] = [];
  let waiverPostCount = 0;
  let commandId = 0;
  devtoolsSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown> & {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request as { url?: string; method?: string } | undefined;
      if (request?.url?.endsWith("/api/chairman/waivers") && request.method === "POST") waiverPostCount += 1;
    }
    if (message.method === "Runtime.exceptionThrown") pageErrors.push("runtime exception");
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry as { level?: string } | undefined;
      if (entry?.level === "error") pageErrors.push("console error");
    }
    if (typeof message.id !== "number") return;
    const resolveMessage = pending.get(message.id);
    if (!resolveMessage) return;
    pending.delete(message.id);
    resolveMessage(message);
  });
  await new Promise<void>((resolveOpen, rejectOpen) => {
    devtoolsSocket!.addEventListener("open", () => resolveOpen(), { once: true });
    devtoolsSocket!.addEventListener("error", () => rejectOpen(new Error("Browser DevTools connection failed.")), { once: true });
  });

  const command = (method: string, params: Record<string, unknown> = {}) => {
    const id = ++commandId;
    const promise = new Promise<Record<string, unknown>>((resolveMessage, rejectMessage) => {
      const timeoutMs = method === "Page.navigate" ? 120_000 : 30_000;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectMessage(new Error(`Browser DevTools command timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) rejectMessage(new Error(`Browser DevTools command failed: ${method}`));
        else resolveMessage(message);
      });
    });
    devtoolsSocket!.send(JSON.stringify({ id, method, params }));
    return promise;
  };

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const result = response.result as { result?: { value?: T }; exceptionDetails?: unknown };
    if (result?.exceptionDetails) throw new Error("Browser page evaluation failed.");
    return result?.result?.value as T;
  };

  const waitFor = async (expression: string, message: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate<boolean>(expression)) return;
      await delay(100);
    }
    throw new Error(message);
  };

  const setViewport = async (viewport: { width: number; height: number }) => {
    await command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width <= 430,
    });
    await command("Emulation.setTouchEmulationEnabled", viewport.width <= 768
      ? { enabled: true, maxTouchPoints: 1 }
      : { enabled: false });
  };

  const navigate = async (url: string, viewport: { width: number; height: number }) => {
    await setViewport(viewport);
    await command("Page.navigate", { url });
    await waitFor(
      `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
      "The requested page did not finish loading.",
    );
    await delay(150);
  };

  const installCookie = async (cookie: string) => {
    for (const { name, value } of cookiePairs(cookie)) {
      await command("Network.setCookie", { name, value, url: baseUrl, sameSite: "Lax" });
    }
  };

  const selectHousehold = async (houseNumber: string) => {
    await evaluate(`(() => {
      const input = document.querySelector('#waiver-search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(houseNumber)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(
      `[...document.querySelectorAll('.waiver-household-option')].some(item => item.innerText.includes(${JSON.stringify(`Rumah ${houseNumber}`)}))`,
      "The Chairman household search did not return the requested fixture.",
    );
    const targets = await evaluate<{ searchHeight: number; resultHeight: number }>(`(() => {
      const search = document.querySelector('#waiver-search');
      const result = [...document.querySelectorAll('.waiver-household-option')]
        .find(item => item.innerText.includes(${JSON.stringify(`Rumah ${houseNumber}`)}));
      return {
        searchHeight: search ? Math.round(search.getBoundingClientRect().height) : 0,
        resultHeight: result ? Math.round(result.getBoundingClientRect().height) : 0,
      };
    })()`);
    assert.ok(targets.searchHeight >= 44, "Household search target is below 44px.");
    assert.ok(targets.resultHeight >= 44, "Household result target is below 44px.");
    await evaluate(`([...document.querySelectorAll('.waiver-household-option')]
      .find(item => item.innerText.includes(${JSON.stringify(`Rumah ${houseNumber}`)}))).click()`);
    await waitFor("document.querySelector('.waiver-due-list') !== null", "The Chairman due list did not render.");
    return targets;
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Log.enable");
  await installCookie(chairmanCookie);
  await navigate(`${baseUrl}/app`, browserViewports[1]!);
  await waitFor("document.querySelector('a[href=\"/app/pemutihan\"]') !== null", "The Chairman dashboard has no waiver entry.");
  const entry = await evaluate<{ text: string; overflow: boolean; height: number }>(`(() => {
    const link = document.querySelector('a[href="/app/pemutihan"]');
    return {
      text: link?.innerText ?? '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      height: link ? Math.round(link.getBoundingClientRect().height) : 0,
    };
  })()`);
  assert.match(entry.text, /Buka pemutihan iuran/);
  assert.equal(entry.overflow, false);
  assert.ok(entry.height >= 44);

  const statusHouseholds = [
    { house: households.main, expected: "Dibebaskan" },
    { house: households.pending, expected: "Menunggu konfirmasi" },
    { house: households.paid, expected: "Sudah bayar" },
    { house: households.notDue, expected: "Tidak perlu bayar" },
  ];
  const disabledStatusEvidence: Array<{ status: string; disabled: boolean }> = [];
  const searchTargetEvidence: Array<{ searchHeight: number; resultHeight: number }> = [];
  let noRawEnum = true;
  for (const item of statusHouseholds) {
    await navigate(`${baseUrl}/app/pemutihan`, browserViewports[1]!);
    searchTargetEvidence.push(await selectHousehold(item.house));
    const statusScreen = await evaluate<{
      rows: Array<{ status: string; disabled: boolean; explanation: string; rowHeight: number }>;
      rawEnum: boolean;
      rawTokens: string[];
      rawParents: Array<{ tag: string; className: string }>;
    }>(`
      (() => ({
        rows: [...document.querySelectorAll('.waiver-due-option')].map(row => ({
          status: row.querySelector('.waiver-status')?.innerText ?? '',
          disabled: row.querySelector('input')?.disabled ?? false,
          explanation: row.querySelector('.waiver-due-explanation')?.innerText ?? '',
          rowHeight: Math.round(row.getBoundingClientRect().height),
        })),
        rawEnum: /\\b(?:WAIVED|UNPAID|NOT_DUE|PENDING|PAID)\\b/i.test(
          [...document.querySelectorAll('.waiver-due-option .waiver-status, .waiver-due-option .waiver-due-explanation')]
            .map(item => item.innerText).join(' ')),
        rawTokens: ['WAIVED', 'UNPAID', 'NOT_DUE', 'PENDING', 'PAID']
          .filter(token => new RegExp('\\\\b' + token + '\\\\b', 'i').test(
            [...document.querySelectorAll('.waiver-due-option .waiver-status, .waiver-due-option .waiver-due-explanation')]
              .map(item => item.innerText).join(' '))),
        rawParents: (() => {
          const matches = [];
          for (const element of document.querySelectorAll('.waiver-due-option .waiver-status, .waiver-due-option .waiver-due-explanation')) {
            if (/(?:\\bWAIVED\\b|\\bUNPAID\\b|\\bNOT_DUE\\b|\\bPENDING\\b|\\bPAID\\b)/i.test(element.innerText)) {
              matches.push({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '' });
            }
          }
          return matches;
        })(),
      }))()
    `);
    const rows = statusScreen.rows;
    noRawEnum &&= !statusScreen.rawEnum;
    if (statusScreen.rawEnum) throw new Error(`Chairman due list displays an internal status: ${statusScreen.rawTokens.join(", ")} in ${JSON.stringify(statusScreen.rawParents)}.`);
    assert.ok(rows.every((row) => row.explanation.trim().length > 0), "A due status is missing its explanation.");
    assert.ok(rows.every((row) => row.rowHeight >= 44), "A due status row is below the 44px target size.");
    assert.ok(rows.some((row) => row.status === item.expected), `Expected ${item.expected} in Chairman due list.`);
    assert.ok(rows.filter((row) => row.status === item.expected).every((row) => row.disabled));
    disabledStatusEvidence.push(...rows.filter((row) => row.status === item.expected));
  }

  await navigate(`${baseUrl}/app/pemutihan`, browserViewports[1]!);
  await selectHousehold(households.eligible);
  await evaluate(`([...document.querySelectorAll('.waiver-due-option input:not(:disabled)')].slice(0, 2))
    .forEach(input => input.click())`);
  const reasonRequired = await evaluate<boolean>(`document.querySelector('.waiver-primary-button')?.disabled === true`);
  assert.equal(reasonRequired, true, "The review action must stay disabled before a reason is entered.");
  const reason = "Keputusan resmi untuk uji tampilan dan aksesibilitas";
  await evaluate(`(() => {
    const input = document.querySelector('#waiver-reason');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(reason)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.waiver-primary-button')?.disabled === false", "The reason did not enable the review step.");
  await evaluate(`[...document.querySelectorAll('.waiver-primary-button')]
    .find(button => button.innerText.includes('Tinjau pemutihan')).click()`);
  await waitFor("document.querySelector('.waiver-confirmation') !== null", "The waiver confirmation did not render.");
  const confirmationEvidence: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const evidence = await evaluate<{
      overflow: boolean;
      houseVisible: boolean;
      periodsVisible: boolean;
      amountVisible: boolean;
      reasonVisible: boolean;
      rawIdentifier: boolean;
      rawEnum: boolean;
      technicalCopy: boolean;
      actionHeight: number;
    }>(`(() => {
      const text = document.body.innerText.replace(/\\s+/g, ' ');
      const action = [...document.querySelectorAll('.waiver-confirmation .waiver-primary-button')]
        .find(button => button.innerText.includes('Konfirmasi pemutihan'));
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        houseVisible: text.includes(${JSON.stringify(`Rumah ${households.eligible}`)}),
        periodsVisible: text.includes('Oktober 2026') && text.includes('November 2026'),
        amountVisible: text.includes('40.000'),
        reasonVisible: text.includes(${JSON.stringify(reason)}),
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
        rawEnum: /\\b(?:WAIVED|UNPAID|NOT_DUE|PENDING|PAID)\\b/i.test(
          [...document.querySelectorAll('.waiver-confirmation')].map(item => item.innerText).join(' ')),
        technicalCopy: /SQLSTATE|internal server error|undefined|null/i.test(text),
        actionHeight: action ? Math.round(action.getBoundingClientRect().height) : 0,
      };
    })()`);
    assert.equal(evidence.overflow, false, `Chairman confirmation has horizontal overflow at ${viewport.width}px.`);
    assert.equal(evidence.houseVisible, true, `Chairman confirmation omits the household at ${viewport.width}px.`);
    assert.equal(evidence.periodsVisible, true, `Chairman confirmation omits selected months at ${viewport.width}px.`);
    assert.equal(evidence.amountVisible, true, `Chairman confirmation total is incorrect at ${viewport.width}px.`);
    assert.equal(evidence.reasonVisible, true, `Chairman confirmation omits its reason at ${viewport.width}px.`);
    assert.equal(evidence.rawIdentifier, false, `A raw identifier is visible at ${viewport.width}px.`);
    assert.equal(evidence.rawEnum, false, `A raw status enum is visible at ${viewport.width}px.`);
    assert.equal(evidence.technicalCopy, false, `Technical error text is visible at ${viewport.width}px.`);
    assert.ok(evidence.actionHeight >= 44, `Confirmation action is below 44px at ${viewport.width}px.`);
    confirmationEvidence.push({ width: viewport.width, ...evidence });
  }

  await setViewport({ width: 390, height: 844 });
  const postCountBefore = waiverPostCount;
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.waiver-confirmation .waiver-primary-button')]
      .find(item => item.innerText.includes('Konfirmasi pemutihan'));
    button.click();
    button.click();
  })()`);
  await waitFor("document.querySelector('.waiver-success') !== null", "Chairman flow did not reach a clear success state.");
  await delay(300);
  assert.equal(waiverPostCount - postCountBefore, 1, "A confirmation double-click sent more than one waiver mutation.");
  const success = await evaluate<{ visible: boolean; amount: boolean; reason: boolean; overflow: boolean }>(`(() => {
    const text = document.querySelector('.waiver-success')?.innerText ?? '';
    return {
      visible: text.includes('Pemutihan berhasil dicatat'),
      amount: text.includes('40.000'),
      reason: text.includes(${JSON.stringify(reason)}),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
  assert.deepEqual(success, { visible: true, amount: true, reason: true, overflow: false });

  await installCookie(residentCookie);
  await navigate(`${baseUrl}/app`, browserViewports[1]!);
  await waitFor("document.querySelector('.resident-area .due-status') !== null", "Resident due status did not finish loading.");
  const residentViews: Array<Record<string, unknown>> = [];
  for (const viewport of browserViewports) {
    await setViewport(viewport);
    const view = await evaluate<{ dibebaskan: boolean; reasonHidden: boolean; rawIdentifier: boolean; rawEnum: boolean; overflow: boolean }>(`(() => {
      const text = document.body.innerText.replace(/\\s+/g, ' ');
      return {
        dibebaskan: text.includes('Dibebaskan'),
        reasonHidden: !text.includes('Keputusan rapat warga fase sepuluh'),
        rawIdentifier: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),
        rawEnum: /\\b(?:WAIVED|UNPAID|NOT_DUE|PENDING|PAID)\\b/i.test(
          [...document.querySelectorAll('.due-status')].map(item => item.innerText).join(' ')),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`);
    assert.equal(view.dibebaskan, true, `Resident view does not render Dibebaskan at ${viewport.width}px.`);
    assert.equal(view.reasonHidden, true, `Internal waiver reason leaked to the resident at ${viewport.width}px.`);
    assert.equal(view.rawIdentifier, false, `A raw identifier is visible to the resident at ${viewport.width}px.`);
    assert.equal(view.rawEnum, false, `A raw status enum is visible to the resident at ${viewport.width}px.`);
    assert.equal(view.overflow, false, `Resident view has horizontal overflow at ${viewport.width}px.`);
    residentViews.push({ width: viewport.width, ...view });
  }
  assert.equal(pageErrors.length, 0, "The waiver browser flow reported a page exception or console error.");
  return {
    discoverable: true,
    entry,
    searchTargetEvidence,
    disabledStatusEvidence,
    noRawEnum,
    reasonRequired,
    confirmation: confirmationEvidence,
    doubleClickMutations: waiverPostCount - postCountBefore,
    success,
    residentViews,
    pageErrors,
  };
}

async function createPerson(
  rtUnitId: string,
  options: { houseNumber: string; accountType: "resident" | "official"; name: string },
): Promise<FixturePerson> {
  const db = getDb();
  const [house] = await db.insert(houses).values({ rtUnitId, number: options.houseNumber })
    .returning({ id: houses.id });
  const [household] = await db.insert(households).values({
    rtUnitId,
    houseId: house!.id,
    startsOn: "2020-01-01",
  }).returning({ id: households.id });
  const [person] = await db.insert(people).values({
    rtUnitId,
    householdId: household!.id,
    fullName: options.name,
  }).returning({ id: people.id });
  const userId = randomUUID();
  const identifier = options.accountType === "official" ? `p10-${randomUUID().slice(0, 10)}` : options.houseNumber;
  const password = options.accountType === "official"
    ? randomBytes(18).toString("base64url")
    : String(randomInt(100000, 1000000));
  await db.insert(authUser).values({
    id: userId,
    name: options.name,
    email: `${randomUUID()}@example.invalid`,
    emailVerified: true,
  });
  const [account] = await db.insert(appAccounts).values({
    rtUnitId,
    authUserId: userId,
    accountType: options.accountType,
    loginIdentifier: identifier,
    personId: person!.id,
    householdId: options.accountType === "resident" ? household!.id : null,
  }).returning({ id: appAccounts.id });
  await db.insert(authAccount).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
  });
  userIds.push(userId);
  return {
    accountId: account!.id,
    userId,
    householdId: household!.id,
    personId: person!.id,
    houseNumber: options.houseNumber,
    identifier,
    password,
  };
}

async function signIn(baseUrl: string, type: "resident" | "official", person: FixturePerson) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${baseUrl}/api/login/${type}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ identifier: person.identifier, password: person.password }),
    });
    if (response.status !== 429 || attempt > 0) break;
    const retryAfter = response.headers.get("retry-after");
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : retryAfter
        ? Date.parse(retryAfter) - Date.now()
        : 60_000;
    await delay(Math.min(Math.max(retryDelay, 1000), 65_000));
  }
  assert.ok(response);
  if (response.status !== 200) throw new Error(`Normal ${type} sign-in returned HTTP ${response.status}.`);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  if (!cookie) throw new Error(`Normal ${type} sign-in returned no session cookie.`);
  return cookie;
}

async function getJson<T>(url: string, cookie: string): Promise<T> {
  const response = await fetch(url, { headers: { cookie }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  assert.equal(response.status, 200, `GET ${new URL(url).pathname} must return 200: ${body.message ?? ""}`);
  return body;
}

async function postJson(
  url: string,
  cookie: string,
  baseUrl: string,
  body: unknown,
  idempotencyKey?: string,
) {
  const headers = new Headers({ "content-type": "application/json", origin: baseUrl });
  headers.set("cookie", cookie);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
}

async function addDues(rtUnitId: string, householdId: string, yearId: string, feeRateId: string, months: number[]) {
  return getDb().insert(monthlyDues).values(months.map((month) => ({
    rtUnitId,
    householdId,
    billingYearId: yearId,
    feeRateId,
    month,
    amount: 20000,
    dueDate: `2026-${String(month).padStart(2, "0")}-10`,
    status: "unpaid" as const,
  }))).returning({ id: monthlyDues.id, month: monthlyDues.month });
}

async function runGlobalInvariantChecks() {
  const db = getDb();
  const waivedWithoutOneItem = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM public.monthly_dues due
    LEFT JOIN public.waiver_items item ON item.monthly_due_id = due.id
    WHERE due.status = 'waived'
    GROUP BY due.id
    HAVING count(item.monthly_due_id) <> 1
  `);
  const activeOwnersOnWaived = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM public.active_due_settlements settlement
    JOIN public.monthly_dues due ON due.id = settlement.monthly_due_id
    WHERE due.status = 'waived'
  `);
  const pendingClaimsOnWaived = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM public.payment_request_claims claim
    JOIN public.payment_requests request ON request.id = claim.request_id
    JOIN public.monthly_dues due ON due.id = claim.monthly_due_id
    WHERE due.status = 'waived' AND request.status = 'pending'
  `);
  const incompleteActions = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM public.waiver_actions action
    LEFT JOIN LATERAL (
      SELECT count(*) AS item_count, coalesce(sum(item.amount), 0) AS item_total
      FROM public.waiver_items item
      WHERE item.waiver_action_id = action.id
    ) items ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS audit_count
      FROM public.audit_events audit
      WHERE audit.action = 'waiver.created'
        AND audit.entity_type = 'waiver_action'
        AND audit.entity_id = action.id::text
        AND audit.actor_app_account_id = action.waived_by_account_id
        AND audit.reason = action.reason
    ) audits ON true
    WHERE items.item_count <> action.item_count
       OR items.item_total <> action.total_amount
       OR audits.audit_count <> 1
  `);

  const countRows = (result: unknown) => {
    const rows = (result as { rows?: Array<{ count: number | string }> }).rows ?? [];
    return rows.reduce((total, row) => total + Number(row.count), 0);
  };
  const anomalies = {
    waivedWithoutOneItem: countRows(waivedWithoutOneItem),
    activeOwnersOnWaived: countRows(activeOwnersOnWaived),
    pendingClaimsOnWaived: countRows(pendingClaimsOnWaived),
    incompleteActions: countRows(incompleteActions),
  };
  assert.deepEqual(anomalies, {
    waivedWithoutOneItem: 0,
    activeOwnersOnWaived: 0,
    pendingClaimsOnWaived: 0,
    incompleteActions: 0,
  });
  return anomalies;
}

async function main() {
  process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${expectedPort}`;
  loadEnvConfig(root);
  const verifiedTarget = assertDevelopmentTarget();

  // Revalidate immediately before opening the development database and writing fixtures.
  const writeTarget = assertDevelopmentTarget();
  assert.equal(writeTarget.databaseHost, verifiedTarget.databaseHost);
  currentStage = "verify development migration head";
  const migrationHash = await verifyMigrationHead();

  currentStage = "start local application server";
  await startNext(verifiedTarget.baseUrl);
  currentStage = "create synthetic development fixtures";
  const db = getDb();
  const suffix = randomBytes(5).toString("hex").toUpperCase();
  const [unit] = await db.insert(rtUnits).values({
    code: `P10-${suffix}`,
    rwCode: `P10-${suffix}`,
    name: `Phase 10 synthetic unit ${suffix}`,
    village: "Synthetic development fixture",
  }).returning({ id: rtUnits.id });
  const rtUnitId = unit!.id;
  await db.insert(rtSettings).values({ rtUnitId });

  const chairman = await createPerson(rtUnitId, {
    houseNumber: `P10-CHAIR-${suffix}`,
    accountType: "official",
    name: `Phase 10 smoke Chairman ${suffix}`,
  });
  await db.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: chairman.accountId,
    role: "rt_chairman",
    startsOn: "2020-01-01",
  });
  const treasurer = await createPerson(rtUnitId, {
    houseNumber: `P10-TREASURER-${suffix}`,
    accountType: "official",
    name: `Phase 10 smoke Treasurer ${suffix}`,
  });
  await db.insert(officialAssignments).values({
    rtUnitId,
    appAccountId: treasurer.accountId,
    role: "treasurer",
    startsOn: "2020-01-01",
  });

  const residentOptions = [
    ["A", "multi-month"],
    ["B", "pending"],
    ["C", "request-race"],
    ["D", "cash-race"],
    ["E", "transfer-reversal"],
    ["F", "cash-reversal"],
    ["G", "verify-race"],
    ["H", "browser-ui"],
    ["I", "not-due"],
  ] as const;
  const residents = new Map<string, FixturePerson>();
  for (const [letter, purpose] of residentOptions) {
    residents.set(purpose, await createPerson(rtUnitId, {
      houseNumber: `P10${letter}-${suffix}`,
      accountType: "resident",
      name: `Phase 10 ${purpose} resident ${suffix}`,
    }));
  }

  const [year] = await db.insert(billingYears).values({ rtUnitId, year: 2026, status: "open" })
    .returning({ id: billingYears.id });
  const [feeRate] = await db.insert(feeRates).values({
    rtUnitId,
    billingYearId: year!.id,
    effectiveMonth: 1,
    monthlyAmount: 20000,
  }).returning({ id: feeRates.id });
  const periodFixtures = [
    { key: "multi-month", months: [1, 2, 3] },
    { key: "pending", months: [4] },
    { key: "request-race", months: [5] },
    { key: "cash-race", months: [6] },
    { key: "transfer-reversal", months: [7] },
    { key: "cash-reversal", months: [8] },
    { key: "verify-race", months: [9] },
    { key: "browser-ui", months: [10, 11, 12] },
  ];
  for (const fixture of periodFixtures) {
    const resident = residents.get(fixture.key)!;
    await addDues(rtUnitId, resident.householdId, year!.id, feeRate!.id, fixture.months);
  }
  const notDueResident = residents.get("not-due")!;
  await db.insert(monthlyDues).values({
    rtUnitId,
    householdId: notDueResident.householdId,
    billingYearId: year!.id,
    feeRateId: null,
    month: 12,
    amount: 0,
    dueDate: "2026-12-10",
    status: "not_due",
  });

  currentStage = "Chairman sign-in";
  const chairmanCookie = await signIn(verifiedTarget.baseUrl, "official", chairman);
  currentStage = "Treasurer sign-in";
  const treasurerCookie = await signIn(verifiedTarget.baseUrl, "official", treasurer);
  const residentCookies = new Map<string, string>();
  for (const purpose of ["multi-month", "pending", "request-race", "cash-race", "transfer-reversal", "cash-reversal", "verify-race"]) {
    currentStage = `Resident sign-in (${purpose})`;
    residentCookies.set(purpose, await signIn(verifiedTarget.baseUrl, "resident", residents.get(purpose)!));
  }

  currentStage = "multi-month waiver, resident view, history, and audit";
  const mainResident = residents.get("multi-month")!;
  const mainKey = randomUUID();
  const createMain = await postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
    householdId: mainResident.householdId,
    periods: ["2026-03", "2026-01", "2026-02"],
    reason: "Keputusan rapat warga fase sepuluh",
  }, mainKey);
  assert.equal(createMain.status, 200);
  const mainResult = await createMain.json() as { periods: string[]; totalAmount: number; idempotentReplay: boolean };
  assert.deepEqual(mainResult.periods, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(mainResult.totalAmount, 60000);
  assert.equal(mainResult.idempotentReplay, false);
  const residentCookie = residentCookies.get("multi-month")!;
  const residentDues = await getJson<{ dues: Array<{ billingYear: number; month: number; status: string }> }>(
    `${verifiedTarget.baseUrl}/api/resident/monthly-dues`, residentCookie,
  );
  assert.ok(residentDues.dues.every((due) => due.status === "waived"));
  const fakePaymentHistory = await getJson<{ payments: unknown[] }>(
    `${verifiedTarget.baseUrl}/api/resident/payment-history`, residentCookie,
  );
  assert.equal(fakePaymentHistory.payments.length, 0);
  const residentRequestForWaived = await postJson(
    `${verifiedTarget.baseUrl}/api/resident/payment-requests`, residentCookie, verifiedTarget.baseUrl,
    { period: "2026-01" }, randomUUID(),
  );
  assert.equal(residentRequestForWaived.status, 409);
  const chairmanHistory = await getJson<{ history: Array<{ periods: string[]; amount: number; reason: string; statusLabel: string }> }>(
    `${verifiedTarget.baseUrl}/api/chairman/waivers/history`, chairmanCookie,
  );
  assert.ok(chairmanHistory.history.some((item) =>
    item.amount === 60000 && item.reason === "Keputusan rapat warga fase sepuluh" && item.statusLabel === "Dibebaskan" &&
    item.periods.join(",") === "2026-01,2026-02,2026-03",
  ));
  const mainAction = await db.select().from(waiverActions).where(eq(waiverActions.householdId, mainResident.householdId));
  const mainAudit = await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "waiver.created"),
    eq(auditEvents.entityId, mainAction[0]!.id),
  ));
  assert.equal(mainAction.length, 1);
  assert.equal(mainAudit.length, 1);

  currentStage = "pending request blocks waiver";
  const pendingResident = residents.get("pending")!;
  const pendingCookie = residentCookies.get("pending")!;
  const pendingRequestResponse = await postJson(
    `${verifiedTarget.baseUrl}/api/resident/payment-requests`, pendingCookie, verifiedTarget.baseUrl,
    { period: "2026-04" }, randomUUID(),
  );
  assert.equal(pendingRequestResponse.status, 200);
  const pendingRequest = await pendingRequestResponse.json() as { requestCode: string };
  const pendingWaiver = await postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
    householdId: pendingResident.householdId,
    periods: ["2026-04"],
    reason: "Uji claim aktif",
  }, randomUUID());
  assert.equal(pendingWaiver.status, 409);
  const pendingRequestRow = await db.select().from(paymentRequests)
    .where(eq(paymentRequests.requestCode, pendingRequest.requestCode));
  assert.equal(pendingRequestRow[0]?.status, "pending");
  assert.equal(await db.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.requestId, pendingRequestRow[0]!.id)).then((rows) => rows.length), 1);

  currentStage = "request creation versus waiver race";
  const requestRaceResident = residents.get("request-race")!;
  const requestRaceCookie = residentCookies.get("request-race")!;
  const [requestRace, waiverRequestRace] = await Promise.all([
    postJson(`${verifiedTarget.baseUrl}/api/resident/payment-requests`, requestRaceCookie, verifiedTarget.baseUrl,
      { period: "2026-05" }, randomUUID()),
    postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
      householdId: requestRaceResident.householdId,
      periods: ["2026-05"],
      reason: "Uji perlombaan permintaan dan pemutihan",
    }, randomUUID()),
  ]);
  assert.ok([200, 409].includes(requestRace.status));
  assert.ok([200, 409].includes(waiverRequestRace.status));
  assert.notEqual(requestRace.status === 200 && waiverRequestRace.status === 200, true);
  const [requestRaceDue] = await db.select().from(monthlyDues)
    .where(and(eq(monthlyDues.householdId, requestRaceResident.householdId), eq(monthlyDues.month, 5)));
  const requestRaceClaimRows = await db.select().from(paymentRequestClaims)
    .where(eq(paymentRequestClaims.monthlyDueId, requestRaceDue!.id));
  const requestRaceWaiverItems = await db.select().from(waiverItems)
    .where(eq(waiverItems.monthlyDueId, requestRaceDue!.id));
  if (waiverRequestRace.status === 200) {
    assert.equal(requestRaceDue?.status, "waived");
    assert.equal(requestRaceClaimRows.length, 0);
    assert.equal(requestRaceWaiverItems.length, 1);
  } else {
    assert.equal(requestRaceDue?.status, "unpaid");
    assert.equal(requestRaceClaimRows.length, 1);
    assert.equal(requestRaceWaiverItems.length, 0);
  }

  currentStage = "cash payment versus waiver race";
  const cashRaceResident = residents.get("cash-race")!;
  const [cashRace, waiverCashRace] = await Promise.all([
    postJson(`${verifiedTarget.baseUrl}/api/treasurer/cash-payments`, treasurerCookie, verifiedTarget.baseUrl, {
      householdId: cashRaceResident.householdId,
      period: "2026-06",
    }, randomUUID()),
    postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
      householdId: cashRaceResident.householdId,
      periods: ["2026-06"],
      reason: "Uji perlombaan pembayaran dan pemutihan",
    }, randomUUID()),
  ]);
  assert.ok([200, 409].includes(cashRace.status));
  assert.ok([200, 409].includes(waiverCashRace.status));
  assert.notEqual(cashRace.status === 200 && waiverCashRace.status === 200, true);
  const [cashRaceDue] = await db.select().from(monthlyDues)
    .where(and(eq(monthlyDues.householdId, cashRaceResident.householdId), eq(monthlyDues.month, 6)));
  const cashRaceOwners = await db.select().from(activeDueSettlements)
    .where(eq(activeDueSettlements.monthlyDueId, cashRaceDue!.id));
  const cashRaceItems = await db.select().from(waiverItems)
    .where(eq(waiverItems.monthlyDueId, cashRaceDue!.id));
  if (waiverCashRace.status === 200) {
    assert.equal(cashRaceDue?.status, "waived");
    assert.equal(cashRaceOwners.length, 0);
    assert.equal(cashRaceItems.length, 1);
  } else {
    assert.equal(cashRaceDue?.status, "paid");
    assert.equal(cashRaceOwners.length, 1);
    assert.equal(cashRaceItems.length, 0);
  }

  currentStage = "reversed transfer payment followed by waiver";
  const transferResident = residents.get("transfer-reversal")!;
  const transferCookie = residentCookies.get("transfer-reversal")!;
  const transferRequestResponse = await postJson(
    `${verifiedTarget.baseUrl}/api/resident/payment-requests`, transferCookie, verifiedTarget.baseUrl,
    { period: "2026-07" }, randomUUID(),
  );
  assert.equal(transferRequestResponse.status, 200);
  const transferRequest = await transferRequestResponse.json() as { requestCode: string };
  const transferVerify = await postJson(
    `${verifiedTarget.baseUrl}/api/treasurer/payment-requests/${transferRequest.requestCode}/verify`, treasurerCookie,
    verifiedTarget.baseUrl, {},
  );
  assert.equal(transferVerify.status, 200);
  const [transferPayment] = await db.select().from(payments)
    .where(eq(payments.householdId, transferResident.householdId));
  const transferAllocationsBefore = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, transferPayment!.id));
  const transferReverse = await postJson(
    `${verifiedTarget.baseUrl}/api/treasurer/payments/${transferPayment!.id}/reverse`, treasurerCookie,
    verifiedTarget.baseUrl, { reason: "Koreksi transfer sebelum pemutihan" },
  );
  assert.equal(transferReverse.status, 200);
  const transferWaiver = await postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
    householdId: transferResident.householdId,
    periods: ["2026-07"],
    reason: "Tagihan lama diputuskan untuk dibebaskan",
  }, randomUUID());
  assert.equal(transferWaiver.status, 200);
  assert.equal(await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, transferPayment!.id)).then((rows) => rows.length), 1);
  assert.deepEqual(await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, transferPayment!.id)), transferAllocationsBefore);

  currentStage = "reversed cash payment followed by waiver";
  const cashReversalResident = residents.get("cash-reversal")!;
  const cashReverseRecord = await postJson(`${verifiedTarget.baseUrl}/api/treasurer/cash-payments`, treasurerCookie, verifiedTarget.baseUrl, {
    householdId: cashReversalResident.householdId,
    period: "2026-08",
  }, randomUUID());
  assert.equal(cashReverseRecord.status, 200);
  const [cashPayment] = await db.select().from(payments)
    .where(eq(payments.householdId, cashReversalResident.householdId));
  const cashAllocationsBefore = await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, cashPayment!.id));
  const cashReverse = await postJson(
    `${verifiedTarget.baseUrl}/api/treasurer/payments/${cashPayment!.id}/reverse`, treasurerCookie,
    verifiedTarget.baseUrl, { reason: "Koreksi tunai sebelum pemutihan" },
  );
  assert.equal(cashReverse.status, 200);
  const cashWaiver = await postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
    householdId: cashReversalResident.householdId,
    periods: ["2026-08"],
    reason: "Tagihan lama diputuskan untuk dibebaskan",
  }, randomUUID());
  assert.equal(cashWaiver.status, 200);
  assert.equal(await db.select().from(paymentReversals)
    .where(eq(paymentReversals.paymentId, cashPayment!.id)).then((rows) => rows.length), 1);
  assert.deepEqual(await db.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, cashPayment!.id)), cashAllocationsBefore);

  currentStage = "verification against waiver with a pending claim";
  const verifyResident = residents.get("verify-race")!;
  const verifyCookie = residentCookies.get("verify-race")!;
  const verifyRequestResponse = await postJson(
    `${verifiedTarget.baseUrl}/api/resident/payment-requests`, verifyCookie, verifiedTarget.baseUrl,
    { period: "2026-09" }, randomUUID(),
  );
  assert.equal(verifyRequestResponse.status, 200);
  const verifyRequest = await verifyRequestResponse.json() as { requestCode: string };
  const [verifyRacePayment, verifyRaceWaiver] = await Promise.all([
    postJson(`${verifiedTarget.baseUrl}/api/treasurer/payment-requests/${verifyRequest.requestCode}/verify`, treasurerCookie,
      verifiedTarget.baseUrl, {}),
    postJson(`${verifiedTarget.baseUrl}/api/chairman/waivers`, chairmanCookie, verifiedTarget.baseUrl, {
      householdId: verifyResident.householdId,
      periods: ["2026-09"],
      reason: "Uji konfirmasi transfer dan pemutihan",
    }, randomUUID()),
  ]);
  assert.equal(verifyRacePayment.status, 200);
  assert.equal(verifyRaceWaiver.status, 409);

  currentStage = "responsive Chairman and Resident browser smoke";
  const browserUiResident = residents.get("browser-ui")!;
  const browserEvidence = await testBrowserFlow(
    verifiedTarget.baseUrl,
    chairmanCookie,
    residentCookies.get("multi-month")!,
    {
      main: mainResident.houseNumber,
      pending: pendingResident.houseNumber,
      paid: verifyResident.houseNumber,
      notDue: notDueResident.houseNumber,
      eligible: browserUiResident.houseNumber,
    },
  );

  currentStage = "global waiver ledger and ownership invariant queries";
  const anomalies = await runGlobalInvariantChecks();
  const syntheticWaivers = await db.select().from(waiverActions).where(eq(waiverActions.rtUnitId, rtUnitId));
  const syntheticItems = await db.select().from(waiverItems).where(eq(waiverItems.rtUnitId, rtUnitId));
  const syntheticAudits = await db.select().from(auditEvents).where(and(
    eq(auditEvents.action, "waiver.created"),
    inArray(auditEvents.entityId, syntheticWaivers.map((item) => item.id)),
  ));
  assert.equal(syntheticWaivers.length, syntheticAudits.length);
  for (const action of syntheticWaivers) {
    const actionItems = syntheticItems.filter((item) => item.waiverActionId === action.id);
    assert.equal(actionItems.length, action.itemCount);
    assert.equal(actionItems.reduce((total, item) => total + item.amount, 0), action.totalAmount);
    assert.equal(syntheticAudits.filter((audit) => audit.entityId === action.id).length, 1);
  }

  console.info(JSON.stringify({
    event: "phase10.waiver.development-smoke.pass",
    target: { project: target.projectId, branch: target.branchId, database: target.databaseName, directEndpointVerified: verifiedTarget.databaseHost.startsWith(target.endpointId) },
    migration: { id: "0011_phase_10_waiver", hash: migrationHash },
    multiMonth: { periods: mainResult.periods, totalAmount: mainResult.totalAmount, residentStatuses: residentDues.dues.map((due) => due.status), historyRecords: chairmanHistory.history.length },
    pendingBlock: pendingWaiver.status,
    requestRace: { request: requestRace.status, waiver: waiverRequestRace.status, finalDue: requestRaceDue!.status, claims: requestRaceClaimRows.length },
    cashRace: { payment: cashRace.status, waiver: waiverCashRace.status, finalDue: cashRaceDue!.status, owners: cashRaceOwners.length },
    reversedHistory: { transferReversalRows: 1, transferAllocations: transferAllocationsBefore.length, cashReversalRows: 1, cashAllocations: cashAllocationsBefore.length },
    verifyRace: { verification: verifyRacePayment.status, waiver: verifyRaceWaiver.status },
    browser: browserEvidence,
    invariantAnomalies: anomalies,
    syntheticFixtures: "Financial and identity fixtures intentionally remain only on karturt-development; smoke login sessions are removed.",
  }));
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child) return true;
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill();
  await Promise.race([once(child, "exit"), delay(5000)]);
  return child.exitCode !== null || child.signalCode !== null;
}

main()
  .catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnexpectedError";
    const errorRecord = error !== null && typeof error === "object"
      ? error as { cause?: unknown; code?: unknown; constraint?: unknown }
      : undefined;
    const causeRecord = errorRecord?.cause !== null && typeof errorRecord?.cause === "object"
      ? errorRecord.cause as { code?: unknown; constraint?: unknown }
      : undefined;
    const databaseCode = [errorRecord?.code, causeRecord?.code].find((value) => typeof value === "string");
    const databaseConstraint = [errorRecord?.constraint, causeRecord?.constraint].find((value) => typeof value === "string");
    const detail = (currentStage === "start local application server" || currentStage.includes("sign-in") || currentStage.includes("browser smoke")) && error instanceof Error
      ? error.message
      : currentStage === "create synthetic development fixtures" && databaseCode
        ? `Database rejected a synthetic fixture (${databaseCode}${databaseConstraint ? `, ${databaseConstraint}` : ""}).`
        : errorName;
    console.error(`Phase 10 development smoke failed during ${currentStage}: ${detail}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    devtoolsSocket?.close();
    const browserStopped = await stopChild(browserProcess);
    await stopChild(nextProcess);
    if (userIds.length) {
      try {
        await getDb().delete(authSession).where(inArray(authSession.userId, userIds));
      } catch {
        // Synthetic domain data is retained; remove only normal-login smoke sessions.
      }
    }
    await closeDb();
    if (browserProfile && browserStopped) {
      const tempRoot = resolve(tmpdir());
      const resolvedProfile = resolve(browserProfile);
      if (resolvedProfile.startsWith(`${tempRoot}${sep}`) && resolvedProfile.includes("karturt-phase-10-chrome-")) {
        rmSync(resolvedProfile, { recursive: true, force: true });
      }
    }
  });
