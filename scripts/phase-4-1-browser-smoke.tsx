import { spawn } from "node:child_process";
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
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResidentDuesSummary,
  ResidentMonthCard,
} from "../src/components/resident-card";
import {
  duesSummary,
  yearMonths,
  type ResidentDue,
} from "../src/lib/billing/resident-card";

const root = process.cwd();
const outputDirectory = resolve(
  root,
  process.env.KARTURT_SMOKE_OUTPUT ?? "docs/phase-4-1-cleanup-evidence",
);
const cssDirectory = join(root, ".next", "static", "chunks");
const cssFiles = readdirSync(cssDirectory).filter((file) => file.endsWith(".css"));
if (cssFiles.length === 0) throw new Error("Build CSS was not found. Run npm run build first.");

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
if (!browser) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to its executable.");
}

const due = (status: ResidentDue["status"], month: number): ResidentDue => ({
  billingYear: 2026,
  month,
  amount: status === "not_due" ? 0 : 40000,
  dueDate: `2026-${String(month).padStart(2, "0")}-10`,
  status,
});
const dues = [
  due("paid", 1),
  due("unpaid", 2),
  due("waived", 3),
  due("not_due", 4),
  due("unpaid", 5),
  due("paid", 6),
  due("unpaid", 7),
  due("unpaid", 8),
  due("unpaid", 9),
  due("unpaid", 10),
  due("unpaid", 11),
  due("unpaid", 12),
];
const summary = duesSummary(dues);
const monthCards = yearMonths(dues, 2026).map(({ name, due: monthDue, month }) =>
  createElement(ResidentMonthCard, { key: month, name, due: monthDue }),
);
const content = renderToStaticMarkup(
  createElement(
    "main",
    { className: "page-shell" },
    createElement(
      "section",
      { className: "resident-area" },
      createElement("p", { className: "eyebrow" }, "RUANG WARGA"),
      createElement("h1", null, "Kartu Iuran"),
      createElement(
        "nav",
        { className: "resident-nav", "aria-label": "Navigasi warga" },
        createElement("button", { type: "button", "aria-current": "page" }, "Kartu Iuran"),
        createElement("button", { type: "button" }, "Riwayat"),
        createElement("button", { type: "button" }, "Profil"),
      ),
      createElement("label", { className: "resident-year" }, "Tahun ",
        createElement("select", { defaultValue: "2026" },
          createElement("option", { value: "2026" }, "2026"),
        ),
      ),
      createElement(ResidentDuesSummary, { summary }),
      createElement("ol", { className: "dues-grid" }, ...monthCards),
    ),
  ),
);
const css = cssFiles
  .map((file) => readFileSync(join(cssDirectory, file), "utf8"))
  .join("\n")
  .replace(/<\/style/gi, "<\\/style");
