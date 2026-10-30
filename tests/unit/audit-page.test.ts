import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Principal } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({ principal: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/principal", () => ({ getCurrentPrincipal: mocks.principal,
  MfaEnrollmentRequiredError: class extends Error {}, UnauthenticatedError: class extends Error {} }));
vi.mock("@/lib/audit/reader", async (original) => ({ ...await original<typeof import("@/lib/audit/reader")>(), readAuditEvents: mocks.read }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import ActivityPage from "@/app/app/aktivitas/page";
import { UnauthenticatedError } from "@/lib/auth/principal";

const principal: Principal = { authUserId: "synthetic", appAccountId: "synthetic", role: "rt_chairman", rtUnitId: "synthetic-rt", householdId: null, personId: null };
describe("audit page access and navigation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue(principal); mocks.read.mockResolvedValue({ events: [], next: null }); });
  async function render(query: Record<string, string | string[] | undefined> = {}) {
    return renderToStaticMarkup(await ActivityPage({ searchParams: Promise.resolve(query) }));
  }
  it("renders truthful empty state, filters and a clear way home", async () => {
    const html = await render({ from: "2026-10-31", to: "2026-10-31" });
    expect(html).toContain("Belum ada aktivitas pada pilihan ini");
    expect(html).toContain('href="/app"');
    expect(html).toContain('action="/app/aktivitas"');
    expect(mocks.read).toHaveBeenCalledWith({}, principal, { from: "2026-10-31", to: "2026-10-31" });
  });
  it("preserves filters in older-page navigation, escapes names, and formats WIB", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    mocks.read.mockResolvedValue({ events: [{ id, occurredAt: "2026-10-30T17:00:00Z", actorName: '<script>alert("x")</script>', label: "PIN akun diganti" }], next: `2026-10-30T17:00:00.000000Z|${id}` });
    const html = await render({ from: "2026-10-31", action: "account.pin.changed" });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("31 Okt 2026");
    expect(html).toContain("action=account.pin.changed");
    expect(html).toContain("Aktivitas lebih lama");
    const output = process.env.KARTURT_AUDIT_RENDER_DIR;
    if (output) {
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "audit.html"), `<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body>${html}</body></html>`);
    }
  });
  it("rejects unknown query parameters and invalid dates without reading data", async () => {
    for (const query of [{ rt: "other" }, { from: "2026-02-30" }, { action: ["household.updated", "payment.reversed"] }]) {
      expect(await render(query)).toContain("Filter tidak valid");
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["resident", "treasurer"] as const)("denies direct page navigation for %s", async (role) => {
    mocks.principal.mockResolvedValue({ ...principal, role });
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("redirects anonymous sessions before reading audit data", async () => {
    mocks.principal.mockRejectedValue(new UnauthenticatedError());
    await expect(render()).rejects.toThrow("REDIRECT:/login/pengurus");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
