"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ChevronRight, Home, Search, ShieldCheck } from "lucide-react";

type Household = {
  householdId: string;
  houseNumber: string;
  residentNames: string[];
  isActive: boolean;
};

type DueItem = {
  period: string;
  amount: number;
  pendingConflict: boolean;
};

type HouseholdDetail = Household & { unpaidPeriods: DueItem[] };

type Preview = {
  household: Household;
  targetPeriod: string;
  items: DueItem[];
  totalAmount: number;
  hasPendingConflict: boolean;
};

type SearchResult = { households: Household[]; hasMore: boolean; page: number };
type RecordedPayment = { status: "recorded"; periods: string[]; itemCount: number; totalAmount: number; replayed: boolean; message: string };

const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
}).format(amount);

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function periodName(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || "Permintaan belum dapat diproses.");
  return payload;
}

function HouseholdIdentity({ household }: { household: Household }) {
  const residentLabel = household.residentNames.length > 0
    ? household.residentNames.join(", ")
    : "Nama warga belum tersedia";
  return (
    <div className="cash-household-identity">
      <div className="cash-household-icon"><Home size={22} aria-hidden="true" /></div>
      <div>
        <p className="cash-household-number">Rumah {household.houseNumber}</p>
        <p className="cash-household-residents">{residentLabel}</p>
        {!household.isActive && <span className="cash-household-history">Rumah tidak aktif · tagihan tetap milik rumah ini</span>}
      </div>
    </div>
  );
}

