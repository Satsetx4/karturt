"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3, Coins } from "lucide-react";

type BillingYear = { id: string; year: number; status: string };
type FeeRate = {
  id: string;
  billingYearId: string;
  effectiveMonth: number;
  monthlyAmount: number;
  createdAt: string;
};
type FeeRateResponse = { years: BillingYear[]; rates: FeeRate[] };
type FeeRateResult = { idempotentReplay?: boolean };
type Attempt = { scope: string; key: string };

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function rupiah(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) return "Jumlah tidak tersedia";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function monthLabel(month: number, year: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return "Periode tidak tersedia";
  return monthNames[month - 1] + " " + year;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function jakartaYearMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month) };
}

function createIdempotencyKey() {
  return crypto.randomUUID();
}

function statusLabel(status: string) {
  if (status === "open") return "Terbuka";
  if (status === "closed") return "Ditutup";
  return "Belum dibuka";
}

function safeMessage(status: number, action: "load" | "submit") {
  if (status === 401) return "Sesi berakhir. Masuk kembali untuk melanjutkan.";
  if (status === 403 || status === 404) return "Tarif tidak tersedia untuk akun ini.";
  if (status === 409) return "Periode tarif berubah atau sudah memiliki jadwal. Muat ulang lalu pilih bulan mendatang yang belum dijadwalkan.";
  if (action === "load") return "Riwayat tarif belum dapat dimuat. Silakan coba lagi.";
  return "Tarif belum dapat disimpan. Coba lagi di halaman ini agar permintaan tetap memakai kunci yang sama.";
}

async function requestJson<T>(input: RequestInfo | URL, action: "load" | "submit", init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(safeMessage(0, action));
  }

  const payload = await response.json().catch(() => null) as (T & { message?: unknown }) | null;
  if (!response.ok) throw new Error(safeMessage(response.status, action));
  if (!payload || typeof payload !== "object") throw new Error(safeMessage(0, action));
  return payload;
}

