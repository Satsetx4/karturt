import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { isExactVercelPreviewReleaseBuild } from "@/lib/deployment-build-source";

function resolveCompiledReleaseSha() {
  const declaredPreviewSha = process.env.KARTURT_VERCEL_PREVIEW_RELEASE_SHA?.trim();
  if (declaredPreviewSha !== undefined) {
    if (!isExactVercelPreviewReleaseBuild(process.env, declaredPreviewSha)) {
      throw new Error("An explicit release SHA is allowed only for an exact Vercel Preview build.");
    }
    return declaredPreviewSha;
  }

  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(gitSha)) {
    throw new Error("Next.js build requires a full Git commit SHA for release identity.");
  }
  return gitSha;
}
const compiledReleaseSha = resolveCompiledReleaseSha();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function safeConfigKey(key: string): string {
  return /secret|token|password|credential|private|environment|env/i.test(key) ? "<redacted-key>" : key;
}

function reportVercelConfigSourceDiagnostic() {
  try {
    const status = execFileSync("git", ["status", "--porcelain=v1", "--", "vercel.json"], { encoding: "utf8" });
    if (!status.trim()) return;

    const tracked = execFileSync("git", ["show", "HEAD:vercel.json"], { encoding: "utf8" });
    const current = readFileSync("vercel.json", "utf8");
    let trackedConfig: Record<string, unknown> | undefined;
    let currentConfig: Record<string, unknown> | undefined;
    try {
      trackedConfig = JSON.parse(tracked) as Record<string, unknown>;
      currentConfig = JSON.parse(current) as Record<string, unknown>;
    } catch {
      // Hashes and parseability are enough to diagnose without logging config values.
    }

    const changedTopLevelKeys = trackedConfig && currentConfig
      ? [...new Set([...Object.keys(trackedConfig), ...Object.keys(currentConfig)])]
        .filter((key) => canonicalJson(trackedConfig?.[key]) !== canonicalJson(currentConfig?.[key]))
        .map(safeConfigKey)
        .sort()
      : null;
    const report = {
      event: "karturt-build-source-diagnostic",
      path: "vercel.json",
      gitStatus: status.trim().slice(0, 2).trim(),
      trackedSha256: createHash("sha256").update(tracked).digest("hex"),
      workingSha256: createHash("sha256").update(current).digest("hex"),
      jsonParseable: Boolean(trackedConfig && currentConfig),
      semanticJsonMatch: trackedConfig && currentConfig
        ? canonicalJson(trackedConfig) === canonicalJson(currentConfig)
        : null,
      changedTopLevelKeys,
    };
    console.info(`[karturt-build-source-diagnostic] ${JSON.stringify(report)}`);
  } catch {
    console.info("[karturt-build-source-diagnostic] {\"event\":\"karturt-build-source-diagnostic\",\"path\":\"vercel.json\",\"available\":false}");
  }
}

function assertCleanBuildSource() {
  reportVercelConfigSourceDiagnostic();
  const sourceStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  const unexpectedChanges = sourceStatus.split(/\r?\n/).filter(Boolean).filter((entry) => {
    const path = entry.slice(3).replace(/\\/g, "/");
    return !(entry.startsWith("?? ") && (path === ".vc" || path.startsWith(".vc/")));
  });
  if (unexpectedChanges.length > 0) {
    const unexpectedPaths = unexpectedChanges.map((entry) => {
      const status = entry.slice(0, 2);
      const path = entry.slice(3).replace(/\\/g, "/");
      const containsPrivatePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|data\/private)(?:\/|$)|\.(?:xlsx?|csv|jsonl|dump)$|(?:resident|household|credential|secret|password|token)/i.test(path);
      return `${status} ${containsPrivatePath ? "<redacted private path>" : JSON.stringify(path)}`;
    });
    throw new Error(`Production builds require clean source tracked by Git. Unexpected paths: ${unexpectedPaths.join("; ")}`);
  }
}

const nextConfig: NextConfig = {
  env: { KARTURT_COMPILED_RELEASE_SHA: compiledReleaseSha },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@neondatabase/serverless"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    if (isExactVercelPreviewReleaseBuild(process.env, compiledReleaseSha)) {
      reportVercelConfigSourceDiagnostic();
    } else {
      assertCleanBuildSource();
    }
  }
  return nextConfig;
}
