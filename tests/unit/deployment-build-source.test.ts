import { describe, expect, it } from "vitest";
import { isExactVercelPreviewGitBuild } from "@/lib/deployment-build-source";

const releaseSha = "9de65320fa4566191ff9300b8ef2703decfaa3d3";

describe("isExactVercelPreviewGitBuild", () => {
  it("accepts only a Preview build whose Vercel Git SHA matches the embedded release SHA", () => {
    expect(isExactVercelPreviewGitBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: releaseSha,
    }, releaseSha)).toBe(true);
  });

  it("rejects Production even when its Git SHA matches", () => {
    expect(isExactVercelPreviewGitBuild({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: releaseSha,
    }, releaseSha)).toBe(false);
  });

  it("rejects a missing or mismatched Git SHA", () => {
    expect(isExactVercelPreviewGitBuild({ VERCEL_ENV: "preview" }, releaseSha)).toBe(false);
    expect(isExactVercelPreviewGitBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "b86c3721dbcc1b5b5db78d5f8fa939ad88053437",
    }, releaseSha)).toBe(false);
  });

  it("rejects incomplete SHAs", () => {
    expect(isExactVercelPreviewGitBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "9de6532",
    }, "9de6532")).toBe(false);
  });
});
