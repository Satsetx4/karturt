import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { isExactVercelPreviewGitBuild } from "@/lib/deployment-build-source";

const compiledReleaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(compiledReleaseSha)) {
  throw new Error("Next.js build requires a full Git commit SHA for release identity.");
}
function assertCleanBuildSource() {
  const sourceStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  const unexpectedChanges = sourceStatus.split(/\r?\n/).filter(Boolean).filter((entry) => {
    const path = entry.slice(3).replace(/\\/g, "/");
    return !(entry.startsWith("?? ") && (path === ".vc" || path.startsWith(".vc/")));
  });
  if (unexpectedChanges.length > 0) {
    throw new Error("Production builds require clean source tracked by Git.");
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
  if (phase === PHASE_PRODUCTION_BUILD && !isExactVercelPreviewGitBuild(process.env, compiledReleaseSha)) {
    assertCleanBuildSource();
  }
  return nextConfig;
}