const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kartu Iuran - smoke visual</title>
<style>${css}</style>
</head>
<body>
${content}
<pre id="smoke-metrics" hidden></pre>
<script>
window.addEventListener("load", () => requestAnimationFrame(() => {
  const grid = document.querySelector(".dues-grid");
  const status = document.querySelector(".due-status");
  const navButton = document.querySelector(".resident-nav button");
  navButton.focus({ focusVisible: true });
  const metrics = {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
    statusFontSize: getComputedStyle(status).fontSize,
    navButtonHeight: navButton.getBoundingClientRect().height,
    focusOutlineWidth: getComputedStyle(navButton).outlineWidth,
    navButtonCount: document.querySelectorAll(".resident-nav button").length,
    text: document.body.innerText
  };
  document.documentElement.dataset.smokeReady = "true";
  document.getElementById("smoke-metrics").textContent = JSON.stringify(metrics);
}));
</script>
</body>
</html>`;

mkdirSync(outputDirectory, { recursive: true });
const htmlPath = join(tmpdir(), `karturt-resident-card-smoke-${process.pid}.html`);
writeFileSync(htmlPath, html, "utf8");
const pageUrl = pathToFileURL(htmlPath).href;
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

async function captureBrowserView(
  viewport: { width: number; height: number },
  screenshotPath: string,
) {
  const profilePath = mkdtempSync(join(tmpdir(), "karturt-phase-4-1-browser-"));
  const resolvedProfilePath = resolve(profilePath);
  const resolvedTempRoot = resolve(tmpdir());
  if (
    !resolvedProfilePath.startsWith(`${resolvedTempRoot}${sep}`) ||
    !basename(resolvedProfilePath).startsWith("karturt-phase-4-1-browser-")
  ) {
    throw new Error("Browser profile path escaped the temporary directory.");
  }

  const chromeProcess = spawn(
    browser!,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      `--user-data-dir=${resolvedProfilePath}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let socket: WebSocket | undefined;
  let commandId = 0;
  const pending = new Map<number, (message: Record<string, unknown>) => void>();

  try {
    const activePortPath = join(resolvedProfilePath, "DevToolsActivePort");
    for (let attempt = 0; attempt < 50 && !existsSync(activePortPath); attempt += 1) {
      if (chromeProcess.exitCode !== null) {
        throw new Error("Chrome exited before the debug port opened.");
      }
      await delay(100);
    }
    if (!existsSync(activePortPath)) throw new Error("Chrome debug port did not open.");

    const port = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const target = targets.find((item) => item.type === "page");
    if (!target) throw new Error("Chrome did not provide a page target.");

    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        error?: unknown;
        result?: unknown;
      };
      if (message.id !== undefined) {
        const resolveMessage = pending.get(message.id);
        if (resolveMessage) {
          pending.delete(message.id);
          resolveMessage(message as Record<string, unknown>);
        }
      }
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

    await command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Page.navigate", { url: pageUrl });

    let metricsJson: string | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await command("Runtime.evaluate", {
        expression:
          "document.documentElement.dataset.smokeReady === 'true' ? document.getElementById('smoke-metrics').textContent : null",
        returnByValue: true,
      });
      metricsJson = (response.result as { result?: { value?: string | null } })?.result?.value ?? null;
      if (metricsJson) break;
      await delay(100);
    }
    if (!metricsJson) throw new Error("Browser metrics were not produced.");

    const screenshot = await command("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const screenshotData = (screenshot.result as { data?: string })?.data;
    if (!screenshotData) throw new Error("Chrome did not return a screenshot.");
    writeFileSync(screenshotPath, Buffer.from(screenshotData, "base64"));
    return JSON.parse(metricsJson) as {
      viewportWidth: number;
      viewportHeight: number;
      documentWidth: number;
      columns: number;
      statusFontSize: string;
      navButtonHeight: number;
      focusOutlineWidth: string;
      navButtonCount: number;
      text: string;
    };
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ id: ++commandId, method: "Browser.close" }));
      } catch {}
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
  for (const viewport of viewports) {
    const suffix = `${viewport.width}x${viewport.height}`;
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const baseScreenshotPath = join(outputDirectory, `resident-card-${suffix}.png`);
    const screenshotPath = existsSync(baseScreenshotPath)
      ? join(outputDirectory, `resident-card-${suffix}-${runId}.png`)
      : baseScreenshotPath;
    const metrics = await captureBrowserView(viewport, screenshotPath);
    const expectedColumns = viewport.width >= 600 ? 3 : 2;
    const visibleText = metrics.text;
    const technicalCopy = /\b(PAID|UNPAID|WAIVED|NOT_DUE|PENDING|paid|unpaid|due|pending)\b/i;
    if (metrics.viewportWidth !== viewport.width || metrics.viewportHeight !== viewport.height) {
      throw new Error(`Browser viewport mismatch at ${suffix}: ${JSON.stringify(metrics)}`);
    }
    if (metrics.documentWidth > metrics.viewportWidth) {
      throw new Error(`Horizontal overflow at ${suffix}: ${JSON.stringify(metrics)}`);
    }
    if (metrics.columns !== expectedColumns) {
      throw new Error(`Unexpected month grid at ${suffix}: ${JSON.stringify(metrics)}`);
    }
    if (Number.parseFloat(metrics.statusFontSize) < 16) {
      throw new Error(`Status text is too small at ${suffix}: ${metrics.statusFontSize}`);
    }
    if (metrics.navButtonHeight < 44 || metrics.navButtonCount !== 3) {
      throw new Error(`Resident navigation touch targets are too small at ${suffix}.`);
    }
    if (Number.parseFloat(metrics.focusOutlineWidth) < 3) {
      throw new Error(`Keyboard focus outline is not visible at ${suffix}.`);
    }
    const expectedLabels = [
      "Sudah bayar",
      "Belum bayar",
      "Dibebaskan",
      "Tidak perlu bayar",
    ];
    if (!expectedLabels.every((label) => visibleText.includes(label))) {
      throw new Error(`Resident labels are missing at ${suffix}.`);
    }
    if (technicalCopy.test(visibleText) || /tanggal 10|jatuh tempo|2026-\d{2}-10/i.test(visibleText)) {
      throw new Error(`Technical status or due-date copy is visible at ${suffix}.`);
    }
    if (/Menunggu konfirmasi/i.test(visibleText)) {
      throw new Error(`Future PENDING visual status appeared in current fixture at ${suffix}.`);
    }
    console.log(
      `${suffix}: PASS, ${metrics.columns} columns, status ${metrics.statusFontSize}, no overflow; ${screenshotPath}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
