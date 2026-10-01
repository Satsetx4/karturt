"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { ResidentPaymentHistory } from "@/components/resident-payment-history";
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

type PaymentRequestHistoryItem = {
  requestCode: string;
  status: "pending" | "verified" | "rejected" | "cancelled";
  createdAt: string;
  resolvedAt: string | null;
  items: Array<{ period: string; amount: number }>;
  totalAmount: number;
  resolutionReason: string | null;
};

type PaymentRequestHistoryResponse = {
  requests: PaymentRequestHistoryItem[];
  nextCursor: string | null;
};

async function readResidentPaymentRequestHistory(cursor?: string): Promise<PaymentRequestHistoryResponse> {
  const url = new URL("/api/resident/payment-requests", window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Riwayat permintaan belum dapat dimuat.");
  return response.json() as Promise<PaymentRequestHistoryResponse>;
}

function paymentRequestStatusLabel(status: PaymentRequestHistoryItem["status"]) {
  return {
    pending: "Menunggu konfirmasi",
    verified: "Sudah dikonfirmasi",
    rejected: "Ditolak",
    cancelled: "Dibatalkan",
  }[status];
}

function requestHistoryDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

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
  const [history, setHistory] = useState<PaymentRequestHistoryItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancellingCode, setCancellingCode] = useState<string | null>(null);
  const [cancelFeedback, setCancelFeedback] = useState("");
  const inFlight = useRef(false);
  const cancelInFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const requestableDues = dues.filter((due) =>
    due.status === "unpaid" && due.paymentRequestStatus !== "pending",
  );
  const requestablePeriods = new Set(requestableDues.map(duePeriod));
  const selectedDues = requestableDues.filter((due) =>
    selectedPeriod !== "" && duePeriod(due) <= selectedPeriod,
  );
  const totalAmount = selectedDues.reduce((total, due) => total + due.amount, 0);

  const refreshHistory = useCallback(async (cursor?: string, append = false) => {
    if (append) setHistoryLoadingMore(true);
    else setHistoryStatus("loading");
    setHistoryError("");
    try {
      const data = await readResidentPaymentRequestHistory(cursor);
      setHistory((current) => append ? [...current, ...data.requests] : data.requests);
      setHistoryCursor(data.nextCursor);
      setHistoryStatus("ready");
    } catch {
      setHistoryError("Riwayat permintaan belum dapat dimuat.");
      setHistoryStatus((current) => current === "ready" ? current : "error");
    } finally {
      setHistoryLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readResidentPaymentRequestHistory()
      .then((data) => {
        if (!active) return;
        setHistory(data.requests);
        setHistoryCursor(data.nextCursor);
        setHistoryStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setHistoryError("Riwayat permintaan belum dapat dimuat.");
        setHistoryStatus("error");
      });
    return () => { active = false; };
  }, []);

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
      void refreshHistory();
    } catch {
      setMessage("Belum tersambung. Periksa internet lalu coba lagi.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function cancelRequest(requestCode: string) {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancellingCode(requestCode);
    setCancelFeedback("");
    try {
      const response = await fetch(`/api/resident/payment-requests/${encodeURIComponent(requestCode)}/cancel`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        setCancelFeedback(data.message ?? "Permintaan belum dapat dibatalkan. Muat ulang riwayat lalu coba lagi.");
        return;
      }
      setCancelFeedback(data.message ?? "Permintaan dibatalkan. Bulan kembali Belum bayar.");
      setCancelTarget(null);
      await refreshHistory();
      onCreated();
    } catch {
      setCancelFeedback("Sambungan terputus. Muat ulang riwayat untuk memeriksa status terbaru.");
    } finally {
      cancelInFlight.current = false;
      setCancellingCode(null);
    }
  }

  return (
    <section className="payment-request-panel" aria-labelledby="payment-request-title">
      <h2 id="payment-request-title">Ajukan pembayaran</h2>
      {requestableDues.length > 0 ? (
        <>
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
        </>
      ) : (
        <p>{dues.some((due) => due.paymentRequestStatus === "pending")
          ? "Permintaan yang ada sedang menunggu konfirmasi."
          : "Belum ada bulan dengan status Belum bayar yang dapat diajukan."}</p>
      )}

      <section className="payment-request-history" aria-labelledby="payment-request-history-title">
        <h3 id="payment-request-history-title">Riwayat permintaan</h3>
        {historyStatus === "loading" ? (
          <p role="status">Memuat riwayat…</p>
        ) : historyStatus === "error" ? (
          <div role="alert">
            <p>{historyError}</p>
            <button className="button" type="button" onClick={() => void refreshHistory()}>Coba lagi</button>
          </div>
        ) : history.length === 0 ? (
          <p>Belum ada permintaan pembayaran.</p>
        ) : (
          <ol className="payment-request-history-list">
            {history.map((request) => (
              <li key={request.requestCode}>
                <div className="payment-request-history-topline">
                  <strong>{paymentRequestStatusLabel(request.status)}</strong>
                  <time dateTime={request.createdAt}>{requestHistoryDate(request.createdAt)}</time>
                </div>
                <p>{request.items.map((item) => periodLabel(item.period)).join(", ")}</p>
                <div className="payment-request-history-total">
                  <span>{request.requestCode}</span>
                  <strong>{rupiah(request.totalAmount)}</strong>
                </div>
                {request.resolutionReason && (
                  <p className="payment-request-reason"><strong>Alasan:</strong> {request.resolutionReason}</p>
                )}
                {request.resolvedAt && (
                  <time className="payment-request-resolved-time" dateTime={request.resolvedAt}>
                    Diproses {requestHistoryDate(request.resolvedAt)}
                  </time>
                )}
                {request.status === "pending" && (
                  <div className="payment-request-cancel-actions">
                    {cancelTarget === request.requestCode ? (
                      <div className="payment-request-cancel-confirm" role="group" aria-label="Konfirmasi pembatalan">
                        <p>Setelah dibatalkan, bulan kembali menjadi Belum bayar dan bisa diajukan lagi.</p>
                        <button
                          className="button button--danger"
                          type="button"
                          disabled={cancellingCode !== null}
                          onClick={() => void cancelRequest(request.requestCode)}
                        >
                          {cancellingCode === request.requestCode ? "Membatalkan…" : "Ya, batalkan permintaan"}
                        </button>
                        <button className="text-button" type="button" disabled={cancellingCode !== null} onClick={() => setCancelTarget(null)}>
                          Kembali
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={cancellingCode !== null}
                        onClick={() => {
                          setCancelFeedback("");
                          setCancelTarget(request.requestCode);
                        }}
                      >
                        Batalkan permintaan
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {cancelFeedback && <p className="payment-request-cancel-feedback" role="status">{cancelFeedback}</p>}
        {historyCursor && (
          <button
            className="button button--secondary payment-request-history-more"
            type="button"
            disabled={historyLoadingMore}
            onClick={() => void refreshHistory(historyCursor, true)}
          >
            {historyLoadingMore ? "Memuat…" : "Riwayat sebelumnya"}
          </button>
        )}
      </section>
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
              <p>Halaman ini menampilkan status iuran bulanan dan riwayat pembayaran yang tercatat.</p>
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
              <ResidentPaymentHistory />
            </>
          )}
        </>
      )}
    </section>
  );
}
