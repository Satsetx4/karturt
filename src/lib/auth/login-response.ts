const genericLoginError = "Data masuk belum cocok atau akun belum aktif.";

export async function toPublicLoginResponse(response: Response) {
  const body = await response.json().catch(() => null) as unknown;
  const result = response.ok
    ? { twoFactorRedirect: typeof body === "object" && body !== null && "twoFactorRedirect" in body && body.twoFactorRedirect === true }
    : { message: genericLoginError };
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);

  return new Response(JSON.stringify(result), { status: response.status, headers });
}