export function TreasurerCashPaymentFlow() {
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Household[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  const [selectedHousehold, setSelectedHousehold] = useState<Household | null>(null);
  const [householdDetail, setHouseholdDetail] = useState<HouseholdDetail | null>(null);
  const [period, setPeriod] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingHousehold, setLoadingHousehold] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState<RecordedPayment | null>(null);
  const [attempt, setAttempt] = useState<{ scope: string; key: string } | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const query = searchText.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!query) {
        setSearchResults([]);
        setHasMore(false);
        setPage(1);
        return;
      }
      setSearching(true);
      setErrorMessage("");
      try {
        const url = new URL("/api/treasurer/cash-payments/households", window.location.origin);
        url.searchParams.set("search", query);
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const result = await readJson<SearchResult>(response);
        setSearchResults(result.households);
        setHasMore(result.hasMore);
        setPage(result.page);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setSearchResults([]);
        setHasMore(false);
        setErrorMessage(error instanceof Error ? error.message : "Daftar rumah belum dapat dimuat.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, query ? 300 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchText]);

  async function loadMoreHouseholds() {
    if (!hasMore || searching) return;
    const nextPage = page + 1;
    setSearching(true);
    setErrorMessage("");
    try {
      const url = new URL("/api/treasurer/cash-payments/households", window.location.origin);
      url.searchParams.set("search", searchText.trim());
      url.searchParams.set("page", String(nextPage));
      const response = await fetch(url, { cache: "no-store" });
      const result = await readJson<SearchResult>(response);
      setSearchResults((current) => [...current, ...result.households]);
      setHasMore(result.hasMore);
      setPage(result.page);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Rumah lainnya belum dapat dimuat.");
    } finally {
      setSearching(false);
    }
  }

  async function chooseHousehold(household: Household) {
    setSelectedHousehold(household);
    setHouseholdDetail(null);
    setPeriod("");
    setPreview(null);
    setConfirming(false);
    setSuccess(null);
    setErrorMessage("");
    setAttempt(null);
    setLoadingHousehold(true);
    try {
      const response = await fetch(
        `/api/treasurer/cash-payments/households/${encodeURIComponent(household.householdId)}`,
        { cache: "no-store" },
      );
      const detail = await readJson<HouseholdDetail>(response);
      setHouseholdDetail(detail);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Iuran rumah belum dapat dimuat.");
    } finally {
      setLoadingHousehold(false);
    }
  }

  async function choosePeriod(targetPeriod: string) {
    setPeriod(targetPeriod);
    setPreview(null);
    setConfirming(false);
    setSuccess(null);
    setAttempt(null);
    setErrorMessage("");
    if (!selectedHousehold || !targetPeriod) return;
    setLoadingPreview(true);
    try {
      const url = new URL(
        `/api/treasurer/cash-payments/households/${encodeURIComponent(selectedHousehold.householdId)}`,
        window.location.origin,
      );
      url.searchParams.set("period", targetPeriod);
      const response = await fetch(url, { cache: "no-store" });
      const result = await readJson<Preview>(response);
      setPreview(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Rincian bulan belum dapat dimuat.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmPayment() {
    if (!preview || preview.hasPendingConflict || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage("");
    const scope = `${preview.household.householdId}:${preview.targetPeriod}`;
    const idempotencyKey = attempt?.scope === scope ? attempt.key : crypto.randomUUID();
    setAttempt({ scope, key: idempotencyKey });

    try {
      const response = await fetch("/api/treasurer/cash-payments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          householdId: preview.household.householdId,
          period: preview.targetPeriod,
        }),
      });
      const recorded = await readJson<RecordedPayment>(response);
      setSuccess(recorded);
      setConfirming(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Pembayaran tunai belum dapat dicatat.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function resetFlow() {
    setSelectedHousehold(null);
    setHouseholdDetail(null);
    setPeriod("");
    setPreview(null);
    setConfirming(false);
    setSuccess(null);
    setAttempt(null);
    setErrorMessage("");
  }

  return (
    <section className="cash-payment-area" aria-labelledby="cash-payment-title">
      <Link className="treasurer-back-link" href="/app">
        <ArrowLeft size={18} aria-hidden="true" /> Kembali ke ruang Bendahara
      </Link>
      <div className="treasurer-heading cash-payment-heading">
        <p className="eyebrow">PEMBAYARAN LANGSUNG</p>
        <h1 id="cash-payment-title">Catat pembayaran tunai</h1>
        <p>Pilih rumah dengan teliti. Semua bulan belum lunas sampai bulan terakhir akan dihitung otomatis.</p>
      </div>

      {success ? (
        <section className="cash-payment-success" aria-labelledby="cash-success-title" role="status">
          <CheckCircle2 size={30} aria-hidden="true" />
          <h2 id="cash-success-title">Pembayaran tunai tercatat</h2>
          <HouseholdIdentity household={preview?.household ?? selectedHousehold!} />
          <p className="cash-success-months">{success.periods.map(periodName).join(", ")}</p>
          <p className="cash-success-total">{rupiah(success.totalAmount)}</p>
          <p>{success.message}</p>
          <div className="cash-flow-actions">
            <Link className="cash-secondary-button" href="/app">Kembali ke ruang Bendahara</Link>
            <button className="cash-quiet-button" type="button" onClick={resetFlow}>Catat pembayaran lain</button>
          </div>
        </section>
      ) : (
        <>
          <section className="cash-payment-step" aria-labelledby="cash-house-search-title">
            <div className="cash-step-heading">
              <span className="cash-step-number">1</span>
              <div>
                <h2 id="cash-house-search-title">Cari rumah atau warga</h2>
                <p>Cocokkan nomor rumah dan nama sebelum melanjutkan.</p>
              </div>
            </div>
            <label className="cash-search-label" htmlFor="cash-house-search">Nomor rumah atau nama warga</label>
            <div className="cash-search-control">
              <Search size={19} aria-hidden="true" />
              <input
                id="cash-house-search"
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Contoh: nomor rumah atau nama"
                maxLength={80}
                autoComplete="off"
              />
            </div>
            {searching && <p className="cash-inline-note" role="status">Mencari rumah…</p>}
            {!searching && searchText.trim() && searchResults.length === 0 && !errorMessage && (
              <p className="cash-inline-note" role="status">Belum ada rumah yang cocok.</p>
            )}
            {searchResults.length > 0 && (
              <ul className="cash-household-results" aria-label="Hasil pencarian rumah">
                {searchResults.map((household) => (
                  <li key={household.householdId}>
                    <button
                      className={`cash-household-option${selectedHousehold?.householdId === household.householdId ? " is-selected" : ""}`}
                      type="button"
                      onClick={() => chooseHousehold(household)}
                      aria-pressed={selectedHousehold?.householdId === household.householdId}
                    >
                      <HouseholdIdentity household={household} />
                      <ChevronRight size={19} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasMore && (
              <button className="cash-quiet-button" type="button" onClick={loadMoreHouseholds} disabled={searching}>
                {searching ? "Memuat…" : "Tampilkan rumah lainnya"}
              </button>
            )}
          </section>

          {selectedHousehold && (
            <section className="cash-payment-step" aria-labelledby="cash-period-title">
              <div className="cash-step-heading">
                <span className="cash-step-number">2</span>
                <div>
                  <h2 id="cash-period-title">Pastikan rumah dan bulan</h2>
                  <p>Periksa identitas rumah, lalu pilih bulan terakhir yang dibayar.</p>
                </div>
              </div>
              <div className="cash-selected-household">
                <HouseholdIdentity household={householdDetail ?? selectedHousehold} />
                {householdDetail && householdDetail.unpaidPeriods.length === 0 && (
                  <p className="cash-inline-note">Tidak ada bulan belum lunas yang dapat dicatat.</p>
                )}
              </div>
              {loadingHousehold ? (
                <p className="cash-inline-note" role="status">Memuat daftar iuran rumah…</p>
              ) : householdDetail && householdDetail.unpaidPeriods.length > 0 ? (
                <>
                  <label className="cash-period-label" htmlFor="cash-target-period">Bulan terakhir yang dibayar</label>
                  <select
                    id="cash-target-period"
                    value={period}
                    onChange={(event) => void choosePeriod(event.target.value)}
                    disabled={loadingPreview || submitting}
                  >
                    <option value="">Pilih bulan</option>
                    {householdDetail.unpaidPeriods.map((due) => (
                      <option key={due.period} value={due.period}>{periodName(due.period)}</option>
                    ))}
                  </select>
                </>
              ) : null}
            </section>
          )}

          {loadingPreview && <p className="cash-inline-note" role="status">Menghitung bulan dan total…</p>}
          {preview && !confirming && (
            <section className="cash-payment-step cash-preview" aria-labelledby="cash-preview-title">
              <div className="cash-step-heading">
                <span className="cash-step-number">3</span>
                <div>
                  <h2 id="cash-preview-title">Tinjau rincian pembayaran</h2>
                  <p>Bulan lebih lama yang belum lunas ikut dibayar otomatis.</p>
                </div>
              </div>
              <HouseholdIdentity household={preview.household} />
              <ul className="cash-period-list">
                {preview.items.map((item) => (
                  <li key={item.period}>
                    <span>{periodName(item.period)}</span>
                    <strong>{rupiah(item.amount)}</strong>
                    {item.pendingConflict && <span className="cash-conflict-tag">Menunggu penyelesaian</span>}
                  </li>
                ))}
              </ul>
              <div className="cash-payment-total">
                <span>Total pembayaran tunai</span>
                <strong>{rupiah(preview.totalAmount)}</strong>
              </div>
              {preview.hasPendingConflict ? (
                <div className="cash-pending-conflict" role="alert">
                  Ada permintaan pembayaran yang masih menunggu untuk bulan ini. Selesaikan atau tolak/batalkan permintaan tersebut lebih dulu.
                </div>
              ) : (
                <button className="cash-primary-button" type="button" onClick={() => setConfirming(true)}>
                  Lanjut ke konfirmasi
                </button>
              )}
            </section>
          )}

          {preview && confirming && (
            <section className="cash-payment-step cash-confirmation" aria-labelledby="cash-confirm-title">
              <div className="cash-step-heading">
                <span className="cash-step-number">4</span>
                <div>
                  <h2 id="cash-confirm-title">Konfirmasi pembayaran tunai</h2>
                  <p>Pastikan rumah, bulan, dan jumlah pembayaran sudah benar.</p>
                </div>
              </div>
              <HouseholdIdentity household={preview.household} />
              <ul className="cash-period-list">
                {preview.items.map((item) => (
                  <li key={item.period}><span>{periodName(item.period)}</span><strong>{rupiah(item.amount)}</strong></li>
                ))}
              </ul>
              <div className="cash-payment-method"><span>Metode</span><strong>Tunai</strong></div>
              <div className="cash-payment-total">
                <span>Total yang akan dicatat</span>
                <strong>{rupiah(preview.totalAmount)}</strong>
              </div>
              <div className="cash-confirmation-note"><ShieldCheck size={19} aria-hidden="true" /> Jumlah diambil dari data iuran dan tidak dapat diubah.</div>
              <div className="cash-flow-actions">
                <button className="cash-secondary-button" type="button" onClick={() => setConfirming(false)} disabled={submitting}>
                  Periksa kembali
                </button>
                <button className="cash-primary-button" type="button" onClick={() => void confirmPayment()} disabled={submitting}>
                  {submitting ? "Mencatat pembayaran…" : "Konfirmasi pembayaran tunai"}
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {errorMessage && <p className="cash-payment-error" role="alert">{errorMessage}</p>}
    </section>
  );
}
