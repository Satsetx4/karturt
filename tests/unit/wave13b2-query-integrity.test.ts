import { describe, expect, it } from "vitest";
import {
  assertWave13B2QueryDigest,
  assertWave13B2QueryIntegrity,
  readWave13B2QueryGitBlob,
} from "../../scripts/verify-wave13b2-query-integrity.mjs";
import {
  assertSha256Matches,
  WAVE13B2_LOCAL_PREFLIGHT_EXPECTED as EXPECTED,
} from "../../scripts/preflight-wave13b2-local.mjs";

describe("Wave 13B.2 query byte integrity", () => {
  it("matches every checked-in digest pin to the raw Git blob and LF checkout bytes", () => {
    const result = assertWave13B2QueryIntegrity(process.cwd());
    expect(result.queryPacketSha256).toBe(EXPECTED.queryPacketSha256);
    expect(result.workingTreeBytes).toBe(result.gitBlobBytes);
  });

  it("rejects incorrect pins and CRLF bytes without normalizing approved content", () => {
    const approvedBytes = readWave13B2QueryGitBlob(process.cwd());
    const crlfBytes = Buffer.from(approvedBytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
    const unchangedCrlfBytes = Buffer.from(crlfBytes);
    expect(() => assertSha256Matches(approvedBytes, "0".repeat(64))).toThrow();
    expect(() => assertWave13B2QueryDigest(crlfBytes, EXPECTED.queryPacketSha256)).toThrow();
    expect(crlfBytes.equals(approvedBytes)).toBe(false);
    expect(crlfBytes).toEqual(unchangedCrlfBytes);
  });
});
