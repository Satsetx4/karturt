import { buildSync } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RecoveryAccount } from "../src/lib/accounts/recovery-directory";

// No authentication or database here: exercise the actual UI against synthetic responses only.
const accounts: RecoveryAccount[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Warga sintetis", loginIdentifier: "S-01", type: "resident", status: "active", rtLabel: "RT Sintetis", recovery: "resident_pin" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Admin sintetis lain", loginIdentifier: "admin-test", type: "system_admin", status: "active", rtLabel: null, recovery: "admin_two_factor" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Pengurus sintetis", loginIdentifier: "official-test", type: "official", status: "active", rtLabel: "RT Sintetis", recovery: null },
];
const bundle = buildSync({ entryPoints: ["scripts/admin-recovery-browser-entry.tsx"], bundle: true, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", define: { "process.env": "{}" }, write: false });
const chunks = ".next/static/chunks";
const css = readdirSync(chunks).filter((path) => path.endsWith(".css")).map((path) => readFileSync(join(chunks, path), "utf8")).join("\n");
const metrics = { searches: 0, pinRequests: 0, factorRequests: 0 };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1"); response.setHeader("cache-control", "no-store");
  if (url.pathname === "/") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end(`<!doctype html><html lang="id" class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F17 synthetic recovery fixture</title><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); return; }
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); return; }
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/metrics") { response.end(JSON.stringify(metrics)); return; }
  if (request.method !== "POST") { response.statusCode = 404; response.end("{}"); return; }
  let text = ""; for await (const chunk of request) text += chunk;
  const body = JSON.parse(text) as { query?: string; pin?: string; reason?: string; recoveryReference?: string };
  if (url.pathname === "/api/system-admin/accounts/search") { metrics.searches += 1; response.end(JSON.stringify({ hasMore: false, accounts: accounts.filter((row) => row.loginIdentifier === body.query) })); return; }
  if (url.pathname.endsWith("/reset-pin")) { if (!/^\d{6}$/.test(body.pin ?? "")) { response.statusCode = 400; response.end(JSON.stringify({ message: "PIN sintetis tidak valid." })); return; } metrics.pinRequests += 1; }
  else if (url.pathname.endsWith("/recover-two-factor")) metrics.factorRequests += 1;
  else { response.statusCode = 404; response.end("{}"); return; }
  // Never retain, echo or log the supplied PIN, reason or reference.
  response.end(JSON.stringify({ ok: true, sessionsRevoked: 2 }));
});
server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port unavailable."); console.log(`F17_SYNTHETIC_FIXTURE=http://127.0.0.1:${address.port}/`); });
