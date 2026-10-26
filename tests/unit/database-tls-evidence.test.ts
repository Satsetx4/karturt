import { describe, expect, it } from "vitest";
import { resolveDatabaseTlsEvidence } from "@/db/tls-evidence";

describe("database TLS evidence policy", () => {
  it("uses the verified Node socket for Preview even when pg_stat_ssl reports false", () => {
    expect(resolveDatabaseTlsEvidence("node_tls_socket", {
      nodeTlsSocketVerified: true,
      postgresReportedTlsActive: false,
    })).toEqual({
      tlsActive: true,
      tlsEvidenceSource: "node_tls_socket",
      postgresReportedTlsActive: false,
    });
  });

  it("fails closed when the Preview Node socket is not verified, even if pg_stat_ssl reports true", () => {
    expect(resolveDatabaseTlsEvidence("node_tls_socket", {
      nodeTlsSocketVerified: false,
      postgresReportedTlsActive: true,
    })).toEqual({
      tlsActive: false,
      tlsEvidenceSource: "node_tls_socket",
      postgresReportedTlsActive: true,
    });
  });

  it("keeps PostgreSQL-reported TLS as the gate for staging evidence", () => {
    expect(resolveDatabaseTlsEvidence("postgres_pg_stat_ssl", {
      nodeTlsSocketVerified: true,
      postgresReportedTlsActive: false,
    })).toEqual({
      tlsActive: false,
      tlsEvidenceSource: "postgres_pg_stat_ssl",
    });
  });
});
