import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), feed: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/principal", async (original) => ({ ...await original<typeof import("@/lib/auth/principal")>(), getCurrentPrincipal: mocks.principal }));
vi.mock("@/lib/billing/payment-notifications", async (original) => ({ ...await original<typeof import("@/lib/billing/payment-notifications")>(), getPaymentNotifications: mocks.feed }));
import { GET } from "@/app/api/notifications/route";
import { UnauthenticatedError } from "@/lib/auth/principal";
import { PaymentNotificationsForbiddenError } from "@/lib/billing/payment-notifications";
const request = (query = "") => new Request(`https://preview.test.invalid/api/notifications${query}`);
describe("payment notification API boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "resident" }); mocks.feed.mockResolvedValue({ items: [] }); });
  it("never accepts RT/account filters, even for signed-in users", async () => {
    expect((await GET(request("?rtUnitId=other"))).status).toBe(400);
    expect(mocks.feed).not.toHaveBeenCalled();
  });
  it("returns private no-store responses, including authentication and service errors", async () => {
    const success = await GET(request()); expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    expect(success.headers.get("vary")).toBe("Cookie");
    mocks.principal.mockRejectedValueOnce(new UnauthenticatedError());
    const expired = await GET(request()); expect(expired.status).toBe(401);
    expect(expired.headers.get("cache-control")).toContain("no-store");
    mocks.feed.mockRejectedValueOnce(new PaymentNotificationsForbiddenError()); expect((await GET(request())).status).toBe(403);
    mocks.feed.mockRejectedValueOnce(new Error("Synthetic private database diagnostic"));
    const error = await GET(request()); expect(error.status).toBe(500); expect(await error.text()).not.toContain("private database diagnostic");
  });
});
