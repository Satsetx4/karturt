import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const themeBootstrap = `(()=>{let theme="light";try{const stored=localStorage.getItem("karturt:theme");if(stored==="dark")theme="dark"}catch{}document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle("dark",theme==="dark")})()`;
const organizationData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "KartuRT",
  url: appUrl,
  logo: new URL("/icon.svg", appUrl).toString(),
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Administrasi iuran RT yang lebih jelas", template: "%s · KartuRT" },
  description: "KartuRT membantu warga dan pengurus melihat administrasi iuran RT dengan alur yang mudah dipahami.",
  applicationName: "KartuRT",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "KartuRT",
    title: "KartuRT — Administrasi warga, lebih jelas",
    description: "Informasi iuran RT dan administrasi warga dalam satu tempat.",
    images: [{ url: "/og-karturt.svg", width: 1200, height: 630, alt: "KartuRT — Administrasi warga, lebih jelas" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "KartuRT — Administrasi warga, lebih jelas",
    description: "Informasi iuran RT dan administrasi warga dalam satu tempat.",
    images: ["/og-karturt.svg"],
  },
  icons: { icon: "/icon.svg" },
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${sourceSans.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script id="karturt-theme-bootstrap" dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData).replace(/</g, "\\u003c") }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
