import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { InstallApp } from "@/components/install-app";

describe("online-only installable PWA", () => {
  it("has a stable public launch URL without account information and standard standalone metadata", () => {
    expect(manifest()).toMatchObject({ id: "/", start_url: "/", scope: "/", name: "KartuRT", short_name: "KartuRT",
      lang: "id-ID", display: "standalone", prefer_related_applications: false });
    expect(manifest().icons?.map((icon) => icon.sizes)).toContain("192x192");
    expect(manifest().icons?.map((icon) => icon.sizes)).toContain("512x512");
  });

  it("serves actual PNG artwork at the declared dimensions, including Apple and maskable icons", () => {
    for (const icon of [...manifest().icons!, { src: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]) {
      expect(icon.src).toMatch(/^\/pwa\/[a-z0-9-]+\.png$/);
      const png = readFileSync(join(process.cwd(), "public", icon.src));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    expect(manifest().icons?.find((icon) => icon.purpose === "maskable")).toBeDefined();
  });

  it("provides an accessible browser fallback without falsely showing a native installation action", () => {
    const html = renderToStaticMarkup(createElement(InstallApp));
    expect(html).toContain("Pasang di HP");
    expect(html).toContain("Android:");
    expect(html).toContain("iPhone/iPad:");
    expect(html).toContain("Sambungan internet tetap diperlukan");
    expect(html).not.toContain(">Pasang KartuRT</button>");
  });

  it("does not introduce a service worker or an offline cache for private financial pages", () => {
    function files(folder: string): string[] {
      return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
        ? files(join(folder, entry.name)) : /\.[tj]sx?$/.test(entry.name) ? [join(folder, entry.name)] : []);
    }
    for (const path of files(join(process.cwd(), "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/serviceWorker\s*\.\s*register\s*\(|caches\s*\.\s*open\s*\(|from\s*["']workbox/);
    }
  });
});
