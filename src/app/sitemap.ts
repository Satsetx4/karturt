import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return [{
    url: new URL("/", baseUrl).toString(),
    changeFrequency: "monthly",
    priority: 1,
  }];
}
