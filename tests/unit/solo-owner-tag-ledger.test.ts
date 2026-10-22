import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  soloOwnerTicketDigest,
  soloOwnerTicketRef,
} from "../../scripts/lib/solo-owner-tag-ledger";

describe("Solo Owner tag-ledger pure contract", () => {
  it("derives one stable digest independent of run or candidate metadata", () => {
    const ticket = "c".repeat(32);
    const expected = createHash("sha256")
      .update("karturt-solo-owner-ticket/v1:" + ticket, "utf8")
      .digest("hex");
    expect(soloOwnerTicketDigest(ticket)).toBe(expected);
    expect(soloOwnerTicketDigest(ticket)).toBe(soloOwnerTicketDigest(ticket));
  });

  it("uses the digest as the complete single-use tag reference key", () => {
    const digest = "a".repeat(64);
    expect(soloOwnerTicketRef(digest))
      .toBe("refs/tags/karturt-solo/used/v1/" + digest);
  });

  it.each([
    ["uppercase ticket", "C".repeat(32), "TICKET_FORMAT_INVALID"],
    ["short ticket", "c".repeat(31), "TICKET_FORMAT_INVALID"],
    ["wrong digest length", "a".repeat(63), "TICKET_DIGEST_INVALID"],
    ["non-hex digest", "z".repeat(64), "TICKET_DIGEST_INVALID"],
  ])("rejects %s", (_label, value, code) => {
    expect(() => value.length === 64 ? soloOwnerTicketRef(value) : soloOwnerTicketDigest(value))
      .toThrow(code);
  });
});
