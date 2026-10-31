import { createRoot } from "react-dom/client";
import { AdminRecoveryTools } from "../src/components/admin-recovery-tools";
const fault = new URL(location.href).searchParams.get("fault");
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const mutation = typeof input === "string" && (input.endsWith("/reset-pin") || input.endsWith("/recover-two-factor"));
  if (mutation && fault === "network") return Promise.reject(new TypeError("Synthetic connection loss"));
  if (fault === "expired") return Promise.resolve(new Response(JSON.stringify({ message: "Masuk kembali dengan Admin yang berwenang." }), { status: 401, headers: { "content-type": "application/json" } }));
  return originalFetch(input, init);
};
const root = document.getElementById("root");
if (!root) throw new Error("Synthetic recovery root missing.");
createRoot(root).render(<main className="page-shell"><AdminRecoveryTools /></main>);
