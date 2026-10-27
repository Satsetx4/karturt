import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
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
  if (phase === PHASE_PRODUCTION_BUILD && !isExactVercelPreviewReleaseBuild(process.env, compiledReleaseSha)) {
    assertCleanBuildSource();
  }
  return nextConfig;
}
