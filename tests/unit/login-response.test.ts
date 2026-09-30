import { describe, expect, it } from "vitest";
import { toPublicLoginResponse } from "../../src/lib/auth/login-response";

describe("public login response", () => {
  it("keeps session cookies and MFA routing while excluding the internal auth identity", async () => {
    const response = await toPublicLoginResponse(new Response(JSON.stringify({
      user: { id: "internal-id", email: "random@accounts.karturt.invalid" },
      token: "private-session-token",
      twoFactorRedirect: true,
    }), {
      status: 200,
      headers: { "set-cookie": "karturt.session=opaque; HttpOnly; Secure; SameSite=Lax" },
    }));

    expect(await response.json()).toEqual({ twoFactorRedirect: true });
    expect(response.headers.get("set-cookie")).toContain("karturt.session=opaque");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("normalizes auth failures so callers cannot distinguish an unknown account from a wrong password", async () => {
    const response = await toPublicLoginResponse(new Response(JSON.stringify({ message: "Invalid email or password", email: "secret@accounts.karturt.invalid" }), {
      status: 401,
      headers: { "set-cookie": "challenge=opaque; HttpOnly", "retry-after": "60" },
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Data masuk belum cocok atau akun belum aktif." });
    expect(response.headers.get("set-cookie")).toContain("challenge=opaque");
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
