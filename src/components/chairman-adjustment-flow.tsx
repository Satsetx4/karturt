"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type Household = {
  id: string;
  houseNumber: string;
  residentLabel: string;
  status: string;
};

type DueAdjustment = {
  amountDelta: number;
  reason: string;
  createdAt: string;
};

type Due = {
  id: string;
  period: string;
  status: string;
  originalAmount: number;
  adjustmentTotal: number;
  effectiveTarget: number;
  activeReceived: number;
  outstanding: number;
  hasPendingRequest: boolean;
  adjustments: DueAdjustment[];
};

type HouseholdSearchResponse = { households: Household[] };
type HouseholdDetailResponse = { household: Household; dues: Due[] };
type AdjustmentResult = { idempotentReplay?: boolean };
type Direction = "increase" | "decrease";
type Attempt = { scope: string; key: string };
type RequestAction = "search" | "detail" | "submit";

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function safeMessage(status: number, action: RequestAction) {
  if (status === 401) return "Sesi berakhir. Masuk kembali untuk melanjutkan.";
  if (status === 403 || status === 404) return "Rumah atau tagihan tidak tersedia untuk akun ini.";
  if (status === 409 && action === "submit") {
    return "Data tagihan berubah atau ada permintaan pembayaran yang sedang menunggu. Muat ulang rincian sebelum mencoba lagi.";
  }
  if (status === 400 && action === "submit") return "Periksa nominal penyesuaian dan alasan sebelum mencoba lagi.";
  if (action === "search") return "Pencarian rumah belum dapat dimuat. Silakan coba lagi.";
  if (action === "detail") return "Rincian tagihan belum dapat dimuat. Silakan pilih rumah lagi.";
  return "Penyesuaian belum dapat dicatat. Coba lagi di halaman ini agar permintaan tetap memakai kunci yang sama.";
}

async function requestJson<T>(input: RequestInfo | URL, action: RequestAction, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(0, safeMessage(0, action));
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, safeMessage(response.status, action));
  if (!payload || typeof payload !== "object") throw new ApiError(0, safeMessage(0, action));
  return payload as T;
}

function rupiah(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) return "Jumlah tidak tersedia";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function signedRupiah(amount: number) {
  if (!Number.isSafeInteger(amount)) return "Jumlah tidak tersedia";
  if (amount === 0) return rupiah(0);
  return (amount > 0 ? "+" : "−") + " " + rupiah(Math.abs(amount));
}

function periodLabel(period: string) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) return "Periode tidak tersedia";
  const [year, month] = period.split("-").map(Number);
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

function idempotencyKey() {
  return crypto.randomUUID();
}

function statusLabel(status: string) {
  if (status === "paid") return "Sudah lunas";
  if (status === "unpaid") return "Belum lunas";
  if (status === "waived") return "Dibebaskan";
  if (status === "not_due") return "Tidak perlu bayar";
  return "Status belum tersedia";
}

function householdStatusLabel(status: string) {
  return status === "active" ? "Rumah aktif" : "Riwayat rumah";
}

function blockReason(due: Due) {
  if (due.hasPendingRequest) {
    return "Ada permintaan pembayaran yang masih menunggu. Penyesuaian diblokir agar nominal permintaan tetap sama.";
  }
  if (due.status === "waived") return "Tagihan ini sudah dibebaskan dan tidak dapat disesuaikan.";
  if (due.status === "not_due") return "Periode ini berada di luar kewajiban iuran.";
  if (due.status !== "paid" && due.status !== "unpaid") return "Tagihan ini belum dapat disesuaikan.";
  return "";
}

type Preview = {
  amountDelta: number;
  adjustmentTotal: number;
  effectiveTarget: number;
  outstanding: number;
  targetInvalid: boolean;
  wouldCreateCredit: boolean;
};

