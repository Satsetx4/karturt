"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Segoe UI, sans-serif", color: "#152a34", background: "#f3f6f4" }}>
        <main style={{ maxWidth: 480, textAlign: "center" }}>
          <p style={{ color: "#276f68", fontWeight: 800, letterSpacing: ".12em" }}>KARTURT</p>
          <h1>Halaman belum dapat dibuka.</h1>
          <p style={{ color: "#5d6b70" }}>Coba lagi atau kembali ke beranda.</p>
          <button type="button" onClick={reset} style={{ minHeight: 48, marginRight: 8, padding: "0 16px", border: 0, borderRadius: 9, color: "white", background: "#173745", fontWeight: 700, cursor: "pointer" }}>Coba lagi</button>
          <Link href="/" style={{ display: "inline-flex", minHeight: 48, alignItems: "center", padding: "0 16px", border: "1px solid #bdcbc6", borderRadius: 9, fontWeight: 700 }}>Beranda</Link>
        </main>
      </body>
    </html>
  );
}
