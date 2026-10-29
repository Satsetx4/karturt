import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KartuRT",
    short_name: "KartuRT",
    description: "Administrasi iuran warga dan pengurus RT.",
    lang: "id-ID",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6f4",
    theme_color: "#173745",
    prefer_related_applications: false,
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