export function ChairmanFeeRatesFlow() {
  const [data, setData] = useState<FeeRateResponse>({ years: [], rates: [] });
  const [selectedYearId, setSelectedYearId] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [amountText, setAmountText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">("success");
  const [reloadToken, setReloadToken] = useState(0);
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const result = await requestJson<FeeRateResponse>("/api/chairman/fee-rates", "load", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const years = Array.isArray(result.years) ? result.years : [];
        const rates = Array.isArray(result.rates) ? result.rates : [];
        setData({ years, rates });
        setSelectedYearId((current) => {
          if (current && years.some((year) => year.id === current)) return current;
          const today = jakartaYearMonth();
          const currentOpen = years.find((year) => year.year === today.year && year.status === "open");
          const latestOpen = [...years].filter((year) => year.status === "open")
            .sort((left, right) => right.year - left.year)[0];
          return (currentOpen ?? latestOpen ?? years[0])?.id ?? "";
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : safeMessage(0, "load"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [reloadToken]);

  const selectedYear = data.years.find((year) => year.id === selectedYearId) ?? null;
  const yearRates = selectedYear
    ? data.rates.filter((rate) => rate.billingYearId === selectedYear.id)
      .sort((left, right) => left.effectiveMonth - right.effectiveMonth)
    : [];
  const scheduledMonths = new Set(yearRates.map((rate) => rate.effectiveMonth));
  const today = jakartaYearMonth();
  const availableMonths = selectedYear?.status === "open"
    ? monthNames.map((_, index) => index + 1).filter((month) =>
        (selectedYear.year > today.year || (selectedYear.year === today.year && month > today.month)) &&
        !scheduledMonths.has(month),
      )
    : [];
  const amount = amountText.trim() ? Number(amountText) : NaN;
  const selectedMonthNumber = Number(effectiveMonth);
  const canPreview = Boolean(
    selectedYear &&
    selectedYear.status === "open" &&
    availableMonths.includes(selectedMonthNumber) &&
    Number.isSafeInteger(amount) &&
    amount > 0,
  );

  async function submitRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedYear || !canPreview || inFlight.current) return;

    const body = {
      billingYearId: selectedYear.id,
      effectiveMonth: selectedMonthNumber,
      monthlyAmount: amount,
    };
    const scope = JSON.stringify(body);
    const key = attempt.current?.scope === scope
      ? attempt.current.key
      : createIdempotencyKey();
    attempt.current = { scope, key };
    inFlight.current = true;
    setSubmitting(true);
    setFeedback("");
    try {
      const result = await requestJson<FeeRateResult>("/api/chairman/fee-rates", "submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      attempt.current = null;
      setFeedbackKind("success");
      setFeedback(result.idempotentReplay
        ? "Tarif ini sudah tercatat sebelumnya."
        : "Tarif baru berhasil dicatat.");
      setEffectiveMonth("");
      setAmountText("");
      setReloadToken((current) => current + 1);
    } catch (error) {
      setFeedbackKind("error");
      setFeedback(error instanceof Error ? error.message : safeMessage(0, "submit"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="chairman-rate-area" aria-labelledby="chairman-rate-title">
      <Link className="chairman-rate-back" href="/app">
        <ArrowLeft size={18} aria-hidden="true" /> Kembali ke ruang akun
      </Link>
      <div className="chairman-rate-heading">
        <p className="eyebrow">PENGELOLAAN KEWAJIBAN</p>
        <h1 id="chairman-rate-title">Tarif iuran</h1>
        <p>Tambahkan tarif untuk periode mendatang dan tinjau jadwal yang sudah tercatat.</p>
      </div>

      <section className="chairman-rate-panel" aria-labelledby="chairman-rate-create-title">
        <div className="chairman-rate-panel-heading">
          <span className="chairman-rate-icon"><Coins size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="chairman-rate-create-title">Jadwalkan tarif baru</h2>
            <p>Tarif berlaku saat tagihan untuk bulan tersebut dibuat. Tagihan yang sudah ada tetap memakai nominal awal.</p>
          </div>
        </div>

        {loading ? (
          <p className="chairman-rate-note" role="status">Memuat tahun tagihan dan jadwal tarif…</p>
        ) : loadError ? (
          <div className="chairman-rate-alert" role="alert">
            <p>{loadError}</p>
            <button className="chairman-rate-secondary" type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Muat ulang
            </button>
          </div>
        ) : data.years.length === 0 ? (
          <p className="chairman-rate-note" role="status">Belum ada tahun tagihan yang tersedia.</p>
        ) : (
          <form className="chairman-rate-form" onSubmit={(event) => void submitRate(event)}>
            <label htmlFor="chairman-rate-year">Tahun tagihan</label>
            <select
              id="chairman-rate-year"
              value={selectedYearId}
              onChange={(event) => {
                setSelectedYearId(event.target.value);
                setEffectiveMonth("");
                setFeedback("");
              }}
              disabled={submitting}
            >
              {data.years.slice().sort((left, right) => right.year - left.year).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.year} · {statusLabel(year.status)}
                </option>
              ))}
            </select>

            <label htmlFor="chairman-rate-month">Berlaku mulai bulan</label>
            <select
              id="chairman-rate-month"
              value={effectiveMonth}
              onChange={(event) => {
                setEffectiveMonth(event.target.value);
                setFeedback("");
              }}
              disabled={submitting || availableMonths.length === 0}
            >
              <option value="">Pilih bulan</option>
              {availableMonths.map((month) => (
                <option key={month} value={month}>{monthNames[month - 1]} {selectedYear?.year}</option>
              ))}
            </select>

            {selectedYear?.status !== "open" ? (
              <p className="chairman-rate-note" role="status">Tahun tagihan ini belum terbuka untuk penjadwalan tarif.</p>
            ) : availableMonths.length === 0 ? (
              <p className="chairman-rate-note" role="status">Tidak ada bulan mendatang yang belum memiliki jadwal tarif pada tahun ini.</p>
            ) : null}

            <label htmlFor="chairman-rate-amount">Tarif per bulan</label>
            <div className="chairman-rate-input-wrap">
              <span aria-hidden="true">Rp</span>
              <input
                id="chairman-rate-amount"
                type="number"
                min="1"
                max="2147483647"
                step="1"
                inputMode="numeric"
                value={amountText}
                onChange={(event) => {
                  setAmountText(event.target.value);
                  setFeedback("");
                }}
                placeholder="Masukkan nominal"
                required
                disabled={submitting || !selectedYear || selectedYear.status !== "open"}
              />
            </div>

            {canPreview && selectedYear && (
              <div className="chairman-rate-preview" aria-live="polite">
                <span>Tarif yang akan dijadwalkan</span>
                <strong>{rupiah(amount)} per bulan</strong>
                <span>Berlaku mulai {monthLabel(selectedMonthNumber, selectedYear.year)}</span>
              </div>
            )}

            {feedback && (
              <p className={feedbackKind === "success" ? "chairman-rate-feedback chairman-rate-feedback--success" : "chairman-rate-feedback"} role={feedbackKind === "success" ? "status" : "alert"}>
                {feedback}
              </p>
            )}

            <button className="chairman-rate-primary" type="submit" disabled={!canPreview || submitting}>
              {submitting ? "Mencatat tarif…" : "Catat tarif baru"}
              {!submitting && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </form>
        )}
      </section>

      <section className="chairman-rate-history" aria-labelledby="chairman-rate-history-title">
        <div className="chairman-rate-history-heading">
          <div>
            <p className="eyebrow">RIWAYAT</p>
            <h2 id="chairman-rate-history-title">Jadwal tarif</h2>
          </div>
          <Clock3 size={21} aria-hidden="true" />
        </div>
        {loading ? (
          <p className="chairman-rate-note" role="status">Memuat jadwal tarif…</p>
        ) : selectedYear && yearRates.length > 0 ? (
          <ol className="chairman-rate-list">
            {yearRates.map((rate) => (
              <li key={rate.id}>
                <div>
                  <strong>{monthLabel(rate.effectiveMonth, selectedYear.year)}</strong>
                  <time dateTime={rate.createdAt}>Dicatat {dateLabel(rate.createdAt)}</time>
                </div>
                <b>{rupiah(rate.monthlyAmount)}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p className="chairman-rate-note" role="status">
            {selectedYear ? "Belum ada jadwal tarif untuk tahun " + selectedYear.year + "." : "Pilih tahun tagihan untuk melihat jadwal."}
          </p>
        )}
      </section>
    </section>
  );
}
