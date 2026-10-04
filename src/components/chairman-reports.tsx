"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarDays, ChartPie, RotateCcw } from "lucide-react";
import type { RtFinancialReportResponse } from "@/lib/reports/rt-financial-report";

type ReportAmounts = RtFinancialReportResponse["yearly"];
type ChairmanReport = RtFinancialReportResponse;

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const integerFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

function rupiah(amount: number) {
  return Number.isSafeInteger(amount) && amount >= 0
    ? currencyFormat.format(amount)
    : "Jumlah tidak tersedia";
}

function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Tanggal tidak tersedia";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return "Tanggal tidak tersedia";
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isReportAmounts(value: unknown): value is ReportAmounts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<keyof ReportAmounts, unknown>;
  const safeFields = [
    candidate.target,
    candidate.effectiveTarget,
    candidate.received,
    candidate.transferReceived,
    candidate.cashReceived,
    candidate.waived,
    candidate.outstanding,
    candidate.obligationCount,
    candidate.waivedCount,
    candidate.notDueCount,
    candidate.overdueCount,
  ].every(isSafeCount);
  if (!safeFields) return false;
  const methodTotal = Number(candidate.transferReceived) + Number(candidate.cashReceived);
  const obligationTotal = Number(candidate.received) + Number(candidate.waived) + Number(candidate.outstanding);
  return Number.isSafeInteger(methodTotal) &&
    Number.isSafeInteger(obligationTotal) &&
    methodTotal === candidate.received &&
    obligationTotal === candidate.effectiveTarget;
}

function isChairmanReport(value: unknown, expectedYear: number): value is ChairmanReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChairmanReport>;
  if (
    candidate.year !== expectedYear ||
    !Array.isArray(candidate.availableYears) ||
    !candidate.availableYears.every((year) => isSafeCount(year) && year >= 2000 && year <= 2200) ||
    !isReportAmounts(candidate.yearly) ||
    !Array.isArray(candidate.monthly) ||
    candidate.monthly.length !== 12 ||
    !candidate.monthly.every((month, index) =>
      Boolean(month) &&
      month.month === index + 1 &&
      isReportAmounts(month)
    )
  ) {
    return false;
  }

  const arrears = candidate.arrears;
  if (
    !arrears ||
    !isSafeCount(arrears.totalOutstanding) ||
    !isSafeCount(arrears.count) ||
    !isSafeCount(arrears.householdCount) ||
    !Array.isArray(arrears.households)
  ) {
    return false;
  }

  const arrearsHouseholdsAreValid = arrears.households.every((household) =>
    Boolean(household) &&
    typeof household.houseNumber === "string" &&
    (typeof household.houseLabel === "string" || household.houseLabel === null) &&
    Array.isArray(household.residentNames) &&
    household.residentNames.every((name) => typeof name === "string") &&
    (household.lifecycle === "active" || household.lifecycle === "historical") &&
    typeof household.startsOn === "string" &&
    (typeof household.endsOn === "string" || household.endsOn === null) &&
    isSafeCount(household.totalOutstanding) &&
    typeof household.pending === "boolean" &&
    Array.isArray(household.periods) &&
    household.periods.every((period) =>
      Boolean(period) &&
      isSafeCount(period.month) &&
      period.month >= 1 && period.month <= 12 &&
      typeof period.dueDate === "string" &&
      isSafeCount(period.outstanding) &&
      typeof period.pending === "boolean"
    )
  );
  if (!arrearsHouseholdsAreValid || arrears.householdCount !== arrears.households.length) return false;

  const amountFields = [
    "target",
    "effectiveTarget",
    "received",
    "transferReceived",
    "cashReceived",
    "waived",
    "outstanding",
    "obligationCount",
    "waivedCount",
    "notDueCount",
    "overdueCount",
  ] as const;
  for (const field of amountFields) {
    let total = 0;
    for (const month of candidate.monthly) {
      total += month[field];
      if (!Number.isSafeInteger(total)) return false;
    }
    if (total !== candidate.yearly[field]) return false;
  }

  let arrearsTotal = 0;
  let arrearsCount = 0;
  for (const household of arrears.households) {
    let householdTotal = 0;
    for (const period of household.periods) {
      householdTotal += period.outstanding;
      arrearsCount += 1;
      if (!Number.isSafeInteger(householdTotal) || !Number.isSafeInteger(arrearsCount)) return false;
    }
    if (householdTotal !== household.totalOutstanding) return false;
    arrearsTotal += householdTotal;
    if (!Number.isSafeInteger(arrearsTotal)) return false;
  }
  return arrearsTotal === arrears.totalOutstanding && arrearsCount === arrears.count;
}

