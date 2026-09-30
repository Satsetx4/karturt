import { describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({principal:vi.fn(),dues:vi.fn(),db:{}}));
vi.mock("@/lib/auth/principal",()=>({getCurrentPrincipal:mocks.principal,UnauthenticatedError:class extends Error{},MfaEnrollmentRequiredError:class extends Error{}}));
vi.mock("@/db/client",()=>({getDb:()=>mocks.db}));
vi.mock("@/lib/billing/resident-dues",()=>({getResidentMonthlyDues:mocks.dues}));
import { GET } from "../../src/app/api/resident/monthly-dues/route";
import { UnauthenticatedError } from "../../src/lib/auth/principal";
describe("resident dues HTTP authority",()=>{
 it("ignores request tenant scope and uses authenticated principal",async()=>{const principal={role:"resident",householdId:"own",rtUnitId:"own-rt"};mocks.principal.mockResolvedValue(principal);mocks.dues.mockResolvedValue([]);const response=await GET();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(mocks.dues).toHaveBeenLastCalledWith(mocks.db,principal);expect(GET.length).toBe(0);});
 it("returns 401 for expired session",async()=>{mocks.principal.mockRejectedValue(new UnauthenticatedError());expect((await GET()).status).toBe(401);});
 it("denies financial access for non-resident",async()=>{mocks.principal.mockResolvedValue({role:"system_admin"});mocks.dues.mockRejectedValue(new Error("Forbidden: resident only"));expect((await GET()).status).toBe(403);});
});
