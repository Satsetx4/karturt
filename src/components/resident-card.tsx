"use client";
import { useEffect, useState } from "react";
import {
  CheckCircle,
  Clock,
  CircleAlert,
  CircleHelp,
  MinusCircle,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import {
  dueToken,
  duesSummary,
  formatResidentDate,
  monthNames,
  residentStatusLabels,
  yearMonths,
  type ResidentDue,
  type ResidentStatusToken,
} from "@/lib/billing/resident-card";
const icons: Record<ResidentStatusToken, LucideIcon> = {
  PAID: CheckCircle,
  UNPAID: CircleAlert,
  WAIVED: MinusCircle,
  NOT_DUE: CircleSlash,
  PENDING: Clock,
};
const rupiah = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);

export function ResidentDueStatus({
  token,
}: {
  token: ResidentStatusToken | "MISSING";
}) {
  const Icon = token === "MISSING" ? CircleHelp : icons[token];
  const label =
    token === "MISSING" ? "Data belum tersedia" : residentStatusLabels[token];
  return (
    <p className={`due-status status-${token.toLowerCase()}`}>
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}

export function ResidentMonthCard({
  name,
  due,
}: {
  name: string;
  due?: ResidentDue;
}) {
  const token = due ? dueToken(due) : "MISSING";
  return (
    <li className="due-card">
      <h2>{name}</h2>
      <ResidentDueStatus token={token} />
      <strong>
        {due && due.status !== "not_due" ? rupiah(due.amount) : "—"}
      </strong>
    </li>
  );
}

export function ResidentDuesSummary({
  summary,
}: {
  summary: { paid: number; arrears: number; unpaid: number };
}) {
  return (
    <div className="resident-summary">
      <div>
        <span>Tunggakan</span>
        <strong>{rupiah(summary.arrears)}</strong>
      </div>
      <div>
        <span>Total belum dibayar</span>
        <strong>{rupiah(summary.unpaid)}</strong>
      </div>
      <div>
        <span>Total sudah dibayar</span>
        <strong>{rupiah(summary.paid)}</strong>
      </div>
    </div>
  );
}

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
          <dt>Terdaftar sejak</dt>
          <dd>{formatResidentDate(profile.startsOn)}</dd>
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
              <ResidentDuesSummary summary={summary} />
              <ol className="dues-grid">
                {yearMonths(dues, year).map(({ name, month, due }) => {
                  return (
                    <ResidentMonthCard key={month} name={name} due={due} />
                  );
                })}
              </ol>
            </>
          ) : (
            <>
              <p>
                Halaman ini menampilkan catatan iuran bulanan, bukan bukti
                pembayaran.
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
                          {residentStatusLabels[dueToken(d)]} ·{" "}
                          {d.status === "not_due" ? "—" : rupiah(d.amount)}
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
