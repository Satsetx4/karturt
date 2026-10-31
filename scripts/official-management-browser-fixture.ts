import { buildSync } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OfficialList, OfficialMutation } from "../src/lib/officials/management";

// Synthetic HTTP/component fixture only; domain invariants are tested against PGlite separately.
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const fixture: OfficialList = { today: "2026-10-31", hasMoreHistory: false,
  accounts: [{ id: id(1), name: "Ketua sintetis" }, { id: id(2), name: "Bendahara sintetis" }, { id: id(3), name: "Pengganti sintetis" }],
  assignments: [{ id: id(11), accountId: id(1), name: "Ketua sintetis", role: "rt_chairman", startsOn: "2026-01-01", endsOn: null },
    { id: id(12), accountId: id(2), name: "Bendahara sintetis", role: "treasurer", startsOn: "2026-01-01", endsOn: null }] };
const bundle = buildSync({ entryPoints: ["scripts/official-management-browser-entry.tsx"], bundle: true, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", define: { "process.env": "{}" }, write: false });
const chunks = ".next/static/chunks";
const source = readFileSync("src/app/globals.css", "utf8");
const css = readdirSync(chunks).filter((path) => path.endsWith(".css")).map((path) => readFileSync(join(chunks, path), "utf8")).join("\n") + source.slice(source.indexOf(".official-area"));
let mutations = 0;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("cache-control", "no-store");
  if (url.pathname === "/") {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="id" class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F16 synthetic fixture</title><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`); return;
  }
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); return; }
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/metrics") { response.end(JSON.stringify({ mutations })); return; }
  if (url.pathname !== "/api/chairman/officials") { response.statusCode = 404; response.end("{}"); return; }
  if (request.method === "POST") {
    let text = ""; for await (const chunk of request) text += chunk;
    const value = JSON.parse(text) as OfficialMutation;
    mutations += 1;
    if (value.operation === "end") { const old = fixture.assignments.find((row) => row.id === value.assignmentId); if (old) old.endsOn = value.endsOn; }
    else {
      const prior = value.operation === "handover" ? fixture.assignments.find((row) => row.id === value.assignmentId) : undefined;
      if (prior) { const end = new Date(`${value.startsOn}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1); prior.endsOn = end.toISOString().slice(0, 10); }
      fixture.assignments.unshift({ id: id(20 + mutations), accountId: value.accountId, name: fixture.accounts.find((account) => account.id === value.accountId)!.name,
        role: value.operation === "schedule" ? value.role : prior!.role, startsOn: value.startsOn, endsOn: value.operation === "schedule" ? value.endsOn : null });
    }
    response.end(JSON.stringify({ message: "Perubahan jabatan sintetis tersimpan." })); return;
  }
  response.end(JSON.stringify(fixture));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port unavailable.");
  console.log(`F16_SYNTHETIC_FIXTURE=http://127.0.0.1:${address.port}/`);
});
