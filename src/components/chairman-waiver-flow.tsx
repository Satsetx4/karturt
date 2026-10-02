"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  Search,
  ShieldCheck,
} from "lucide-react";

type Household = {
  id: string;
  houseNumber: string;
  houseLabel: string;
  householdStatus: "active" | "inactive";
  residents: string[];
};

type DueStatusLabel =
  | "Belum bayar"
  | "Sudah bayar"
  | "Menunggu konfirmasi"
  | "Tidak perlu bayar"
  | "Dibebaskan"
  | "Tidak dapat diproses";

type Due = {
  period: string;
  amount: number;
  statusLabel: DueStatusLabel;
  selectable: boolean;
};

type HouseholdDetail = { household: Household; dues: Due[] };
type SearchResponse = { households: Household[] };
type HistoryItem = {
  houseNumber: string;
  houseLabel: string;
  householdStatus: "active" | "inactive";
  residents: string[];
  periods: string[];
  amount: number;
  reason: string;
  createdAt: string;
  statusLabel: "Dibebaskan";
};
type HistoryResponse = { history: HistoryItem[] };
type WaiverSuccess = {
  household: Household;
  periods: string[];
  amount: number;
  reason: string;
};
type IdempotencyAttempt = { scope: string; key: string };

const allowedStatusLabels: DueStatusLabel[] = [
  "Belum bayar",
  "Sudah bayar",
  "Menunggu konfirmasi",
  "Tidak perlu bayar",
  "Dibebaskan",
  "Tidak dapat diproses",
];

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const rupiah = (amount: number) => Number.isSafeInteger(amount) && amount >= 0
  ? new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(amount)
  : "Jumlah tidak tersedia";

function periodName(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "Periode tidak tersedia";
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function statusExplanation(status: DueStatusLabel, selectable: boolean) {
  if (status === "Belum bayar") {
    return selectable
      ? "Bulan ini dapat dipilih untuk pemutihan."
      : "Bulan ini belum dapat diproses untuk pemutihan.";
  }
  switch (status) {
    case "Sudah bayar": return "Iuran bulan ini sudah dibayar.";
    case "Menunggu konfirmasi": return "Permintaan pembayaran masih menunggu penyelesaian.";
    case "Tidak perlu bayar": return "Periode ini berada di luar kewajiban iuran.";
    case "Dibebaskan": return "Bulan ini sudah memiliki keputusan pemutihan.";
    default: return "Status bulan ini belum memungkinkan pemutihan.";
  }
}

function safeStatusLabel(status: string): DueStatusLabel {
  return allowedStatusLabels.includes(status as DueStatusLabel)
    ? status as DueStatusLabel
    : "Tidak dapat diproses";
}

function safeErrorMessage(status: number, action: "search" | "detail" | "history" | "submit") {
  if (status === 401) return "Sesi Anda berakhir. Masuk kembali untuk melanjutkan.";
  if (status === 403 || status === 404) return "Akses atau data yang diminta tidak tersedia.";
  if (status === 409 && action === "submit") {
    return "Salah satu bulan sudah berubah atau sedang menunggu penyelesaian. Muat ulang rincian sebelum mencoba lagi.";
  }
  if (status === 400 && action === "submit") return "Periksa bulan yang dipilih dan alasan pemutihan.";
  if (action === "search") return "Pencarian rumah belum dapat dimuat. Coba lagi.";
  if (action === "detail") return "Rincian iuran rumah belum dapat dimuat. Coba pilih rumah lagi.";
  if (action === "history") return "Riwayat pemutihan belum dapat dimuat. Coba lagi.";
  return "Pemutihan belum dapat dicatat. Coba lagi di halaman ini agar permintaan tetap memakai kunci yang sama.";
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  action: "search" | "detail" | "history" | "submit",
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(safeErrorMessage(0, action));
  }
  if (!response.ok) throw new Error(safeErrorMessage(response.status, action));
  try {
    return await response.json() as T;
  } catch {
    throw new Error(safeErrorMessage(0, action));
  }
}

