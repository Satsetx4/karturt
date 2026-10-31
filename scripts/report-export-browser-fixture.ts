import { buildSync } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aggregateRtFinancialReport, type ReportDueInput } from "../src/lib/reports/aggregation";

const bundle = buildSync({ entryPoints: ["scripts/report-export-browser-entry.tsx"], bundle: true, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", write: false });
const chunks = ".next/static/chunks";
const css = readdirSync(chunks).filter((path) => path.endsWith(".css")).map((path) => readFileSync(join(chunks, path), "utf8")).join("\n");
function report(year: number) {
  const due = (month: number): ReportDueInput => ({ monthlyDueId: `${year}-${month}`, household: { householdId: `synthetic-${year}`, rtUnitId: "synthetic-rt", houseNumber: `S-${year}`,
    houseLabel: null, residentNames: ["Warga sintetis"], lifecycle: "active", startsOn: `${year}-01-01`, endsOn: null },
    year, month, dueDate: `${year}-${String(month).padStart(2, "0")}-10`, status: "unpaid", originalAmount: 40000, adjustmentTotal: 0, activeReceived: 0,
    importedOpeningBalance: 0, transferReceived: 0, cashReceived: 0, waiverAmount: 0, hasPendingRequest: month === 4 });
  return aggregateRtFinancialReport([due(4), due(12)], { year, availableYears: [2025, 2026], businessDate: "2026-10-31" });
}
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("cache-control", "no-store");
  if (url.pathname === "/") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="id" class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F14 synthetic export fixture</title><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); return;
  }
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); return; }
  if (url.pathname === "/api/fixture-report") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(report(url.searchParams.get("year") === "2025" ? 2025 : 2026))); return; }
  response.statusCode = 404; response.end();
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port unavailable.");
  console.log(`F14_SYNTHETIC_FIXTURE=http://127.0.0.1:${address.port}/`);
});
