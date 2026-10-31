import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), search: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "https://preview.test.invalid" }));
vi.mock("@/lib/auth/principal", async (original) => ({ ...await original<typeof import("@/lib/auth/principal")>(), getCurrentPrincipal: mocks.principal }));
vi.mock("@/lib/accounts/recovery-directory", async (original) => ({ ...await original<typeof import("@/lib/accounts/recovery-directory")>(), searchRecoveryAccounts: mocks.search }));
import { POST } from "@/app/api/system-admin/accounts/search/route";
import { UnauthenticatedError, MfaEnrollmentRequiredError } from "@/lib/auth/principal";
import { RecoveryDirectoryForbiddenError } from "@/lib/accounts/recovery-directory";
function request(body: unknown = { query: "S-01" }, origin: string | null = "https://preview.test.invalid", contentType = "application/json") {
  return new Request("https://preview.test.invalid/api/system-admin/accounts/search", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": contentType }, body: JSON.stringify(body) });
}
describe("admin recovery search boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "system_admin" }); mocks.search.mockResolvedValue({ accounts: [], hasMore: false }); });
  it.each([null, "https://other.test.invalid"])("rejects invalid Origin %s before session or lookup", async (origin) => {
    expect((await POST(request(undefined, origin))).status).toBe(403); expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
  });
  it("requires JSON, a valid strict search and verified session", async () => {
    expect((await POST(request(undefined, undefined, "text/plain"))).status).toBe(415);
    for (const body of [{ query: "" }, { query: "a", rtUnitId: "other" }]) expect((await POST(request(body))).status).toBe(400);
    for (const error of [new UnauthenticatedError(), new MfaEnrollmentRequiredError()]) { mocks.principal.mockRejectedValueOnce(error); expect((await POST(request())).status).toBe(401); }
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("returns no-store and generic errors without leaking diagnostics", async () => {
    const ok = await POST(request()); expect(ok.status).toBe(200); expect(ok.headers.get("cache-control")).toBe("no-store");
    mocks.search.mockRejectedValueOnce(new RecoveryDirectoryForbiddenError()); expect((await POST(request())).status).toBe(403);
    mocks.search.mockRejectedValueOnce(new Error("Synthetic sensitive diagnostic")); const error = await POST(request()); expect(error.status).toBe(500); expect(await error.text()).not.toContain("Synthetic sensitive diagnostic");
  });
});
