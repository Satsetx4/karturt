"use client";
import { useEffect, useState } from "react";
import {
  CheckCircle,
  Clock,
  CircleAlert,
  MinusCircle,
  CircleSlash,
} from "lucide-react";
import {
  dueToken,
  duesSummary,
  monthNames,
  yearMonths,
  type ResidentDue,
} from "@/lib/billing/resident-card";
const labels = {
  PAID: "Lunas",
  UNPAID: "Belum lunas",
  WAIVED: "Dibebaskan",
  NOT_DUE: "Tidak ditagihkan",
};
const icons = {
  PAID: CheckCircle,
  UNPAID: CircleAlert,
  WAIVED: MinusCircle,
  NOT_DUE: CircleSlash,
};
const rupiah = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
export function ResidentCard({
  profile,
  businessDate,
}: {
  profile: {
    name: string;
    houseNumber: string;
    rtName: string;
    startsOn: string;
  };
  businessDate: string;
}) {
  const [tab, setTab] = useState("card");
  const [dues, setDues] = useState<ResidentDue[]>([]);
  const [state, setState] = useState("loading");
  const [year, setYear] = useState(Number(businessDate.slice(0, 4)));
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem("karturt:resident-tab");
        if (saved && ["card", "history", "profile"].includes(saved))
          setTab(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/resident/monthly-dues", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          setDues([]);
          setState("expired");
          return;
        }
        if (!response.ok) throw new Error("load");
        const data = await response.json();
        setDues(data.dues);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [retry]);
  function navigate(value: string) {
    setTab(value);
    try {
      localStorage.setItem("karturt:resident-tab", value);
    } catch {}
  }
  const years = [
    ...new Set([
      Number(businessDate.slice(0, 4)),
      ...dues.map((d) => d.billingYear),
    ]),
  ].sort((a, b) => b - a);
  const selected = dues.filter((d) => d.billingYear === year);
  const summary = duesSummary(selected, businessDate);
  return (
    <section className="resident-area">
      <p className="eyebrow">RUANG WARGA · {profile.rtName}</p>
      <h1>
        {tab === "card"
          ? "Kartu Iuran"
          : tab === "history"
            ? "Riwayat Iuran"
            : "Profil"}
      </h1>
      <p>
        Rumah {profile.houseNumber} · {profile.name}
      </p>
      <nav className="resident-nav" aria-label="Navigasi warga">
        {[
          ["card", "Kartu Iuran"],
          ["history", "Riwayat"],
          ["profile", "Profil"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => navigate(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {state === "expired" ? (
        <div role="alert">
          <p>Sesi berakhir atau akses warga berubah. Silakan masuk kembali.</p>
          <a className="button" href="/login/warga">
            Masuk kembali
          </a>
        </div>
      ) : tab === "profile" ? (
        <dl className="resident-profile">
          <dt>Nama</dt>
          <dd>{profile.name}</dd>
          <dt>Nomor rumah</dt>
          <dd>{profile.houseNumber}</dd>
          <dt>RT</dt>
          <dd>{profile.rtName}</dd>
          <dt>Mulai menjadi household</dt>
          <dd>{profile.startsOn}</dd>
        </dl>
      ) : state === "loading" ? (
        <p role="status">Memuat iuran…</p>
      ) : state === "error" ? (
        <div role="alert">
          <p>Iuran belum dapat dimuat.</p>
          <button
            className="button"
            onClick={() => {
              setState("loading");
              setRetry((r) => r + 1);
            }}
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <label className="resident-year">
            Tahun{" "}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          {tab === "card" ? (
            <>
              <div className="resident-summary">
                <div>
                  <span>Tunggakan lewat jatuh tempo</span>
                  <strong>{rupiah(summary.arrears)}</strong>
                </div>
                <div>
                  <span>Total belum lunas</span>
                  <strong>{rupiah(summary.unpaid)}</strong>
                </div>
                <div>
                  <span>Iuran berstatus lunas</span>
                  <strong>{rupiah(summary.paid)}</strong>
                </div>
              </div>
              <p className="resident-note">
                Jatuh tempo tanggal 10. Bulan yang belum jatuh tempo tetap
                berstatus belum lunas. Dibebaskan dan tidak ditagihkan tidak
                masuk tunggakan.
              </p>
              <ol className="dues-grid">
                {yearMonths(dues, year).map(({ name, month, due }) => {
                  const token = due ? dueToken(due) : null;
                  const Icon = token ? icons[token] : Clock;
                  return (
                    <li key={month} className="due-card">
                      <h2>{name}</h2>
                      <p
                        className={`due-status status-${due?.status ?? "missing"}`}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span>
                          {token ? labels[token] : "Data belum tersedia"}
                        </span>
                      </p>
                      {token && <small>{token}</small>}
                      <strong>{due ? rupiah(due.amount) : "—"}</strong>
                      {due && (
                        <p className="resident-note">
                          {due.status === "not_due"
                            ? "Di luar periode kewajiban"
                            : `Jatuh tempo ${due.dueDate}`}
                        </p>
                      )}
                      {due?.status === "waived" && (
                        <p className="resident-note">
                          Alasan: {due.waivedReason}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <>
              <p>
                Catatan status iuran, bukan riwayat transaksi. Detail waktu
                pembayaran dan bukti pembayaran belum tersedia.
              </p>
              {selected.length === 0 ? (
                <p>Belum ada catatan iuran untuk tahun ini.</p>
              ) : (
                <ul className="dues-history">
                  {[...selected]
                    .sort((a, b) => a.month - b.month)
                    .map((d) => (
                      <li key={d.month}>
                        <strong>{monthNames[d.month - 1]}</strong>
                        <span>
                          {labels[dueToken(d)]} · {rupiah(d.amount)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
