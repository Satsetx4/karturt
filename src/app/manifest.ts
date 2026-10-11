import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KartuRT — Administrasi Warga",
    short_name: "KartuRT",
    description: "Administrasi iuran RT yang mudah dipahami warga dan pengurus.",
    start_url: "/",
    scope: "/",
    lang: "id",
    display: "standalone",
    background_color: "#f3f6f4",
    theme_color: "#173745",
    icons: [
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