function safeErrorMessage(status: number): string {
  if (status === 401) return "Sesi Anda berakhir. Masuk kembali untuk melihat laporan.";
  if (status === 403 || status === 404) return "Laporan tidak tersedia untuk akun ini.";
  if (status === 400) return "Tahun laporan tidak dapat dibaca. Pilih tahun yang tersedia.";
  return "Laporan belum dapat dimuat. Periksa koneksi lalu coba lagi.";
}

function Metric({ label, amount, count, countUnit }: { label: string; amount?: number; count?: number; countUnit?: string }) {
  return (
    <div className="chairman-report-metric">
      <dt>{label}</dt>
      <dd>{amount === undefined ? `${integerFormat.format(count ?? 0)}${countUnit ? ` ${countUnit}` : ""}` : rupiah(amount)}</dd>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="chairman-report-loading" role="status" aria-live="polite">
      <span className="chairman-report-spinner" aria-hidden="true" />
      <span>Memuat laporan…</span>
    </div>
  );
}

function retryButton(onClick: () => void) {
  return (
    <button className="chairman-report-button" type="button" onClick={onClick}>
      <RotateCcw size={17} aria-hidden="true" />
      Coba lagi
    </button>
  );
}

export function ChairmanReports({
  initialYear,
  autoSelectAvailableYear,
}: {
  initialYear: number;
  autoSelectAvailableYear: boolean;
}) {
  const router = useRouter();
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [data, setData] = useState<ChairmanReport | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const autoSelectRef = useRef(autoSelectAvailableYear);

  useEffect(() => {
    if (autoSelectAvailableYear) {
      router.replace(`/app/laporan?year=${initialYear}`, { scroll: false });
    }
  }, [autoSelectAvailableYear, initialYear, router]);

  useEffect(() => {
    const controller = new AbortController();
    let selectingDefaultYear = false;
    async function loadReport() {
      setData(null);
      setError("");
      setLoading(true);
      try {
        const response = await fetch(`/api/chairman/reports?year=${selectedYear}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(safeErrorMessage(response.status));
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new Error(safeErrorMessage(500));
        }
        if (!isChairmanReport(payload, selectedYear)) throw new Error(safeErrorMessage(500));
        setAvailableYears(payload.availableYears);

        if (
          autoSelectRef.current &&
          payload.availableYears.length > 0 &&
          !payload.availableYears.includes(selectedYear)
        ) {
          const newestYear = Math.max(...payload.availableYears);
          autoSelectRef.current = false;
          selectingDefaultYear = true;
          setSelectedYear(newestYear);
          router.replace(`/app/laporan?year=${newestYear}`, { scroll: false });
          return;
        }

        autoSelectRef.current = false;
        setData(payload);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          const allowedMessages = [400, 401, 403, 500].map(safeErrorMessage);
          setError(loadError instanceof Error && allowedMessages.includes(loadError.message)
            ? loadError.message
            : safeErrorMessage(500));
        }
      } finally {
        if (!controller.signal.aborted && !selectingDefaultYear) setLoading(false);
      }
    }
    void loadReport();
    return () => controller.abort();
  }, [retryToken, router, selectedYear]);

  function changeYear(event: ChangeEvent<HTMLSelectElement>) {
    const nextYear = Number(event.target.value);
    if (!Number.isInteger(nextYear) || nextYear < 2000 || nextYear > 2200) return;
    autoSelectRef.current = false;
    setData(null);
    setError("");
    setLoading(true);
    setSelectedYear(nextYear);
    router.replace(`/app/laporan?year=${nextYear}`, { scroll: false });
  }

  function retry() {
    setError("");
    setLoading(true);
    setRetryToken((token) => token + 1);
  }

  const years = [...new Set([selectedYear, ...availableYears])]
    .sort((left, right) => right - left);
  const hasYearData = Boolean(data && (data.yearly.obligationCount > 0 || data.yearly.notDueCount > 0));

  return (
    <section className="chairman-reports-area" aria-labelledby="chairman-reports-title" aria-busy={loading}>
      <div className="chairman-reports-heading">
        <p className="eyebrow">LAPORAN IURAN</p>
        <h1 id="chairman-reports-title">Laporan iuran</h1>
        <p>Ringkasan pemasukan dan kewajiban berdasarkan bulan tagihan.</p>
      </div>

      <div className="chairman-report-year-panel">
        <div className="chairman-report-year-icon" aria-hidden="true"><CalendarDays size={21} /></div>
        <div className="chairman-report-year-copy">
          <label htmlFor="chairman-report-year">Tahun laporan</label>
          <select
            id="chairman-report-year"
            value={selectedYear}
            onChange={changeYear}
            disabled={loading && availableYears.length === 0}
          >
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
      </div>

      {loading && <ReportSkeleton />}

      {error && (
        <div className="chairman-report-alert" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          <p>{error}</p>
          {retryButton(retry)}
        </div>
      )}

      {data && !loading && !error && (
        <>
          {!hasYearData && (
            <div className="chairman-report-empty" role="status">
              <ChartPie size={24} aria-hidden="true" />
              <div>
                <strong>Belum ada data tagihan untuk {data.year}.</strong>
                <p>Ringkasan periode di bawah ini tetap ditampilkan dengan nilai yang tersedia.</p>
              </div>
            </div>
          )}

          <section className="chairman-report-panel" aria-labelledby="chairman-report-summary-title">
            <div className="chairman-report-panel-heading">
              <div>
                <p className="eyebrow">TAHUN {data.year}</p>
                <h2 id="chairman-report-summary-title">Ringkasan tahunan</h2>
              </div>
            </div>
            <dl className="chairman-report-metrics">
              <Metric label="Target awal" amount={data.yearly.target} />
              <Metric label="Target efektif" amount={data.yearly.effectiveTarget} />
              <Metric label="Diterima" amount={data.yearly.received} />
              <Metric label="Belum diterima" amount={data.yearly.outstanding} />
              <Metric label="Transfer" amount={data.yearly.transferReceived} />
              <Metric label="Tunai" amount={data.yearly.cashReceived} />
              <Metric label="Dibebaskan" amount={data.yearly.waived} />
              <Metric label="Tidak ditagih" count={data.yearly.notDueCount} countUnit="tagihan" />
            </dl>
            <p className="chairman-report-identity">
              Diterima + dibebaskan + belum diterima = target efektif.
              <span>{rupiah(data.yearly.received)} + {rupiah(data.yearly.waived)} + {rupiah(data.yearly.outstanding)} = {rupiah(data.yearly.effectiveTarget)}</span>
            </p>
            <p className="chairman-report-identity">
              Transfer + tunai = diterima.
              <span>{rupiah(data.yearly.transferReceived)} + {rupiah(data.yearly.cashReceived)} = {rupiah(data.yearly.received)}</span>
            </p>
          </section>

          <section className="chairman-report-section" aria-labelledby="chairman-report-monthly-title">
            <div className="chairman-report-section-heading">
              <div>
                <p className="eyebrow">PERIODE TAGIHAN</p>
                <h2 id="chairman-report-monthly-title">Rincian bulanan</h2>
              </div>
              <span className="chairman-report-section-note">Januari–Desember {data.year}</span>
            </div>
            <div className="chairman-report-month-list">
              {data.monthly.map((month) => (
                <article className="chairman-report-month-card" key={`${data.year}-${month.month}`}>
                  <header className="chairman-report-month-heading">
                    <h3>{monthNames[month.month - 1]}</h3>
                    <div className="chairman-report-badges">
                      {month.notDueCount > 0 && <span className="chairman-report-badge is-not-due">Tidak ditagih · {integerFormat.format(month.notDueCount)}</span>}
                      {month.waivedCount > 0 && <span className="chairman-report-badge is-waived">Dibebaskan · {integerFormat.format(month.waivedCount)}</span>}
                      {month.overdueCount > 0 && <span className="chairman-report-badge is-overdue">Tunggakan · {integerFormat.format(month.overdueCount)}</span>}
                    </div>
                  </header>
                  <dl className="chairman-report-metrics chairman-report-metrics--month">
                    <Metric label="Target awal" amount={month.target} />
                    <Metric label="Target efektif" amount={month.effectiveTarget} />
                    <Metric label="Diterima" amount={month.received} />
                    <Metric label="Transfer" amount={month.transferReceived} />
                    <Metric label="Tunai" amount={month.cashReceived} />
                    <Metric label="Dibebaskan" amount={month.waived} />
                    <Metric label="Belum diterima" amount={month.outstanding} />
                  </dl>
                  <p className="chairman-report-identity">
                    Transfer + tunai = diterima.
                    <span>{rupiah(month.transferReceived)} + {rupiah(month.cashReceived)} = {rupiah(month.received)}</span>
                  </p>
                  <p className="chairman-report-identity">
                    Diterima + dibebaskan + belum diterima = target efektif.
                    <span>{rupiah(month.received)} + {rupiah(month.waived)} + {rupiah(month.outstanding)} = {rupiah(month.effectiveTarget)}</span>
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="chairman-report-section" aria-labelledby="chairman-report-arrears-title">
            <div className="chairman-report-section-heading">
              <div>
                <p className="eyebrow">LEWAT JATUH TEMPO</p>
                <h2 id="chairman-report-arrears-title">Tunggakan</h2>
              </div>
              <span className="chairman-report-arrears-total">{rupiah(data.arrears.totalOutstanding)}</span>
            </div>
            <p className="chairman-report-arrears-note">
              {integerFormat.format(data.arrears.count)} periode tunggakan pada {integerFormat.format(data.arrears.householdCount)} rumah tangga.
            </p>
            {data.arrears.households.length === 0 ? (
              <div className="chairman-report-empty chairman-report-empty--compact" role="status">
                <div>
                  <strong>Tidak ada tunggakan yang melewati jatuh tempo.</strong>
                  <p>Tagihan yang belum jatuh tempo tidak dihitung sebagai tunggakan.</p>
                </div>
              </div>
            ) : (
              <div className="chairman-report-arrears-list">
                {data.arrears.households.map((household, householdIndex) => (
                  <article
                    className="chairman-report-household-card"
                    key={`${household.houseNumber}-${household.startsOn}-${householdIndex}`}
                  >
                    <header className="chairman-report-household-heading">
                      <div className="chairman-report-household-title">
                        <h3>Rumah {household.houseNumber}{household.houseLabel ? ` · ${household.houseLabel}` : ""}</h3>
                        <p>{household.residentNames.length > 0 ? household.residentNames.join(", ") : "Nama warga tidak tercatat"}</p>
                      </div>
                      <span className={`chairman-report-lifecycle${household.lifecycle === "active" ? " is-active" : " is-historical"}`}>
                        {household.lifecycle === "active" ? "Aktif" : "Riwayat"}
                      </span>
                    </header>
                    <div className="chairman-report-household-facts">
                      <span>Masa tinggal</span>
                      <strong>{dateLabel(household.startsOn)}{household.endsOn ? ` – ${dateLabel(household.endsOn)}` : " – sekarang"}</strong>
                    </div>
                    {household.pending && <p className="chairman-report-household-pending">Menunggu konfirmasi</p>}
                    <ul className="chairman-report-period-list">
                      {household.periods.map((period) => (
                        <li key={`${period.month}-${period.dueDate}`}>
                          <div>
                            <strong>{monthNames[period.month - 1]} {data.year}</strong>
                            <span>Jatuh tempo {dateLabel(period.dueDate)}</span>
                            {period.pending && <span className="chairman-report-pending-badge">Menunggu konfirmasi</span>}
                          </div>
                          <strong className="chairman-report-period-amount">{rupiah(period.outstanding)}</strong>
                        </li>
                      ))}
                    </ul>
                    <div className="chairman-report-household-total">
                      <span>Total tunggakan rumah tangga</span>
                      <strong>{rupiah(household.totalOutstanding)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
