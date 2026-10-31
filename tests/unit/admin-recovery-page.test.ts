import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn() }));
vi.mock("@/lib/auth/principal", () => ({ getCurrentPrincipal: mocks.principal, MfaEnrollmentRequiredError: class extends Error {}, UnauthenticatedError: class extends Error {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import AdminAccountsPage from "@/app/system/akun/page";
import { MfaEnrollmentRequiredError, UnauthenticatedError } from "@/lib/auth/principal";
describe("admin recovery page", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "system_admin" }); });
  it("starts with search only, no account directory or credential fields, and clear navigation", async () => {
    const html = renderToStaticMarkup(await AdminAccountsPage()); expect(html).toContain("Kembali ke ruang akun"); expect(html).toContain("Cari akun"); expect(html).toContain("Lihat riwayat aktivitas"); expect(html).not.toContain('type="password"'); expect(html).not.toContain("REC-2026");
  });
  it.each(["resident", "treasurer", "rt_chairman"])("denies %s", async (role) => { mocks.principal.mockResolvedValue({ role }); await expect(AdminAccountsPage()).rejects.toThrow("NOT_FOUND"); });
  it("redirects anonymous sessions to System Admin login", async () => { mocks.principal.mockRejectedValue(new UnauthenticatedError()); await expect(AdminAccountsPage()).rejects.toThrow("REDIRECT:/system/login"); });
  it("requires enrollment before page access", async () => { mocks.principal.mockRejectedValue(new MfaEnrollmentRequiredError()); await expect(AdminAccountsPage()).rejects.toThrow("REDIRECT:/system/2fa/setup"); });
});
