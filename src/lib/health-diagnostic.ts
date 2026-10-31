const categories: Readonly<Record<string, string>> = {
  "28P01": "authentication",
  "28000": "authentication",
  "3D000": "database_missing",
  "42501": "permission",
  "53300": "connection_limit",
  "57P03": "database_unavailable",
  "57P01": "database_unavailable",
  "08001": "connection_failed",
  "08004": "connection_rejected",
  "08006": "connection_failed",
  "08P01": "protocol",
  XX000: "database_internal",
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  ECONNREFUSED: "connection_refused",
  ECONNRESET: "connection_reset",
  ETIMEDOUT: "timeout",
  CERT_HAS_EXPIRED: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
};

export type HealthStage = "configuration" | "query" | "tls" | "worker_identity";

export function classifyHealthError(error: unknown): { category: string; code: string } {
  let current = error;
  // Drizzle wraps driver errors in cause. Emit only fixed allowlisted labels.
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    try {
      const item = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof item.code === "string" && Object.hasOwn(categories, item.code)) {
        return { category: categories[item.code]!, code: item.code };
      }
      if (item.message === "Connection terminated due to connection timeout" ||
          item.message === "timeout exceeded when trying to connect") {
        return { category: "timeout", code: "ETIMEDOUT" };
      }
      current = item.cause;
    } catch {
      break;
    }
  }
  return { category: "unknown", code: "UNKNOWN" };
}

export function reportPreviewHealthFailure(error: unknown, stage: HealthStage) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.APP_ENV !== "preview" || process.env.DATABASE_ENV !== "preview") return;
  console.error(JSON.stringify({ event: "karturt-preview-health-failure", stage, ...classifyHealthError(error) }));
}
