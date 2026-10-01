import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";

const root = process.cwd();
const evidenceDirectory = resolve(root, "docs", "phase-5-1-evidence");
const screenshotRunId = new Date().toISOString().replace(/[:.]/g, "-");
const savedScreenshots: string[] = [];
const cssDirectory = join(root, ".next", "static", "chunks");
const cssFiles = readdirSync(cssDirectory).filter((file) => file.endsWith(".css"));
if (cssFiles.length === 0) throw new Error("Build CSS was not found. Run npm run build first.");
const css = cssFiles.map((file) => readFileSync(join(cssDirectory, file), "utf8")).join("\n")
  .replace(/<\/style/gi, "<\\/style");
const browserCandidates = [
  process.env.CHROME_PATH,
  process.env.ProgramFiles
    ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
    : undefined,
  process.env["ProgramFiles(x86)"]
    ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
    : undefined,
  process.env.ProgramFiles
    ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    : undefined,
].filter((candidate): candidate is string => Boolean(candidate));
const browser = browserCandidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error("Chrome or Edge was not found. Set CHROME_PATH to its executable.");
let server: ReturnType<typeof createServer> | undefined;
let pageUrl = "";

type FixtureDue = {
  billingYear: number;
  month: number;
  amount: number;
  dueDate: string;
  status: "paid" | "unpaid" | "waived" | "not_due";
  paymentRequestStatus: "pending" | null;
};

const dues: FixtureDue[] = [
  { billingYear: 2025, month: 12, amount: 30000, dueDate: "2025-12-10", status: "unpaid", paymentRequestStatus: null },
  { billingYear: 2026, month: 1, amount: 40000, dueDate: "2026-01-10", status: "paid", paymentRequestStatus: null },
  { billingYear: 2026, month: 2, amount: 30000, dueDate: "2026-02-10", status: "unpaid", paymentRequestStatus: "pending" },
  { billingYear: 2026, month: 3, amount: 40000, dueDate: "2026-03-10", status: "unpaid", paymentRequestStatus: null },
  { billingYear: 2026, month: 4, amount: 40000, dueDate: "2026-04-10", status: "unpaid", paymentRequestStatus: null },
  { billingYear: 2026, month: 5, amount: 40000, dueDate: "2026-05-10", status: "waived", paymentRequestStatus: null },
  { billingYear: 2026, month: 6, amount: 0, dueDate: "2026-06-10", status: "not_due", paymentRequestStatus: null },
];
const originalPending = new Set(["2026-02"]);
const claimedPeriods = new Set(originalPending);
const idempotentResponses = new Map<string, Record<string, unknown>>();
let postCount = 0;
let lastPayload: unknown = null;
let lastIdempotencyKey = "";

