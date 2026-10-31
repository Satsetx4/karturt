import { createRoot } from "react-dom/client";
import Link from "next/link";
import { OfficialManagement } from "../src/components/official-management";
import type { OfficialList } from "../src/lib/officials/management";

const mode = new URL(location.href).searchParams.get("fault");
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (input === "/api/chairman/officials" && init?.method === "POST") {
    if (mode === "offline") return Promise.reject(new TypeError("Synthetic connection loss"));
    if (mode === "expired") return Promise.resolve(new Response(JSON.stringify({ message: "Sesi berakhir. Silakan masuk kembali." }), { status: 401, headers: { "content-type": "application/json" } }));
  }
  return originalFetch(input, init);
};

void fetch("/api/chairman/officials").then(async (response) => {
  const initial = await response.json() as OfficialList;
  const root = document.getElementById("root");
  if (!root) throw new Error("Synthetic browser fixture root missing.");
  createRoot(root).render(<main className="page-shell"><Link href="/">Kembali ke ruang akun uji</Link><OfficialManagement initial={initial} /></main>);
});