export function ChairmanAdjustmentFlow() {
  const [query, setQuery] = useState("");
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedHousehold, setSelectedHousehold] = useState<Household | null>(null);
  const [detail, setDetail] = useState<HouseholdDetailResponse | null>(null);
  const [selectedDueId, setSelectedDueId] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [direction, setDirection] = useState<Direction>("increase");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">("success");
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const url = "/api/chairman/adjustments/households?query=" + encodeURIComponent(normalizedQuery);
      void requestJson<HouseholdSearchResponse>(url, "search", { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setHouseholds(Array.isArray(result.households) ? result.households : []);
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setHouseholds([]);
            setDetailError(error instanceof Error ? error.message : safeMessage(0, "search"));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function loadHouseholdDetail(householdId: string, showLoading = true) {
    if (showLoading) setLoadingDetail(true);
    setDetailError("");
    try {
      const result = await requestJson<HouseholdDetailResponse>(
        "/api/chairman/adjustments/households/" + encodeURIComponent(householdId),
        "detail",
      );
      setDetail({
        household: result.household,
        dues: Array.isArray(result.dues) ? result.dues : [],
      });
      setSelectedHousehold(result.household);
      setSelectedDueId((current) =>
        current && result.dues.some((due) => due.id === current) ? current : "",
      );
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : safeMessage(0, "detail"));
    } finally {
      if (showLoading) setLoadingDetail(false);
    }
  }

  async function chooseHousehold(household: Household) {
    setSelectedHousehold(household);
    setDetail(null);
    setSelectedDueId("");
    setAmountText("");
    setReason("");
    setConfirming(false);
    setFeedback("");
    setDetailError("");
    await loadHouseholdDetail(household.id);
  }

  const selectedDue = detail?.dues.find((due) => due.id === selectedDueId) ?? null;
  const enteredMagnitude = amountText.trim() ? Number(amountText) : NaN;
  const amountDelta = Number.isSafeInteger(enteredMagnitude) && enteredMagnitude > 0
    ? direction === "increase" ? enteredMagnitude : -enteredMagnitude
    : null;
  let preview: Preview | null = null;
  if (selectedDue && amountDelta !== null) {
    const effectiveTarget = selectedDue.effectiveTarget + amountDelta;
    const outstanding = effectiveTarget - selectedDue.activeReceived;
    const adjustmentTotal = selectedDue.adjustmentTotal + amountDelta;
    preview = {
      amountDelta,
      adjustmentTotal,
      effectiveTarget,
      outstanding,
      targetInvalid: !Number.isSafeInteger(effectiveTarget) || effectiveTarget <= 0 ||
        !Number.isSafeInteger(adjustmentTotal),
      wouldCreateCredit: Number.isSafeInteger(outstanding) && outstanding < 0,
    };
  }
  const blockedReason = selectedDue ? blockReason(selectedDue) : "";
  const reasonText = reason.trim();
  const canReview = Boolean(
    selectedDue &&
    !blockedReason &&
    preview &&
    !preview.targetInvalid &&
    !preview.wouldCreateCredit &&
    Number.isSafeInteger(preview.outstanding) &&
    reasonText.length > 0 &&
    reasonText.length <= 500,
  );
  const previewError = preview?.targetInvalid
    ? "Target kewajiban setelah penyesuaian harus lebih besar dari Rp0."
    : preview?.wouldCreateCredit
      ? "Penyesuaian ini akan membuat pembayaran melebihi kewajiban. Ubah nominal agar tidak terbentuk saldo kredit."
      : "";

  function resetAdjustmentForm() {
    setDirection("increase");
    setAmountText("");
    setReason("");
    setConfirming(false);
    setFeedback("");
    attempt.current = null;
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDue || !canReview || !preview || inFlight.current) return;
    const body = {
      monthlyDueId: selectedDue.id,
      amountDelta: preview.amountDelta,
      reason: reasonText,
    };
    const scope = JSON.stringify(body);
    const key = attempt.current?.scope === scope
      ? attempt.current.key
      : idempotencyKey();
    attempt.current = { scope, key };
    inFlight.current = true;
    setSubmitting(true);
    setFeedback("");
    try {
      const result = await requestJson<AdjustmentResult>("/api/chairman/adjustments", "submit", {
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
        ? "Penyesuaian ini sudah tercatat sebelumnya."
        : "Penyesuaian berhasil dicatat.");
      setConfirming(false);
      setDirection("increase");
      setAmountText("");
      setReason("");
      if (selectedHousehold) {
        await loadHouseholdDetail(selectedHousehold.id, false);
      }
    } catch (error) {
      setFeedbackKind("error");
      setFeedback(error instanceof Error ? error.message : safeMessage(0, "submit"));
      if (error instanceof ApiError && error.status === 409 && selectedHousehold) {
        await loadHouseholdDetail(selectedHousehold.id, false);
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="chairman-adjustment-area" aria-labelledby="chairman-adjustment-title">
      <Link className="chairman-adjustment-back" href="/app">
        <ArrowLeft size={18} aria-hidden="true" /> Kembali ke ruang akun
      </Link>
      <div className="chairman-adjustment-heading">
        <p className="eyebrow">PENGELOLAAN KEWAJIBAN</p>
        <h1 id="chairman-adjustment-title">Penyesuaian kewajiban</h1>
        <p>Pilih rumah dan bulan untuk melihat perhitungan saldo sebelum mencatat perubahan.</p>
      </div>

      <section className="chairman-adjustment-panel" aria-labelledby="chairman-adjustment-search-title">
        <div className="chairman-adjustment-panel-heading">
          <span className="chairman-adjustment-icon"><SlidersHorizontal size={21} aria-hidden="true" /></span>
          <div>
            <h2 id="chairman-adjustment-search-title">Cari rumah</h2>
            <p>Penyesuaian hanya berlaku untuk tagihan pada RT ini.</p>
          </div>
        </div>
        <label className="chairman-adjustment-label" htmlFor="chairman-adjustment-search">Nomor rumah atau nama warga</label>
        <div className="chairman-adjustment-search">
          <Search size={19} aria-hidden="true" />
          <input
            id="chairman-adjustment-search"
            type="search"
            value={query}
            maxLength={80}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim()) {
                setSearching(true);
              } else {
                setHouseholds([]);
                setSearching(false);
              }
              setDetailError("");
            }}
            placeholder="Mulai ketik untuk mencari"
            autoComplete="off"
          />
        </div>
        {searching && <p className="chairman-adjustment-note" role="status">Mencari rumah…</p>}
        {!searching && query.trim() && households.length === 0 && !detailError && (
          <p className="chairman-adjustment-note" role="status">Belum ada rumah yang cocok.</p>
        )}
        {households.length > 0 && (
          <ul className="chairman-adjustment-households" aria-label="Hasil pencarian rumah">
            {households.map((household) => (
              <li key={household.id}>
                <button
                  className={"chairman-adjustment-household" + (selectedHousehold?.id === household.id ? " is-selected" : "")}
                  type="button"
                  onClick={() => void chooseHousehold(household)}
                  aria-pressed={selectedHousehold?.id === household.id}
                  disabled={loadingDetail}
                >
                  <span className="chairman-adjustment-household-icon"><Home size={19} aria-hidden="true" /></span>
                  <span className="chairman-adjustment-household-copy">
                    <strong>Rumah {household.houseNumber}</strong>
                    <span>{household.residentLabel || "Nama warga belum tersedia"}</span>
                    <small>{householdStatusLabel(household.status)}</small>
                  </span>
                  <ChevronRight size={19} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {detailError && <p className="chairman-adjustment-error" role="alert">{detailError}</p>}
      </section>

      {selectedHousehold && (
        <section className="chairman-adjustment-panel" aria-labelledby="chairman-adjustment-dues-title">
          <div className="chairman-adjustment-panel-heading">
            <span className="chairman-adjustment-icon"><Home size={21} aria-hidden="true" /></span>
            <div>
              <h2 id="chairman-adjustment-dues-title">Pilih tagihan</h2>
              <p>Rumah {selectedHousehold.houseNumber} · {selectedHousehold.residentLabel || "Nama warga belum tersedia"}</p>
            </div>
          </div>
          {loadingDetail ? (
            <p className="chairman-adjustment-note" role="status">Memuat tagihan dan riwayat penyesuaian…</p>
          ) : detail && detail.dues.length > 0 ? (
            <ul className="chairman-adjustment-dues" aria-label="Tagihan rumah">
              {detail.dues.map((due) => (
                <li key={due.id}>
                  <button
                    className={"chairman-adjustment-due" + (selectedDueId === due.id ? " is-selected" : "")}
                    type="button"
                    onClick={() => {
                      setSelectedDueId(due.id);
                      resetAdjustmentForm();
                    }}
                    aria-pressed={selectedDueId === due.id}
                  >
                    <span className="chairman-adjustment-due-copy">
                      <strong>{periodLabel(due.period)}</strong>
                      <span>{statusLabel(due.status)}</span>
                      {due.hasPendingRequest && <small>Menunggu konfirmasi pembayaran</small>}
                    </span>
                    <span className="chairman-adjustment-due-balance">
                      <small>Sisa kewajiban</small>
                      <b>{rupiah(due.outstanding)}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : detail ? (
            <p className="chairman-adjustment-note" role="status">Belum ada tagihan untuk rumah ini.</p>
          ) : null}

          {selectedDue && (
            <div className="chairman-adjustment-detail">
              <div className="chairman-adjustment-detail-heading">
                <div>
                  <p className="eyebrow">RINCIAN SALDO</p>
                  <h3>{periodLabel(selectedDue.period)}</h3>
                </div>
                <span className={"chairman-adjustment-status chairman-adjustment-status--" + selectedDue.status}>
                  {statusLabel(selectedDue.status)}
                </span>
              </div>

              <dl className="chairman-adjustment-balance">
                <div><dt>Nominal awal</dt><dd>{rupiah(selectedDue.originalAmount)}</dd></div>
                <div><dt>Total penyesuaian</dt><dd>{signedRupiah(selectedDue.adjustmentTotal)}</dd></div>
                <div><dt>Target efektif</dt><dd>{rupiah(selectedDue.effectiveTarget)}</dd></div>
                <div><dt>Sudah diterima</dt><dd>{rupiah(selectedDue.activeReceived)}</dd></div>
                <div className="chairman-adjustment-balance-total"><dt>Sisa kewajiban</dt><dd>{rupiah(selectedDue.outstanding)}</dd></div>
              </dl>

              {blockedReason ? (
                <div className="chairman-adjustment-block" role="status">
                  <AlertTriangle size={19} aria-hidden="true" />
                  <p>{blockedReason}</p>
                </div>
              ) : (
                <form className="chairman-adjustment-form" onSubmit={(event) => void submitAdjustment(event)}>
                  <fieldset disabled={confirming || submitting}>
                    <legend>Jenis penyesuaian</legend>
                    <div className="chairman-adjustment-directions">
                      <label className={direction === "increase" ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="adjustment-direction"
                          value="increase"
                          checked={direction === "increase"}
                          onChange={() => setDirection("increase")}
                        />
                        <span>Tambah kewajiban</span>
                      </label>
                      <label className={direction === "decrease" ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="adjustment-direction"
                          value="decrease"
                          checked={direction === "decrease"}
                          onChange={() => setDirection("decrease")}
                        />
                        <span>Kurangi kewajiban</span>
                      </label>
                    </div>

                    <label className="chairman-adjustment-label" htmlFor="chairman-adjustment-amount">Nominal perubahan</label>
                    <div className="chairman-adjustment-input-wrap">
                      <span aria-hidden="true">Rp</span>
                      <input
                        id="chairman-adjustment-amount"
                        type="number"
                        min="1"
                        max="2147483647"
                        step="1"
                        inputMode="numeric"
                        value={amountText}
                        onChange={(event) => {
                          setAmountText(event.target.value);
                          setConfirming(false);
                          setFeedback("");
                        }}
                        placeholder="Masukkan nominal"
                        required
                      />
                    </div>

                    <label className="chairman-adjustment-label" htmlFor="chairman-adjustment-reason">Alasan penyesuaian</label>
                    <textarea
                      id="chairman-adjustment-reason"
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value);
                        setConfirming(false);
                        setFeedback("");
                      }}
                      maxLength={500}
                      rows={4}
                      required
                      placeholder="Tuliskan alasan penyesuaian"
                      aria-describedby="chairman-adjustment-reason-help"
                    />
                    <p id="chairman-adjustment-reason-help" className="chairman-adjustment-note">
                      Alasan wajib diisi, maksimal 500 karakter. Sisa {500 - reason.length} karakter.
                    </p>
                  </fieldset>

                  {preview && (
                    <section className="chairman-adjustment-preview" aria-labelledby="chairman-adjustment-preview-title" aria-live="polite">
                      <div className="chairman-adjustment-preview-heading">
                        <h4 id="chairman-adjustment-preview-title">Perkiraan setelah penyesuaian</h4>
                        <strong>{signedRupiah(preview.amountDelta)}</strong>
                      </div>
                      <div className="chairman-adjustment-preview-columns">
                        <div>
                          <span>Sebelum</span>
                          <p>Target efektif <b>{rupiah(selectedDue.effectiveTarget)}</b></p>
                          <p>Sisa kewajiban <b>{rupiah(selectedDue.outstanding)}</b></p>
                        </div>
                        <div>
                          <span>Sesudah</span>
                          <p>Target efektif <b>{rupiah(preview.effectiveTarget)}</b></p>
                          <p>Sudah diterima <b>{rupiah(selectedDue.activeReceived)}</b></p>
                          <p>Sisa kewajiban <b>{rupiah(preview.outstanding)}</b></p>
                          <p>Status <b>{preview.outstanding === 0 ? "Sudah lunas" : "Belum lunas"}</b></p>
                        </div>
                      </div>
                      {previewError && <p className="chairman-adjustment-error" role="alert">{previewError}</p>}
                    </section>
                  )}

                  {!confirming ? (
                    <button
                      className="chairman-adjustment-primary"
                      type="button"
                      disabled={!canReview || loadingDetail}
                      onClick={() => {
                        setFeedback("");
                        setConfirming(true);
                      }}
                    >
                      Tinjau penyesuaian <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  ) : (
                    <section className="chairman-adjustment-confirm" aria-labelledby="chairman-adjustment-confirm-title">
                      <div className="chairman-adjustment-confirm-heading">
                        <CheckCircle2 size={21} aria-hidden="true" />
                        <div>
                          <h4 id="chairman-adjustment-confirm-title">Periksa sebelum mencatat</h4>
                          <p>Pastikan periode, nominal setelah perubahan, dan alasan sudah benar.</p>
                        </div>
                      </div>
                      <p><span>Periode</span><strong>{periodLabel(selectedDue.period)}</strong></p>
                      <p><span>Penyesuaian</span><strong>{signedRupiah(preview?.amountDelta ?? 0)}</strong></p>
                      <p><span>Target efektif sesudahnya</span><strong>{rupiah(preview?.effectiveTarget ?? 0)}</strong></p>
                      <p><span>Sisa kewajiban sesudahnya</span><strong>{rupiah(preview?.outstanding ?? 0)}</strong></p>
                      <div className="chairman-adjustment-confirm-reason">
                        <span>Alasan</span>
                        <p>{reasonText}</p>
                      </div>
                      <div className="chairman-adjustment-actions">
                        <button
                          className="chairman-adjustment-secondary"
                          type="button"
                          onClick={() => setConfirming(false)}
                          disabled={submitting}
                        >
                          Kembali mengubah
                        </button>
                        <button
                          className="chairman-adjustment-primary"
                          type="submit"
                          disabled={!canReview || submitting}
                        >
                          {submitting ? "Mencatat penyesuaian…" : "Konfirmasi penyesuaian"}
                        </button>
                      </div>
                    </section>
                  )}
                </form>
              )}

              {feedback && (
                <p className={feedbackKind === "success" ? "chairman-adjustment-feedback chairman-adjustment-feedback--success" : "chairman-adjustment-feedback"} role={feedbackKind === "success" ? "status" : "alert"}>
                  {feedback}
                </p>
              )}

              <section className="chairman-adjustment-history" aria-labelledby="chairman-adjustment-history-title">
                <div className="chairman-adjustment-history-heading">
                  <div>
                    <p className="eyebrow">CATATAN</p>
                    <h4 id="chairman-adjustment-history-title">Riwayat penyesuaian</h4>
                  </div>
                  <Clock3 size={20} aria-hidden="true" />
                </div>
                {selectedDue.adjustments.length > 0 ? (
                  <ol className="chairman-adjustment-history-list">
                    {selectedDue.adjustments.map((item, index) => (
                      <li key={item.createdAt + "-" + item.amountDelta + "-" + index}>
                        <div>
                          <strong>{signedRupiah(item.amountDelta)}</strong>
                          <time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>
                        </div>
                        <p>{item.reason}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="chairman-adjustment-note">Belum ada penyesuaian untuk tagihan ini.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
