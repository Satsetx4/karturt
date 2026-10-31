import { createRoot } from "react-dom/client";
import { PaymentNotifications } from "../src/components/payment-notifications";
let fault = "ready";
const role = new URL(location.href).searchParams.get("role") === "treasurer" ? "treasurer" : "resident";
window.fetch = async (_input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (fault === "network") throw new TypeError("Synthetic network failure");
  return new Response(JSON.stringify({ viewerAccountId: fault === "switched" ? "other-synthetic-account" : "synthetic-account", role, checkedAt: new Date().toISOString(), hasMore: false,
    items: fault === "empty" ? [] : [{ requestCode: "KRT-0000000000000001", status: role === "treasurer" ? "pending" : "reversed", occurredAt: new Date().toISOString() }],
  }), { status: fault === "expired" ? 401 : 200, headers: { "content-type": "application/json" } });
};
createRoot(document.getElementById("root")!).render(<main className="page-shell">
  <label>Respons sintetis <select onChange={event => { fault = event.target.value; }}>
    <option value="ready">Normal</option><option value="network">Koneksi gagal</option><option value="expired">Sesi berakhir</option><option value="switched">Akun berubah</option><option value="empty">Kosong</option>
  </select></label>
  <PaymentNotifications accountId="synthetic-account" role={role} />
</main>);
