import { describe, expect, it } from "vitest";
import { isExactVercelPreviewReleaseBuild } from "@/lib/deployment-build-source";

const releaseSha = "9de65320fa4566191ff9300b8ef2703decfaa3d3";

describe("isExactVercelPreviewReleaseBuild", () => {
  it("accepts only a Preview build whose Vercel Git SHA matches the embedded release SHA", () => {
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: releaseSha,
    }, releaseSha)).toBe(true);
  });

  it("rejects Production even when its Git SHA matches", () => {
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: releaseSha,
    }, releaseSha)).toBe(false);
  });

  it("rejects a missing or mismatched Git SHA", () => {
    expect(isExactVercelPreviewReleaseBuild({ VERCEL_ENV: "preview" }, releaseSha)).toBe(false);
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "b86c3721dbcc1b5b5db78d5f8fa939ad88053437",
    }, releaseSha)).toBe(false);
  });

  it("rejects incomplete SHAs", () => {
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "9de6532",
    }, "9de6532")).toBe(false);
  });

  it("accepts an explicit full SHA only for a Vercel Preview CLI build without Git metadata", () => {
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      KARTURT_VERCEL_PREVIEW_RELEASE_SHA: releaseSha,
    }, releaseSha)).toBe(true);
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "",
      KARTURT_VERCEL_PREVIEW_RELEASE_SHA: releaseSha,
    }, releaseSha)).toBe(true);
  });

  it("rejects a manual Preview SHA outside Vercel Preview or when it conflicts with Git metadata", () => {
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL: "1",
      VERCEL_ENV: "production",
      KARTURT_VERCEL_PREVIEW_RELEASE_SHA: releaseSha,
    }, releaseSha)).toBe(false);
    expect(isExactVercelPreviewReleaseBuild({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "b86c3721dbcc1b5b5db78d5f8fa939ad88053437",
      KARTURT_VERCEL_PREVIEW_RELEASE_SHA: releaseSha,
    }, releaseSha)).toBe(false);
  });
});
