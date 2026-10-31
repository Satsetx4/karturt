import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/principal", () => ({ getCurrentPrincipal: mocks.principal, MfaEnrollmentRequiredError: class extends Error {}, UnauthenticatedError: class extends Error {} }));
vi.mock("@/lib/officials/management", () => ({ listOfficials: mocks.list }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import OfficialsPage from "@/app/app/pengurus/page";
import { UnauthenticatedError } from "@/lib/auth/principal";
describe("official page access and empty state", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.principal.mockResolvedValue({ role: "rt_chairman", rtUnitId: "synthetic-rt" }); mocks.list.mockResolvedValue({ today: "2026-10-31", accounts: [], assignments: [], hasMoreHistory: false }); });
  it("renders clear navigation, honest empty states and disabled scheduling without accounts", async () => {
    const html = renderToStaticMarkup(await OfficialsPage()); expect(html).toContain("Kembali ke ruang akun"); expect(html).toContain("Belum ada akun pengurus aktif"); expect(html).toContain("Belum ada masa jabatan"); expect(html).toContain("disabled");
  });
  it.each(["resident", "treasurer", "system_admin"])("denies %s without reading the list", async (role) => {
    mocks.principal.mockResolvedValue({ role, rtUnitId: "synthetic-rt" }); await expect(OfficialsPage()).rejects.toThrow("NOT_FOUND"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("redirects anonymous users", async () => { mocks.principal.mockRejectedValue(new UnauthenticatedError()); await expect(OfficialsPage()).rejects.toThrow("REDIRECT:/login/pengurus"); });
});
