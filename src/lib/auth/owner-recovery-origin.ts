export const OWNER_RECOVERY_HOST = "karturt-production-rt-6.vercel.app";
export const OWNER_RECOVERY_ORIGIN = `https://${OWNER_RECOVERY_HOST}`;

type HeaderReader = Pick<Headers, "get">;

function matchesProtectedHost(headers: HeaderReader) {
  const host = headers.get("host")?.trim().toLowerCase();
  const forwardedHost = headers.get("x-forwarded-host")?.trim().toLowerCase();
  const forwardedProto = headers.get("x-forwarded-proto")?.trim().toLowerCase();
  return host === OWNER_RECOVERY_HOST
    && (!forwardedHost || forwardedHost === OWNER_RECOVERY_HOST)
    && (!forwardedProto || forwardedProto === "https");
}

export function isOwnerRecoveryHost(headers: HeaderReader) {
  return matchesProtectedHost(headers);
}

export function isOwnerRecoveryRequest(request: Request) {
  if (!matchesProtectedHost(request.headers)) return false;
  if (request.headers.get("origin") !== OWNER_RECOVERY_ORIGIN) return false;
  try {
    const url = new URL(request.url);
    return url.protocol === "https:" && url.host.toLowerCase() === OWNER_RECOVERY_HOST;
  } catch {
    return false;
  }
}
