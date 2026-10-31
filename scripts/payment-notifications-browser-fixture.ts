import { buildSync } from "esbuild";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const bundle = buildSync({ entryPoints: ["scripts/payment-notifications-browser-entry.tsx"], bundle: true, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", define: { "process.env": "{}" }, write: false });
const css = readFileSync("src/app/globals.css", "utf8").replace(/^@import.*$/gm, "");
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1"); response.setHeader("cache-control", "no-store");
  if (url.pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); return; }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="id" class="${url.searchParams.get("theme") === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F19 synthetic component fixture</title><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
});
server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable"); console.log(`F19_SYNTHETIC_FIXTURE=http://127.0.0.1:${address.port}/`); });
