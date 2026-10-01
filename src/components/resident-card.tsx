"use client";
import { useEffect, useRef, useState } from "react";
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

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function duePeriod(due: ResidentDue) {
  return `${due.billingYear}-${String(due.month).padStart(2, "0")}`;
}

type PaymentRequestResponse = {
  requestCode: string;
  status: "pending" | "verified" | "rejected" | "cancelled";
  periods: string[];
  totalAmount: number;
  whatsappUrl: string | null;
  contactMessage: string | null;
  message: string;
};

export function ResidentPaymentRequestPanel({
  dues,
  onCreated,
}: {
  dues: ResidentDue[];
  onCreated: () => void;
}) {
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [result, setResult] = useState<PaymentRequestResponse | null>(null);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const requestableDues = dues.filter((due) =>
    due.status === "unpaid" && due.paymentRequestStatus !== "pending",
  );
  const requestablePeriods = new Set(requestableDues.map(duePeriod));
  const selectedDues = requestableDues.filter((due) =>
    selectedPeriod !== "" && duePeriod(due) <= selectedPeriod,
  );
  const totalAmount = selectedDues.reduce((total, due) => total + due.amount, 0);

  function changePeriod(period: string) {
    setSelectedPeriod(period);
    setConfirming(false);
    setMessage("");
    setResult(null);
    if (sessionExpired) setSessionExpired(false);
    idempotencyKey.current = null;
  }

  async function submit() {
    if (inFlight.current || !selectedPeriod) return;
    inFlight.current = true;
    setSubmitting(true);
    setMessage("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/resident/payment-requests", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify({ period: selectedPeriod }),
      });
      if (response.status === 401) {
        setSessionExpired(true);
        setMessage("Sesi berakhir. Silakan masuk kembali.");
        idempotencyKey.current = null;
        return;
      }
      const data = await response.json().catch(() => ({})) as Partial<PaymentRequestResponse> & { message?: string };
      if (response.status === 409) {
        setMessage(data.message ?? "Bulan iuran berubah. Muat ulang halaman lalu periksa kembali.");
        setConfirming(false);
        idempotencyKey.current = null;
        onCreated();
        return;
      }
      if (!response.ok || !data.requestCode || !Array.isArray(data.periods)) {
        setMessage(data.message ?? "Permintaan belum dapat disimpan. Periksa sambungan internet lalu coba lagi.");
        return;
      }
      const created = data as PaymentRequestResponse;
      setResult(created);
      setConfirming(false);
      setMessage(created.message);
      idempotencyKey.current = null;
      onCreated();
    } catch {
      setMessage("Belum tersambung. Periksa internet lalu coba lagi.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (requestableDues.length === 0 && !result) {
    return (
      <section className="payment-request-panel" aria-labelledby="payment-request-title">
        <h2 id="payment-request-title">Ajukan pembayaran</h2>
        {dues.some((due) => due.paymentRequestStatus === "pending") ? (
          <p>Permintaan yang ada sedang menunggu konfirmasi.</p>
        ) : (
          <p>Belum ada bulan dengan status Belum bayar yang dapat diajukan.</p>
        )}
      </section>
    );
  }

  return (
    <section className="payment-request-panel" aria-labelledby="payment-request-title">
      <h2 id="payment-request-title">Ajukan pembayaran</h2>
      <p>Pilih bulan. Iuran Belum bayar yang lebih lama dan belum diajukan ikut dihitung otomatis.</p>
      <label className="payment-request-label" htmlFor="payment-request-period">Bulan terakhir yang ingin diajukan</label>
      <select
        id="payment-request-period"
        className="payment-request-select"
        value={selectedPeriod}
        disabled={submitting || confirming}
        onChange={(event) => changePeriod(event.target.value)}
      >
        <option value="">Pilih bulan</option>
        {[...requestablePeriods].sort().map((period) => (
          <option key={period} value={period}>{periodLabel(period)}</option>
        ))}
      </select>

      {selectedPeriod && selectedDues.length > 0 && (
        <div className="payment-request-total" aria-live="polite">
          <span>{selectedDues.length} bulan masuk dalam permintaan</span>
          <strong>{rupiah(totalAmount)}</strong>
          {confirming && (
            <ul className="payment-request-periods">
              {selectedDues.map((due) => (
                <li key={duePeriod(due)}>{periodLabel(duePeriod(due))}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message && (
        <div className={result ? "payment-request-success" : "payment-request-error"} role={result ? "status" : "alert"}>
          <p>{message}</p>
          {sessionExpired && <a className="button button--primary" href="/login/warga">Masuk kembali</a>}
          {result && (
            <>
              <p>Nomor pengajuan: <strong>{result.requestCode}</strong></p>
              <ResidentDueStatus token="PENDING" />
              {result.whatsappUrl ? (
                <a className="button button--primary" href={result.whatsappUrl} target="_blank" rel="noreferrer">
                  Buka WhatsApp Bendahara
                </a>
              ) : (
                <p>{result.contactMessage ?? "Permintaan Anda tetap tercatat."}</p>
              )}
            </>
          )}
        </div>
      )}

      {!confirming ? (
        <button
          className="button button--primary payment-request-action"
          type="button"
          disabled={!selectedPeriod || selectedDues.length === 0 || submitting}
          onClick={() => setConfirming(true)}
        >
          Periksa jumlah
        </button>
      ) : (
        <div className="payment-request-confirm-actions">
          <p>Pastikan bulan dan jumlahnya sudah benar sebelum mengirim permintaan.</p>
          <button className="button button--primary" type="button" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Menyimpan…" : "Konfirmasi dan ajukan"}
          </button>
          <button className="text-button" type="button" disabled={submitting} onClick={() => setConfirming(false)}>
            Periksa lagi
          </button>
        </div>
      )}
    </section>
  );
}

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
  summary: { paid: number; pending: number; unpaid: number };
}) {
  return (
    <div className="resident-summary">
      <div>
        <span>Belum bayar</span>
        <strong>{rupiah(summary.unpaid)}</strong>
      </div>
      <div>
        <span>Menunggu konfirmasi</span>
        <strong>{rupiah(summary.pending)}</strong>
      </div>
      <div>
        <span>Sudah bayar</span>
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
  const summary = duesSummary(selected);
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
              <ResidentPaymentRequestPanel dues={dues} onCreated={() => setRetry((r) => r + 1)} />
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
