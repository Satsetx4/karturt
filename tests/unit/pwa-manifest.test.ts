import { describe, expect, it } from "vitest";
import manifest from "../../src/app/manifest";

describe("KartuRT installable PWA shell", () => {
  it("has scoped standalone identity and explicit 192/512 local icons", () => {
    const pwa = manifest();
    expect(pwa).toMatchObject({
      id: "/",
      short_name: "KartuRT",
      lang: "id",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#f3f6f4",
      theme_color: "#173745",
    });
    expect(pwa.icons).toEqual([
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("never declares offline cache or a service worker for sensitive resident pages", () => {
    const pwa = JSON.stringify(manifest());
    expect(pwa).not.toMatch(/service.worker|offline|precache|financial.cache|storage/i);
  });
});
