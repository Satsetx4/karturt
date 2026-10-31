import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), list: vi.fn(), change: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/env", () => ({ getPublicAppUrl: () => "https://preview.test.invalid" }));
vi.mock("@/lib/auth/principal", async (original) => ({ ...await original<typeof import("@/lib/auth/principal")>(), getCurrentPrincipal: mocks.principal }));
vi.mock("@/lib/officials/management", async (original) => ({ ...await original<typeof import("@/lib/officials/management")>(), listOfficials: mocks.list, changeOfficial: mocks.change }));
import { GET, POST } from "@/app/api/chairman/officials/route";
import { UnauthenticatedError } from "@/lib/auth/principal";
import { OfficialForbiddenError, OfficialConflictError, OfficialNotFoundError } from "@/lib/officials/management";
const body = { operation: "schedule", accountId: "00000000-0000-4000-8000-000000000001", role: "treasurer", startsOn: "2026-11-01", endsOn: null, reason: "Penetapan pengurus" };
function request(value: unknown = body, origin: string | null = "https://preview.test.invalid", contentType = "application/json") {
  return new Request("https://preview.test.invalid/api/chairman/officials", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": contentType }, body: JSON.stringify(value) });
}
describe("official management HTTP boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "rt_chairman" }); mocks.change.mockResolvedValue({ replay: false }); mocks.list.mockResolvedValue({ accounts: [], assignments: [] }); });
  it.each([null, "https://other.test.invalid"])("denies missing/cross-site Origin %s before reading session or mutation", async (origin) => {
    expect((await POST(request(body, origin))).status).toBe(403); expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });
  it("requires authenticated sessions and JSON", async () => {
    mocks.principal.mockRejectedValueOnce(new UnauthenticatedError()); expect((await POST(request())).status).toBe(401);
    expect((await POST(request(body, undefined, "text/plain"))).status).toBe(415); expect(mocks.change).not.toHaveBeenCalled();
  });
  it.each([{ ...body, rtUnitId: "other" }, { ...body, role: "system_admin" }, { ...body, startsOn: "2026-02-30" }, { ...body, reason: "PIN=123456" }])("rejects unknown scope/role/date/secret input", async (value) => {
    expect((await POST(request(value))).status).toBe(400); expect(mocks.change).not.toHaveBeenCalled();
  });
  it("returns safe no-store responses, without raw errors", async () => {
    for (const [error, status] of [[new OfficialForbiddenError(), 403], [new OfficialNotFoundError(), 404], [new OfficialConflictError("Jadwal bertumpang tindih"), 409], [new Error("Synthetic private diagnostic"), 500]] as const) {
      mocks.change.mockRejectedValueOnce(error); const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.text()).not.toContain("Synthetic private diagnostic");
    }
  });
  it("reads only the authenticated scope and rejects query-controlled RT selectors", async () => {
    expect((await GET(new Request("https://preview.test.invalid/api/chairman/officials?rtUnitId=other"))).status).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
    const response = await GET(new Request("https://preview.test.invalid/api/chairman/officials")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
