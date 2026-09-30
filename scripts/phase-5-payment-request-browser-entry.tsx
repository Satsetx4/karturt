import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ResidentDuesSummary,
  ResidentMonthCard,
  ResidentPaymentRequestPanel,
} from "../src/components/resident-card";
import { duesSummary, yearMonths, type ResidentDue } from "../src/lib/billing/resident-card";

function SmokePage({ initialDues }: { initialDues: ResidentDue[] }) {
  const [dues, setDues] = useState(initialDues);
  const loadDues = useCallback(async () => {
    const response = await fetch("/api/resident/monthly-dues", { cache: "no-store" });
    if (!response.ok) throw new Error("Mock resident dues endpoint failed.");
    const data = await response.json() as { dues: ResidentDue[] };
    setDues(data.dues);
  }, []);

  const year = 2026;
  const summary = duesSummary(dues, "2026-06-15");

  return (
    <main className="page-shell">
      <section className="resident-area">
        <p className="eyebrow">RUANG WARGA · RT SMOKE</p>
        <h1>Kartu Iuran</h1>
        <p>Rumah SMOKE-1 · Warga Uji</p>
        <nav className="resident-nav" aria-label="Navigasi warga">
          <button type="button" aria-current="page">Kartu Iuran</button>
          <button type="button">Riwayat</button>
          <button type="button">Profil</button>
        </nav>
        <ResidentDuesSummary summary={summary} />
        <ResidentPaymentRequestPanel dues={dues} onCreated={() => void loadDues()} />
        <ol className="dues-grid">
          {yearMonths(dues, year).map(({ name, month, due }) => (
            <ResidentMonthCard key={month} name={name} due={due} />
          ))}
        </ol>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser smoke root was not found.");
void fetch("/api/resident/monthly-dues", { cache: "no-store" })
  .then(async (response) => {
    if (!response.ok) throw new Error("Mock resident dues endpoint failed.");
    return await response.json() as { dues: ResidentDue[] };
  })
  .then(({ dues }) => createRoot(root).render(<SmokePage initialDues={dues} />))
  .catch(() => {
    root.textContent = "Iuran belum dapat dimuat.";
  });
