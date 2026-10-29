"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown, Smartphone } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function subscribeDisplayMode(onChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallApp() {
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const completed = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", completed);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", completed);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError("Pemasangan belum dapat dibuka. Gunakan menu browser seperti panduan di bawah.");
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  if (standalone || installed) return null;
  return (
    <details className="pwa-install">
      <summary className="text-button"><Smartphone size={17} aria-hidden="true" /> Pasang di HP <ChevronDown className="pwa-install-arrow" size={16} aria-hidden="true" /></summary>
      <div className="pwa-install-guide">
        <h2>Buka KartuRT dari layar utama</h2>
        <p>Tambahkan ikon KartuRT agar mudah dibuka. Sambungan internet tetap diperlukan.</p>
        {prompt && <button className="button button--secondary" type="button" onClick={() => void install()} disabled={busy}>{busy ? "Membuka pemasangan…" : "Pasang KartuRT"}</button>}
        {error && <p role="alert">{error}</p>}
        <ol>
          <li><strong>Android:</strong> buka menu browser, lalu pilih Pasang aplikasi atau Tambahkan ke layar utama.</li>
          <li><strong>iPhone/iPad:</strong> buka di Safari, pilih Bagikan, lalu Tambahkan ke Layar Utama.</li>
        </ol>
        <p>Jika pilihan pemasangan belum muncul, Anda tetap dapat memakai KartuRT melalui browser.</p>
      </div>
    </details>
  );
}
