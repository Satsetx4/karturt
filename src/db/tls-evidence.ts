export type DatabaseTlsEvidenceSource = "postgres_pg_stat_ssl" | "node_tls_socket";

export type DatabaseTlsEvidence = {
  tlsActive: boolean;
  tlsEvidenceSource: DatabaseTlsEvidenceSource;
  postgresReportedTlsActive?: boolean;
};

export function resolveDatabaseTlsEvidence(
  source: DatabaseTlsEvidenceSource,
  evidence: {
    nodeTlsSocketVerified?: boolean;
    postgresReportedTlsActive: boolean;
  },
): DatabaseTlsEvidence {
  if (source === "node_tls_socket") {
    return {
      tlsActive: evidence.nodeTlsSocketVerified === true,
      tlsEvidenceSource: source,
      postgresReportedTlsActive: evidence.postgresReportedTlsActive,
    };
  }

  return {
    tlsActive: evidence.postgresReportedTlsActive,
    tlsEvidenceSource: source,
  };
}
