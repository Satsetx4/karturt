import { getPublicAppUrl } from "@/lib/env";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(getPublicAppUrl()).origin;
  } catch {
    return false;
  }
}