function currentDues() {
  return dues.map((due) => {
    const period = `${due.billingYear}-${String(due.month).padStart(2, "0")}`;
    return {
      ...due,
      paymentRequestStatus: claimedPeriods.has(period) ? "pending" : null,
    };
  });
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function createMockServer(bundlePath: string) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment request browser smoke</title><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
      return;
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      response.end(readFileSync(bundlePath));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/resident/monthly-dues") {
      json(response, 200, { dues: currentDues() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resident/payment-requests") {
      postCount += 1;
      lastIdempotencyKey = String(request.headers["idempotency-key"] ?? "");
      try {
        lastPayload = JSON.parse(await readBody(request));
      } catch {
        json(response, 400, { message: "Invalid fixture request." });
        return;
      }
      const payload = lastPayload as { period?: string };
      if (!payload || Object.keys(payload).length !== 1 || typeof payload.period !== "string") {
        json(response, 400, { message: "Only the public billing period is accepted." });
        return;
      }
      const replay = idempotentResponses.get(lastIdempotencyKey);
      if (replay) {
        json(response, 200, replay);
        return;
      }
      const periods = dues
        .filter((due) => due.status === "unpaid")
        .map((due) => ({ period: `${due.billingYear}-${String(due.month).padStart(2, "0")}`, amount: due.amount }))
        .filter((due) => due.period <= payload.period! && !claimedPeriods.has(due.period));
      if (!periods.some((due) => due.period === payload.period)) {
        json(response, 409, { message: "Bulan iuran berubah. Muat ulang halaman lalu periksa kembali." });
        return;
      }
      const requestCode = "KRT-SMOKE-5A7B9C";
      const totalAmount = periods.reduce((total, due) => total + due.amount, 0);
      const whatsappText = [
        "Halo Bendahara, saya mengajukan pembayaran iuran.",
        "Nama: Warga Uji",
        "Nomor rumah: SMOKE-1",
        "Bulan: Desember 2025, Maret 2026, April 2026",
        "Jumlah: Rp 110.000",
        "Waktu pengajuan: 1 Oktober 2026 pukul 10.00 WIB",
        `Nomor pengajuan: ${requestCode}`,
      ].join("\n");
      const result = {
        requestCode,
        status: "pending",
        periods: periods.map((due) => due.period),
        totalAmount,
        createdAt: "2026-10-01T03:00:00.000Z",
        whatsappUrl: `https://wa.me/628123456789?text=${encodeURIComponent(whatsappText)}`,
        contactMessage: null,
        message: "Permintaan tercatat dengan status Menunggu konfirmasi.",
      };
      for (const due of periods) claimedPeriods.add(due.period);
      idempotentResponses.set(lastIdempotencyKey, result);
      json(response, 200, result);
      return;
    }
    if (request.method === "GET" && url.pathname === "/__metrics") {
      json(response, 200, { postCount, lastPayload, lastIdempotencyKey });
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

const outputRoot = resolve(tmpdir());
const tempDirectory = mkdtempSync(join(outputRoot, "karturt-phase-5-browser-"));
const resolvedTempDirectory = resolve(tempDirectory);
if (
  !resolvedTempDirectory.startsWith(`${outputRoot}${sep}`) ||
  !basename(resolvedTempDirectory).startsWith("karturt-phase-5-browser-")
) {
  throw new Error("Browser smoke temporary path escaped the operating-system temp directory.");
}
const bundlePath = join(tempDirectory, "app.js");
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 900 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

async function runBrowserSmoke() {
  const profilePath = mkdtempSync(join(tmpdir(), "karturt-phase-5-chrome-"));
  const resolvedProfilePath = resolve(profilePath);
  if (!resolvedProfilePath.startsWith(`${outputRoot}${sep}`)) throw new Error("Chrome profile escaped the temp directory.");
  const chromeProcess = spawn(browser!, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${resolvedProfilePath}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  let socket: WebSocket | undefined;
  let commandId = 0;
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const activePortPath = join(resolvedProfilePath, "DevToolsActivePort");

  try {
    for (let attempt = 0; attempt < 80 && !existsSync(activePortPath); attempt += 1) {
      if (chromeProcess.exitCode !== null) throw new Error("Chrome exited before the debug port opened.");
      await delay(100);
    }
    if (!existsSync(activePortPath)) throw new Error("Chrome debug port did not open.");
    const port = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const target = targets.find((item) => item.type === "page");
    if (!target) throw new Error("Chrome did not provide a page target.");

    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; error?: unknown };
      if (message.id === undefined) return;
      const resolveMessage = pending.get(message.id);
      if (!resolveMessage) return;
      pending.delete(message.id);
      resolveMessage(message as Record<string, unknown>);
    });
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => rejectOpen(new Error("Chrome DevTools connection failed.")), { once: true });
    });

    const command = (method: string, params: Record<string, unknown> = {}) => {
      const id = ++commandId;
      const promise = new Promise<Record<string, unknown>>((resolveMessage, rejectMessage) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectMessage(new Error(`Chrome DevTools command timed out: ${method}`));
        }, 10000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          if (message.error) rejectMessage(new Error(`Chrome DevTools command failed: ${method}`));
          else resolveMessage(message);
        });
      });
      socket!.send(JSON.stringify({ id, method, params }));
      return promise;
    };
    const evaluate = async (expression: string) => {
      const response = await command("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const result = (response.result as { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } })?.result;
      const value = result?.value;
      if (value === undefined && response.result && (response.result as { exceptionDetails?: unknown }).exceptionDetails) {
        throw new Error(`Browser evaluation failed: ${(response.result as { exceptionDetails?: { text?: string } }).exceptionDetails?.text}`);
      }
      return value;
    };
    const waitFor = async (expression: string, message: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(expression)) return;
        await delay(100);
      }
      throw new Error(message);
    };
    const captureEvidence = async (name: string) => {
      const response = await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      });
      const data = (response.result as { data?: unknown } | undefined)?.data;
      assert.equal(typeof data, "string", "Chrome did not return screenshot evidence.");
      mkdirSync(evidenceDirectory, { recursive: true });
      const filename = `${screenshotRunId}-${name}.png`;
      writeFileSync(join(evidenceDirectory, filename), Buffer.from(data as string, "base64"), { flag: "wx" });
      savedScreenshots.push(join("docs", "phase-5-1-evidence", filename));
    };

    await command("Page.enable");
    await command("Runtime.enable");
    await command("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await command("Page.navigate", { url: pageUrl });
    await waitFor("document.querySelector('.payment-request-select') !== null", "Payment request UI did not render.");

    const initialSummary = await evaluate(`(() => [...document.querySelectorAll('.resident-summary div')].map(item => [
      item.querySelector('span').textContent,
      item.querySelector('strong').textContent,
    ]))()`);
    assert.deepEqual(initialSummary, [
      ["Belum bayar", "Rp 110.000"],
      ["Menunggu konfirmasi", "Rp 30.000"],
      ["Sudah bayar", "Rp 40.000"],
    ]);
    await captureEvidence("mobile-summary-390x844");

    const selection = await evaluate(`(() => {
      const select = document.querySelector('.payment-request-select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, '2026-04');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: select.value, months: document.querySelector('.payment-request-total span')?.textContent, total: document.querySelector('.payment-request-total strong')?.textContent };
    })()`);
    assert.deepEqual(selection, { value: "2026-04", months: "3 bulan masuk dalam permintaan", total: "Rp 110.000" });
    const selectionTargets = await evaluate(`([...document.querySelectorAll('.resident-nav button, .payment-request-select, .payment-request-action')].map(item => Math.round(item.getBoundingClientRect().height)))`);
    assert.ok((selectionTargets as number[]).every((height) => height >= 44), "Month selection or review touch target is below 44px.");
    await evaluate("document.querySelector('.payment-request-action').click()");
    await waitFor("[...document.querySelectorAll('button')].some(button => button.textContent.includes('Konfirmasi dan ajukan'))", "Confirmation step did not appear.");
    const confirmation = await evaluate(`(() => ({
      periods: [...document.querySelectorAll('.payment-request-periods li')].map(item => item.textContent),
      buttonHeight: Math.round([...document.querySelectorAll('button')].find(item => item.textContent.includes('Konfirmasi dan ajukan')).getBoundingClientRect().height),
    }))()`);
    assert.deepEqual((confirmation as { periods: string[] }).periods, ["Desember 2025", "Maret 2026", "April 2026"]);
    assert.ok((confirmation as { buttonHeight: number }).buttonHeight >= 44, "Confirmation touch target is below 44px.");
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('Konfirmasi dan ajukan')); button.click(); button.click(); })()`);
    await waitFor("document.body.innerText.includes('KRT-SMOKE-5A7B9C')", "Payment request did not reach the success state.");
    const result = await evaluate(`(() => ({
      requestCode: document.body.innerText.includes('KRT-SMOKE-5A7B9C'),
      pendingText: document.body.innerText.includes('Menunggu konfirmasi'),
      pendingIcon: Boolean(document.querySelector('.due-status.status-pending svg')),
      whatsappHref: document.querySelector('.payment-request-success a')?.getAttribute('href') ?? null,
    }))()`);
    const metrics = await evaluate("fetch('/__metrics').then(response => response.json())") as {
      postCount: number;
      lastPayload: unknown;
      lastIdempotencyKey: string;
    };
    assert.equal((result as { requestCode: boolean }).requestCode, true);
    assert.equal((result as { pendingText: boolean }).pendingText, true);
    assert.equal((result as { pendingIcon: boolean }).pendingIcon, true);
    assert.match(String((result as { whatsappHref: string }).whatsappHref), /^https:\/\/wa\.me\/628123456789\?text=/);
    assert.equal(metrics.postCount, 1, "Double-click issued more than one POST.");
    assert.deepEqual(metrics.lastPayload, { period: "2026-04" }, "The browser sent internal identifiers or extra fields.");
    assert.match(metrics.lastIdempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    await command("Page.reload", { ignoreCache: true });
    await waitFor("document.body.innerText.includes('Belum ada bulan dengan status') || document.body.innerText.includes('sedang menunggu konfirmasi')", "Read model did not reload after refresh.");
    const persisted = await evaluate(`(() => ({
      pendingCount: document.querySelectorAll('.due-card .status-pending').length,
      pendingText: [...document.querySelectorAll('.due-card .status-pending span')].map(item => item.textContent),
      summary: [...document.querySelectorAll('.resident-summary div')].map(item => [
        item.querySelector('span').textContent,
        item.querySelector('strong').textContent,
      ]),
      hasRequestCode: document.body.innerText.includes('KRT-SMOKE-5A7B9C'),
    }))()`);
    assert.equal((persisted as { pendingCount: number }).pendingCount, 3, "Pending month status did not persist after refresh.");
    assert.deepEqual((persisted as { pendingText: string[] }).pendingText, ["Menunggu konfirmasi", "Menunggu konfirmasi", "Menunggu konfirmasi"]);
    assert.deepEqual((persisted as { summary: string[][] }).summary, [
      ["Belum bayar", "Rp 0"],
      ["Menunggu konfirmasi", "Rp 140.000"],
      ["Sudah bayar", "Rp 40.000"],
    ]);

    for (const viewport of viewports) {
      await command("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 600,
      });
      await delay(60);
      const view = await evaluate(`(() => {
        const status = document.querySelector('.due-card .status-pending');
        const select = document.querySelector('.payment-request-select');
        const nav = [...document.querySelectorAll('.resident-nav button')];
        const primary = [...document.querySelectorAll('.button')];
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          statusFontSize: parseFloat(getComputedStyle(status).fontSize),
          statusColor: getComputedStyle(status).color,
          statusBorder: getComputedStyle(status.closest('.due-card')).borderTopColor,
          statusIcon: Boolean(status.querySelector('svg')),
          summaryColumns: getComputedStyle(document.querySelector('.resident-summary')).gridTemplateColumns.split(' ').length,
          summary: [...document.querySelectorAll('.resident-summary div')].map(item => [
            item.querySelector('span').textContent,
            item.querySelector('strong').textContent,
          ]),
          touchTargets: [...nav, select, ...primary].filter(item => item && item.offsetParent !== null).map(item => Math.round(item.getBoundingClientRect().height)),
          text: document.body.innerText,
        };
      })()`);
      const measured = view as {
        width: number;
        height: number;
        documentWidth: number;
        statusFontSize: number;
        statusColor: string;
        statusBorder: string;
        statusIcon: boolean;
        summaryColumns: number;
        summary: string[][];
        touchTargets: number[];
        text: string;
      };
      assert.equal(measured.width, viewport.width);
      assert.equal(measured.height, viewport.height);
      assert.ok(measured.documentWidth <= viewport.width, `Horizontal overflow at ${viewport.width}px.`);
      assert.equal(measured.summaryColumns, viewport.width < 600 ? 2 : 3, `Unexpected summary column count at ${viewport.width}px.`);
      assert.ok(measured.statusFontSize >= 16, `Status text is too small at ${viewport.width}px.`);
      assert.ok(measured.statusIcon, `Pending status icon is missing at ${viewport.width}px.`);
      assert.ok(measured.touchTargets.every((height) => height >= 44), `Touch target below 44px at ${viewport.width}px.`);
      assert.match(measured.statusColor, /rgb\(115, 87, 0\)|rgb\(242, 215, 120\)/);
      assert.equal(measured.statusBorder, "rgb(208, 165, 29)");
      assert.doesNotMatch(measured.text, /tanggal 10|jatuh tempo|2026-\d{2}-10|\b(PAID|UNPAID|WAIVED|NOT_DUE|PENDING)\b|payment_request/i);
      assert.doesNotMatch(measured.text, /Tunggakan|Total belum dibayar|Total sudah dibayar/i);
      assert.deepEqual(measured.summary.map(([label]) => label), ["Belum bayar", "Menunggu konfirmasi", "Sudah bayar"]);
      assert.equal(measured.summary[0]?.[1], "Rp 0", "Pending amount leaked into Belum bayar.");
      assert.equal(measured.summary[1]?.[1], "Rp 140.000");
      assert.match(measured.text, /Menunggu konfirmasi/);
      if (viewport.width === 1440) await captureEvidence("desktop-pending-1440x900");
      console.info(`${viewport.width}x${viewport.height}: PASS, no overflow, 44px+ touch targets, icon+text pending status, no due date or technical token.`);
    }
    const waLink = (result as { whatsappHref: string }).whatsappHref;
    const message = new URL(waLink).searchParams.get("text") ?? "";
    assert.match(message, /SMOKE-1/);
    assert.match(message, /KRT-SMOKE-5A7B9C/);
    assert.match(message, /Desember 2025, Maret 2026, April 2026/);
    assert.match(message.replace(/\s/g, ""), /Rp110\.000/);
    console.info("Older unpaid selection, confirmation total, double-click guard, public period payload, WhatsApp details, and refresh persistence: PASS.");
    console.info(`Non-sensitive browser screenshots saved: ${savedScreenshots.join(", ")}`);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ id: ++commandId, method: "Browser.close" })); } catch {}
      socket.close();
    }
    if (chromeProcess.exitCode === null) {
      const exited = once(chromeProcess, "exit").catch(() => []);
      chromeProcess.kill();
      await Promise.race([exited, delay(1000)]);
    }
    rmSync(resolvedProfilePath, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await build({
      entryPoints: [join(root, "scripts", "phase-5-payment-request-browser-entry.tsx")],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome120"],
      jsx: "automatic",
      outfile: bundlePath,
      logLevel: "silent",
    });
    server = createMockServer(bundlePath);
    await new Promise<void>((resolveListen, rejectListen) => {
      server!.once("error", rejectListen);
      server!.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Browser smoke server did not receive a TCP port.");
    pageUrl = `http://127.0.0.1:${address.port}/`;
    await runBrowserSmoke();
  } finally {
    if (server?.listening) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    }
    rmSync(resolvedTempDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
