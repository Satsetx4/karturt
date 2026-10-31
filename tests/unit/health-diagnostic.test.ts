import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyHealthError } from "@/lib/health-diagnostic";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), tls: vi.fn(), identity: vi.fn() }));
vi.mock("@/db/client", () => ({ getConnection: mocks.connection }));
vi.mock("@/db/pool", () => ({ isVerifiedNodeTlsSocket: mocks.tls }));
vi.mock("@/lib/r3-worker-identity", () => ({ getR3WorkerIdentity: mocks.identity }));
import { GET } from "@/app/api/health/route";

describe("safe Preview health diagnostics", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("APP_ENV", "preview"); vi.stubEnv("DATABASE_ENV", "preview");
    vi.clearAllMocks();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([
    ["28P01", "authentication"], ["28000", "authentication"], ["3D000", "database_missing"],
    ["42501", "permission"], ["53300", "connection_limit"], ["57P03", "database_unavailable"],
    ["ENOTFOUND", "dns"], ["ECONNREFUSED", "connection_refused"], ["ECONNRESET", "connection_reset"],
    ["ETIMEDOUT", "timeout"], ["CERT_HAS_EXPIRED", "tls"], ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["08006", "connection_failed"], ["08004", "connection_rejected"], ["XX000", "database_internal"],
  ])("classifies nested driver code %s without including messages", (code, category) => {
    expect(classifyHealthError(new Error("private wrapper", { cause: { code, message: "private credential" } })))
      .toEqual({ code, category });
  });

  it("handles cycles, hostile properties and unrecognized codes without echoing data", () => {
    const cycle: { cause?: unknown; code: string } = { code: "SECRET-CONTENT" }; cycle.cause = cycle;
    expect(classifyHealthError(cycle)).toEqual({ category: "unknown", code: "UNKNOWN" });
    expect(classifyHealthError({ get code() { throw new Error("private"); } })).toEqual({ category: "unknown", code: "UNKNOWN" });
    expect(classifyHealthError(new Error("timeout exceeded when trying to connect"))).toEqual({ category: "timeout", code: "ETIMEDOUT" });
  });

  it("keeps the public 503 response generic and logs only fixed fields on Preview", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connection.mockReturnValue({ db: { execute: vi.fn().mockRejectedValue(new Error("postgresql://private-value", { cause: { code: "28P01", detail: "private detail" } })) } });
    const response = await GET(new Request("https://example.invalid/api/health?token=private-query"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "karturt-preview-health-failure", stage: "query", category: "authentication", code: "28P01" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it.each(["APP_ENV", "DATABASE_ENV", "VERCEL_ENV"])("does not log when %s is Production", async (key) => {
    vi.stubEnv(key, "production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connection.mockImplementation(() => { throw new Error("private configuration"); });
    expect((await GET(new Request("https://example.invalid/api/health"))).status).toBe(503);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports the TLS stage when acquiring the verified socket fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connection.mockReturnValue({ db: { execute: vi.fn().mockResolvedValue({}) }, pool: { connect: vi.fn().mockRejectedValue({ code: "CERT_HAS_EXPIRED" }) } });
    expect((await GET(new Request("https://example.invalid/api/health"))).status).toBe(503);
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ stage: "tls", category: "tls", code: "CERT_HAS_EXPIRED" });
  });

  it("preserves healthy response, TLS verification and client release without diagnostic logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const release = vi.fn();
    mocks.connection.mockReturnValue({ db: { execute: vi.fn().mockResolvedValue({}) }, pool: { connect: vi.fn().mockResolvedValue({ connection: { stream: {} }, release }) } });
    mocks.tls.mockReturnValue(true); mocks.identity.mockReturnValue(undefined);
    const response = await GET(new Request("https://example.invalid/api/health"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok", databaseTlsVerified: true });
    expect(release).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
  });

  it("returns healthy F4 Preview with the real R3 helper when no race worker is configured", async () => {
    const actual = await vi.importActual<typeof import("@/lib/r3-worker-identity")>("@/lib/r3-worker-identity");
    mocks.identity.mockImplementation(actual.getR3WorkerIdentity);
    for (const key of ["KARTURT_R3_RUN_ID", "KARTURT_R3_SCENARIO", "KARTURT_R3_WORKER_TAG"]) vi.stubEnv(key, undefined);
    vi.stubEnv("KARTURT_PREVIEW_TARGET_ID", "soft-dawn-95924243/br-still-bar-aoqs0gbc/ep-bold-brook-ao92fqh8/karturt_preview");
    vi.stubEnv("KARTURT_PRODUCTION_TARGET_ID", "holy-term-22410117/br-jolly-bonus-azzd71cl/ep-production-test-only/karturt_production");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const release = vi.fn();
    mocks.connection.mockReturnValue({ db: { execute: vi.fn().mockResolvedValue({}) }, pool: { connect: vi.fn().mockResolvedValue({ connection: { stream: {} }, release }) } });
    mocks.tls.mockReturnValue(true);
    const response = await GET(new Request("https://example.invalid/api/health", { headers: { "x-karturt-r3-run-id": "forgedrun20261031" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", databaseTlsVerified: true });
    expect(release).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
  });
});