function idempotencyKeyV4() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function HouseholdIdentity({ household }: { household: Household }) {
  const residents = household.residents.length > 0
    ? household.residents.join(", ")
    : "Nama warga belum tersedia";
  return (
    <div className="waiver-household-identity">
      <span className="waiver-household-icon"><Home size={21} aria-hidden="true" /></span>
      <span className="waiver-household-copy">
        <strong>Rumah {household.houseNumber}</strong>
        {household.houseLabel && household.houseLabel !== `Rumah ${household.houseNumber}` && (
          <span>{household.houseLabel}</span>
        )}
        <span>{residents}</span>
        {household.householdStatus === "inactive" && (
          <span className="waiver-history-household">Rumah historis · tagihan tetap tercatat pada rumah ini</span>
        )}
      </span>
    </div>
  );
}

function historyDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(date),
  };
}

export function ChairmanWaiverFlow() {
  const [searchText, setSearchText] = useState("");
  const [households, setHouseholds] = useState<Household[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedHousehold, setSelectedHousehold] = useState<Household | null>(null);
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState<WaiverSuccess | null>(null);
  const [attempt, setAttempt] = useState<IdempotencyAttempt | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const submittingRef = useRef(false);
  const detailRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const query = searchText.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!query) {
        setHouseholds([]);
        setSearchError("");
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError("");
      try {
        const url = new URL("/api/chairman/waivers/households", window.location.origin);
        url.searchParams.set("q", query);
        const result = await fetchJson<SearchResponse>(url, "search", { signal: controller.signal });
        setHouseholds(result.households);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setHouseholds([]);
        setSearchError(error instanceof Error ? error.message : safeErrorMessage(0, "search"));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchText]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const result = await fetchJson<HistoryResponse>("/api/chairman/waivers/history", "history", {
          signal: controller.signal,
        });
        setHistory(result.history);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setHistoryError(error instanceof Error ? error.message : safeErrorMessage(0, "history"));
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    })();
    return () => controller.abort();
  }, [historyRefresh]);

  async function chooseHousehold(household: Household) {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setSelectedHousehold(household);
    setDetail(null);
    setSelectedPeriods([]);
    setReason("");
    setConfirming(false);
    setSuccess(null);
    setErrorMessage("");
    setDetailLoading(true);
    try {
      const result = await fetchJson<HouseholdDetail>(
        `/api/chairman/waivers/households/${encodeURIComponent(household.id)}`,
        "detail",
        { signal: controller.signal },
      );
      setSelectedHousehold(result.household);
      setDetail(result);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setErrorMessage(error instanceof Error ? error.message : safeErrorMessage(0, "detail"));
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  function togglePeriod(period: string) {
    setSelectedPeriods((current) => current.includes(period)
      ? current.filter((value) => value !== period)
      : [...current, period].sort());
    setConfirming(false);
    setSuccess(null);
    setErrorMessage("");
  }

  function selectedDueRows() {
    if (!detail) return [];
    const selected = new Set(selectedPeriods);
    return detail.dues.filter((due) => selected.has(due.period));
  }

  const selectedDues = selectedDueRows();
  const selectedTotal = selectedDues.reduce((total, due) => total + due.amount, 0);
  const allSelectedAreEligible = Boolean(
    detail && selectedPeriods.length > 0 &&
    selectedPeriods.every((period) => {
      const due = detail.dues.find((candidate) => candidate.period === period);
      return due?.selectable && due.statusLabel === "Belum bayar" &&
        Number.isSafeInteger(due.amount) && due.amount > 0;
    }),
  );
  const normalizedReason = reason.trim();
  const canReview = Boolean(
    selectedHousehold && allSelectedAreEligible && Number.isSafeInteger(selectedTotal) &&
    normalizedReason.length > 0 && normalizedReason.length <= 500,
  );
  const orderedPeriods = [...selectedPeriods].sort();

  async function confirmWaiver() {
    if (
      !selectedHousehold || selectedPeriods.length === 0 || !normalizedReason ||
      !allSelectedAreEligible || !Number.isSafeInteger(selectedTotal) || submittingRef.current
    ) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage("");
    const periods = [...selectedPeriods].sort();
    const scope = JSON.stringify({
      householdId: selectedHousehold.id,
      periods,
      reason: normalizedReason,
    });
    const key = attempt?.scope === scope ? attempt.key : idempotencyKeyV4();
    setAttempt({ scope, key });

    try {
      await fetchJson<{ periods: string[]; totalAmount: number; reason: string; createdAt: string; idempotentReplay: boolean; message: string }>(
        "/api/chairman/waivers",
        "submit",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ householdId: selectedHousehold.id, periods, reason: normalizedReason }),
        },
      );
      setSuccess({
        household: selectedHousehold,
        periods,
        amount: selectedTotal,
        reason: normalizedReason,
      });
      setConfirming(false);
      setAttempt(null);
      setHistoryRefresh((current) => current + 1);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : safeErrorMessage(0, "submit"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function resetFlow() {
    detailRequestRef.current?.abort();
    setSearchText("");
    setHouseholds([]);
    setSelectedHousehold(null);
    setDetail(null);
    setSelectedPeriods([]);
    setReason("");
    setConfirming(false);
    setSuccess(null);
    setAttempt(null);
    setErrorMessage("");
  }

  const currentHistoryHousehold = (item: HistoryItem): Household => ({
    id: "",
    houseNumber: item.houseNumber,
    houseLabel: item.houseLabel,
    householdStatus: item.householdStatus,
    residents: item.residents,
  });

  return (
    <section className="waiver-area" aria-labelledby="waiver-title">
      <Link className="waiver-back-link" href="/app">
        <ArrowLeft size={18} aria-hidden="true" /> Kembali ke ruang akun
      </Link>
      <div className="waiver-heading">
        <p className="eyebrow">KEPUTUSAN KETUA RT</p>
        <h1 id="waiver-title">Pemutihan iuran</h1>
        <p>Pilih sendiri bulan yang belum dibayar. Setiap keputusan dicatat bersama alasan dan riwayatnya.</p>
      </div>

      {success ? (
        <section className="waiver-success" role="status" aria-labelledby="waiver-success-title">
          <CheckCircle2 size={32} aria-hidden="true" />
          <h2 id="waiver-success-title">Pemutihan berhasil dicatat</h2>
          <HouseholdIdentity household={success.household} />
          <p className="waiver-success-periods">{success.periods.map(periodName).join(", ")}</p>
          <p className="waiver-success-total">{rupiah(success.amount)}</p>
          <p className="waiver-reason-value">Alasan: {success.reason}</p>
          <p>Keputusan tercatat di riwayat pemutihan.</p>
          <button className="waiver-secondary-button" type="button" onClick={resetFlow}>Catat pemutihan lain</button>
        </section>
      ) : (
        <>
          <section className="waiver-step" aria-labelledby="waiver-search-title">
            <div className="waiver-step-heading">
              <span className="waiver-step-number">1</span>
              <div>
                <h2 id="waiver-search-title">Cari rumah atau warga</h2>
                <p>Pastikan rumah dan nama warga sesuai sebelum memilih bulan.</p>
              </div>
            </div>
            <label className="waiver-field-label" htmlFor="waiver-search">Nomor rumah atau nama warga</label>
            <div className="waiver-search-control">
              <Search size={19} aria-hidden="true" />
              <input
                id="waiver-search"
                type="search"
                autoComplete="off"
                maxLength={80}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Cari nomor rumah atau nama"
              />
            </div>
            {searching && <p className="waiver-inline-note" role="status">Mencari rumah…</p>}
            {!searching && searchText.trim() && households.length === 0 && !searchError && (
              <p className="waiver-inline-note" role="status">Belum ada rumah yang cocok.</p>
            )}
            {searchError && <p className="waiver-error" role="alert">{searchError}</p>}
            {households.length > 0 && (
              <ul className="waiver-household-results" aria-label="Hasil pencarian rumah">
                {households.map((household) => (
                  <li key={household.id}>
                    <button
                      className={`waiver-household-option${selectedHousehold?.id === household.id ? " is-selected" : ""}`}
                      type="button"
                      onClick={() => void chooseHousehold(household)}
                      aria-pressed={selectedHousehold?.id === household.id}
                    >
                      <HouseholdIdentity household={household} />
                      <ChevronRight size={19} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedHousehold && (
            <section className="waiver-step" aria-labelledby="waiver-months-title">
              <div className="waiver-step-heading">
                <span className="waiver-step-number">2</span>
                <div>
                  <h2 id="waiver-months-title">Pilih bulan yang akan diputihkan</h2>
                  <p>Hanya bulan berstatus belum dibayar yang dapat dipilih. Pilihan beberapa bulan diproses sebagai satu keputusan.</p>
                </div>
              </div>
              <div className="waiver-selected-household">
                <HouseholdIdentity household={selectedHousehold} />
              </div>
              {detailLoading && <p className="waiver-inline-note" role="status">Memuat rincian iuran rumah…</p>}
              {detail && !detailLoading && detail.dues.length === 0 && (
                <p className="waiver-inline-note" role="status">Belum ada rincian iuran untuk rumah ini.</p>
              )}
              {detail && !detailLoading && detail.dues.length > 0 && (
                <fieldset className="waiver-period-fieldset" disabled={confirming || submitting}>
                  <legend className="waiver-field-label">Bulan dan status iuran</legend>
                  <ul className="waiver-due-list">
                    {detail.dues.map((due) => {
                      const status = safeStatusLabel(due.statusLabel);
                      const isEligible = due.selectable && status === "Belum bayar" &&
                        Number.isSafeInteger(due.amount) && due.amount > 0;
                      const checked = selectedPeriods.includes(due.period);
                      return (
                        <li key={due.period}>
                          <label className={`waiver-due-option${isEligible ? " is-eligible" : " is-disabled"}${checked ? " is-checked" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!isEligible}
                              onChange={() => togglePeriod(due.period)}
                              aria-label={`${periodName(due.period)} · ${status}${isEligible ? " · dapat dipilih" : " · tidak dapat dipilih"}`}
                            />
                            <span className="waiver-due-copy">
                              <strong>{periodName(due.period)}</strong>
                              <span className={`waiver-status waiver-status--${status === "Belum bayar" && isEligible ? "eligible" : "muted"}`}>
                                {status}
                              </span>
                              <span className="waiver-due-explanation">{statusExplanation(status, isEligible)}</span>
                            </span>
                            <span className="waiver-due-amount">{rupiah(due.amount)}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}

              <label className="waiver-field-label" htmlFor="waiver-reason">Alasan pemutihan</label>
              <textarea
                id="waiver-reason"
                className="waiver-reason-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={4}
                required
                disabled={!detail || detailLoading || confirming || submitting}
                placeholder="Tuliskan alasan pemutihan"
                aria-describedby="waiver-reason-help"
              />
              <p id="waiver-reason-help" className="waiver-inline-note">Alasan wajib diisi, maksimal 500 karakter. Sisa {500 - reason.length} karakter.</p>
              {!confirming && (
                <div className="waiver-total-row">
                  <span>{selectedPeriods.length} bulan dipilih</span>
                  <strong>{rupiah(selectedTotal)}</strong>
                </div>
              )}

              {!confirming && (
                <button
                  className="waiver-primary-button"
                  type="button"
                  onClick={() => { setErrorMessage(""); setConfirming(true); }}
                  disabled={!canReview || detailLoading}
                >
                  Tinjau pemutihan
                </button>
              )}

              {confirming && (
                <section className="waiver-confirmation" aria-labelledby="waiver-confirm-title">
                  <div className="waiver-step-heading">
                    <span className="waiver-step-number">3</span>
                    <div>
                      <h2 id="waiver-confirm-title">Periksa sebelum mencatat</h2>
                      <p>Pastikan rumah, bulan, jumlah, dan alasan sudah benar.</p>
                    </div>
                  </div>
                  <HouseholdIdentity household={selectedHousehold} />
                  {selectedHousehold.householdStatus === "inactive" && (
                    <p className="waiver-history-note">Rumah ini sudah tidak aktif. Pemutihan tetap berlaku pada tagihan historis yang tercatat di rumah ini.</p>
                  )}
                  <ul className="waiver-confirm-periods">
                    {orderedPeriods.map((period) => {
                      const due = detail?.dues.find((item) => item.period === period);
                      return <li key={period}><span>{periodName(period)}</span><strong>{rupiah(due?.amount ?? 0)}</strong></li>;
                    })}
                  </ul>
                  <div className="waiver-total-row">
                    <span>Total nilai yang diputihkan</span>
                    <strong>{rupiah(selectedTotal)}</strong>
                  </div>
                  <div className="waiver-reason-summary">
                    <span>Alasan</span>
                    <p>{normalizedReason}</p>
                  </div>
                  <p className="waiver-audit-note"><ShieldCheck size={18} aria-hidden="true" /> Pemutihan bukan pembayaran dan akan tersimpan dalam riwayat.</p>
                  <div className="waiver-actions">
                    <button className="waiver-secondary-button" type="button" onClick={() => setConfirming(false)} disabled={submitting}>
                      Kembali mengubah
                    </button>
                    <button className="waiver-primary-button" type="button" onClick={() => void confirmWaiver()} disabled={submitting || !allSelectedAreEligible}>
                      {submitting ? "Mencatat pemutihan…" : "Konfirmasi pemutihan"}
                    </button>
                  </div>
                </section>
              )}
            </section>
          )}

          {errorMessage && <p className="waiver-error" role="alert">{errorMessage}</p>}
        </>
      )}

      <section className="waiver-history" aria-labelledby="waiver-history-title">
        <div className="waiver-history-heading">
          <div>
            <p className="eyebrow">CATATAN KEPUTUSAN</p>
            <h2 id="waiver-history-title">Riwayat pemutihan</h2>
            <p>Keputusan sebelumnya tetap tersimpan dan dapat ditinjau kembali.</p>
          </div>
          <Clock3 size={22} aria-hidden="true" />
        </div>
        {historyLoading && <p className="waiver-inline-note" role="status">Memuat riwayat…</p>}
        {historyError && <p className="waiver-error" role="alert">{historyError}</p>}
        {!historyLoading && !historyError && history.length === 0 && (
          <p className="waiver-inline-note" role="status">Belum ada pemutihan yang tercatat.</p>
        )}
        {!historyLoading && history.length > 0 && (
          <ol className="waiver-history-list">
            {history.map((item, index) => {
              const date = historyDate(item.createdAt);
              const household = currentHistoryHousehold(item);
              return (
                <li className="waiver-history-card" key={`${item.createdAt}-${item.houseNumber}-${index}`}>
                  <div className="waiver-history-card-topline">
                    <span className="waiver-history-status"><CheckCircle2 size={16} aria-hidden="true" /> Dibebaskan</span>
                    {date ? <time dateTime={date.iso}>{date.label}</time> : <span>Waktu tercatat</span>}
                  </div>
                  <HouseholdIdentity household={household} />
                  <p className="waiver-history-periods">{item.periods.map(periodName).join(", ")}</p>
                  <div className="waiver-history-total"><span>Nilai pemutihan</span><strong>{rupiah(item.amount)}</strong></div>
                  <div className="waiver-history-reason"><span>Alasan</span><p>{item.reason}</p></div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}
