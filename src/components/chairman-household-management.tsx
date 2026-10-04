"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Home,
  KeyRound,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  UserRound,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";

type HouseholdResident = {
  personId: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  residentAccountId: string | null;
};

type HouseholdSummary = {
  householdId: string;
  houseId: string;
  houseNumber: string;
  houseLabel: string | null;
  status: string;
  startsOn: string;
  endsOn: string | null;
  residents: HouseholdResident[];
  financialHistory: {
    dueCount: number;
    unpaidCount: number;
    paidCount: number;
    waivedCount: number;
    notDueCount: number;
    outstandingAmount: number;
    arrearsAmount: number;
  };
};

type HouseOption = { houseId: string; houseNumber: string; houseLabel: string | null };
type HouseholdResponse = { households: HouseholdSummary[]; availableHouses: HouseOption[] };
type FormTarget = { kind: "create" }
  | { kind: "edit" | "reset"; household: HouseholdSummary; resident: HouseholdResident }
  | { kind: "deactivate" | "replace"; household: HouseholdSummary };

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function jakartaYearMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function jakartaBusinessDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextJakartaMonth() {
  const current = jakartaYearMonth();
  const [year, month] = current.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "Periode tidak tersedia";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "Periode tidak tersedia";
  return `${monthNames[month - 1]} ${year}`;
}

function dateLabel(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Belum ditetapkan";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function rupiah(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) return "Jumlah tidak tersedia";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function safeError(status: number, kind: "load" | "save") {
  if (status === 401) return "Sesi berakhir. Silakan masuk kembali untuk melanjutkan.";
  if (status === 403 || status === 404) return "Data atau akses untuk tindakan ini tidak tersedia.";
  if (status === 409) return "Data berubah atau periode memiliki riwayat yang perlu dipertahankan. Muat ulang dan tinjau kembali.";
  if (status === 400 || status === 415) return "Periksa kembali isian dan formatnya, lalu coba lagi.";
  return kind === "load"
    ? "Daftar rumah dan warga belum dapat dimuat. Silakan coba lagi."
    : "Perubahan belum dapat disimpan. Silakan coba lagi.";
}

async function sendJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new Error(safeError(0, init?.method ? "save" : "load"));
  }
  if (!response.ok) throw new Error(safeError(response.status, init?.method ? "save" : "load"));
  try {
    return await response.json() as T;
  } catch {
    throw new Error(safeError(0, init?.method ? "save" : "load"));
  }
}

function isHouseholdResponse(value: unknown): value is HouseholdResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HouseholdResponse>;
  return Array.isArray(candidate.households) && Array.isArray(candidate.availableHouses);
}

export function ChairmanHouseholdManagement() {
  const [data, setData] = useState<HouseholdResponse>({ households: [], availableHouses: [] });
  const [query, setQuery] = useState("");
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">("success");
  const [reloadToken, setReloadToken] = useState(0);
  const [createHouseId, setCreateHouseId] = useState("");
  const [createNumber, setCreateNumber] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [createStartsOn, setCreateStartsOn] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createPin, setCreatePin] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [deactivateMonth, setDeactivateMonth] = useState("");
  const [deactivateReason, setDeactivateReason] = useState("");
  const [replaceMonth, setReplaceMonth] = useState("");
  const [replaceName, setReplaceName] = useState("");
  const [replacePhone, setReplacePhone] = useState("");
  const [replacePin, setReplacePin] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [resetPin, setResetPin] = useState("");
  const [resetReason, setResetReason] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const search = query.trim();
        const url = search
          ? `/api/chairman/households?search=${encodeURIComponent(search)}`
          : "/api/chairman/households";
        const result = await sendJson<unknown>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isHouseholdResponse(result)) throw new Error(safeError(0, "load"));
        setData(result);
        setLoadError("");
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : safeError(0, "load"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [reloadToken, query]);

  function clearForm() {
    setFormTarget(null);
    setConfirming(false);
    setCreatePin("");
    setReplacePin("");
    setResetPin("");
    setCreateName("");
    setCreatePhone("");
    setCreateNumber("");
    setCreateLabel("");
    setCreateStartsOn("");
    setEditName("");
    setEditPhone("");
    setEditLabel("");
    setDeactivateReason("");
    setDeactivateMonth("");
    setReplaceName("");
    setReplacePhone("");
    setReplaceMonth("");
    setReplaceReason("");
    setResetReason("");
  }

  function openCreate() {
    setFeedback("");
    clearForm();
    setCreateStartsOn(jakartaBusinessDateValue());
    setCreateHouseId(data.availableHouses[0]?.houseId ?? "new");
    setFormTarget({ kind: "create" });
  }

  function openAction(kind: "edit" | "reset", household: HouseholdSummary, resident: HouseholdResident): void;
  function openAction(kind: "deactivate" | "replace", household: HouseholdSummary): void;
  function openAction(kind: "edit" | "deactivate" | "replace" | "reset", household: HouseholdSummary, resident?: HouseholdResident) {
    setFeedback("");
    clearForm();
    if (kind === "edit" && resident) {
      setEditName(resident.fullName);
      setEditPhone(resident.phone ?? "");
      setEditLabel(household.houseLabel ?? "");
    }
    if (kind === "deactivate") setDeactivateMonth(jakartaYearMonth());
    if (kind === "replace") setReplaceMonth(nextJakartaMonth());
    if ((kind === "edit" || kind === "reset") && resident) setFormTarget({ kind, household, resident });
    else if (kind === "deactivate" || kind === "replace") setFormTarget({ kind, household });
  }

  async function perform(url: string, body: Record<string, unknown>, success: string, method: "POST" | "PATCH" = "POST") {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFeedback("");
    try {
      await sendJson(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setFeedbackKind("success");
      setFeedback(success);
      clearForm();
      setLoading(true);
      setLoadError("");
      setReloadToken((value) => value + 1);
    } catch (error) {
      setFeedbackKind("error");
      setFeedback(error instanceof Error ? error.message : safeError(0, "save"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !createStartsOn) return;
    const body: Record<string, unknown> = {
      startsOn: createStartsOn,
      fullName: createName.trim(),
      phone: createPhone.trim(),
      initialPin: createPin,
    };
    if (createHouseId === "new") {
      body.newHouse = { number: createNumber.trim(), label: createLabel.trim() };
    } else {
      body.houseId = createHouseId;
    }
    await perform("/api/chairman/households", body, "Rumah dan akun warga berhasil dibuat.");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formTarget?.kind !== "edit") return;
    await perform(
      `/api/chairman/households/${encodeURIComponent(formTarget.household.householdId)}?personId=${encodeURIComponent(formTarget.resident.personId)}`,
      { fullName: editName.trim(), phone: editPhone.trim(), houseLabel: editLabel.trim() },
      "Perubahan data warga berhasil disimpan.",
      "PATCH",
    );
  }

  async function submitDeactivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formTarget?.kind !== "deactivate") return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await perform(
      `/api/chairman/households/${encodeURIComponent(formTarget.household.householdId)}/deactivate`,
      { activeThroughMonth: deactivateMonth, reason: deactivateReason.trim() },
      "Masa rumah warga berhasil ditutup. Riwayat tetap tersimpan.",
    );
  }

  async function submitReplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formTarget?.kind !== "replace") return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await perform(
      `/api/chairman/households/${encodeURIComponent(formTarget.household.householdId)}/replace`,
      { effectiveMonth: replaceMonth, fullName: replaceName.trim(), phone: replacePhone.trim(), initialPin: replacePin, reason: replaceReason.trim() },
      "Pergantian warga berhasil dicatat. Riwayat lama tetap pada rumah tangga sebelumnya.",
    );
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formTarget?.kind !== "reset" || !formTarget.resident.residentAccountId) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await perform(
      `/api/residents/${encodeURIComponent(formTarget.resident.residentAccountId)}/reset-pin`,
      { pin: resetPin, reason: resetReason.trim() },
      "PIN baru berhasil ditetapkan. Sesi warga sebelumnya sudah dicabut.",
    );
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
  const filteredHouseholds = data.households.filter((household) => {
    const residentText = household.residents.flatMap((resident) => [resident.fullName, resident.phone]);
    const haystack = [household.houseNumber, household.houseLabel, ...residentText]
      .filter(Boolean).join(" ").toLocaleLowerCase("id-ID");
    return haystack.includes(normalizedQuery);
  });
  const isCreate = formTarget?.kind === "create";
  const activeTarget = formTarget && formTarget.kind !== "create" ? formTarget.household : null;
  const useNewHouse = createHouseId === "new" || data.availableHouses.length === 0;

  return (
    <section className="chairman-household-area" aria-labelledby="chairman-household-title">
      <Link className="chairman-household-back" href="/app">
        <ArrowLeft size={18} aria-hidden="true" /> Kembali ke ruang akun
      </Link>
      <div className="chairman-household-heading">
        <p className="eyebrow">DATA WARGA</p>
        <h1 id="chairman-household-title">Rumah dan warga</h1>
        <p>Kelola masa tinggal warga sambil menjaga riwayat tagihan dan pembayaran tetap melekat pada rumah tangga yang benar.</p>
      </div>

      <div className="chairman-household-notice" role="note">
        <ShieldAlert size={21} aria-hidden="true" />
        <div>
          <strong>Riwayat lama tetap tersimpan</strong>
          <p>Penggantian warga tidak memindahkan tunggakan. Menutup masa tinggal juga bukan pemutihan.</p>
        </div>
      </div>

      {feedback && <p className={`chairman-household-feedback chairman-household-feedback--${feedbackKind}`} role={feedbackKind === "error" ? "alert" : "status"}>{feedback}</p>}

      <section className="chairman-household-panel" aria-labelledby="chairman-household-list-title">
        <div className="chairman-household-panel-heading">
          <span className="chairman-household-icon"><Home size={21} aria-hidden="true" /></span>
          <div>
            <h2 id="chairman-household-list-title">Daftar rumah tangga</h2>
            <p>Riwayat tinggal, tunggakan, dan aktivitas pembayaran tampil per masa rumah tangga.</p>
          </div>
        </div>
        <div className="chairman-household-toolbar">
          <label className="chairman-household-search">
            <Search size={19} aria-hidden="true" />
            <span className="sr-only">Cari nomor rumah atau nama warga</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari rumah atau nama warga" />
          </label>
          <button className="chairman-household-primary" type="button" onClick={openCreate} disabled={loading || submitting}>
            <Plus size={18} aria-hidden="true" /> Tambah warga
          </button>
        </div>

        {loading ? <p className="chairman-household-note" role="status">Memuat daftar rumah dan warga…</p> : loadError ? (
          <div className="chairman-household-alert" role="alert">
            <p>{loadError}</p>
            <button className="chairman-household-secondary" type="button" onClick={() => { setLoading(true); setLoadError(""); setReloadToken((value) => value + 1); }}>Muat ulang</button>
          </div>
        ) : data.households.length === 0 ? (
          <div className="chairman-household-empty">
            <UserRoundPlus size={26} aria-hidden="true" />
            <h3>Belum ada rumah tangga</h3>
            <p>Tambahkan warga pertama untuk memulai pencatatan masa tinggal dan tagihan.</p>
            <button className="chairman-household-primary" type="button" onClick={openCreate}><Plus size={18} aria-hidden="true" /> Tambah warga</button>
          </div>
        ) : filteredHouseholds.length === 0 ? (
          <p className="chairman-household-note" role="status">Tidak ada rumah atau warga yang cocok dengan pencarian.</p>
        ) : (
          <ul className="chairman-household-list">
            {filteredHouseholds.map((household) => {
              const active = household.status === "active";
              return (
                <li key={household.householdId}>
                  <article className="chairman-household-card">
                    <div className="chairman-household-card-heading">
                      <span className="chairman-household-home-icon"><Home size={20} aria-hidden="true" /></span>
                      <div className="chairman-household-card-title">
                        <h3>{household.houseLabel?.trim() || `Rumah ${household.houseNumber}`}</h3>
                        <p>{household.residents.length === 1 ? household.residents[0].fullName : `${household.residents.length} warga tercatat`}</p>
                      </div>
                      <span className={`chairman-household-status${active ? " is-active" : ""}`}>{active ? "Sedang aktif" : "Riwayat"}</span>
                    </div>
                    <dl className="chairman-household-facts">
                      <div><dt>Nomor rumah</dt><dd>{household.houseNumber}</dd></div>
                      <div><dt>Masa tinggal</dt><dd>{dateLabel(household.startsOn)}{household.endsOn ? ` – ${dateLabel(household.endsOn)}` : " – sekarang"}</dd></div>
                      <div><dt>Tunggakan lewat jatuh tempo</dt><dd>{rupiah(household.financialHistory.arrearsAmount)}</dd></div>
                      <div><dt>Tagihan lunas</dt><dd>{household.financialHistory.paidCount} periode</dd></div>
                    </dl>
                    <div className="chairman-household-residents" aria-label="Warga pada masa rumah tangga ini">
                      {household.residents.length === 0 ? <p className="chairman-household-note">Belum ada data warga untuk masa rumah tangga ini.</p> : household.residents.map((resident) => (
                        <div className="chairman-household-resident" key={resident.personId}>
                          <div className="chairman-household-resident-copy">
                            <strong>{resident.fullName}</strong>
                            <span>{resident.isActive ? "Warga aktif" : "Riwayat warga"}{resident.phone ? ` · ${resident.phone}` : ""}</span>
                          </div>
                          {active && resident.isActive && <div className="chairman-household-resident-actions">
                            <button type="button" className="chairman-household-secondary" onClick={() => openAction("edit", household, resident)} disabled={submitting}><Pencil size={17} aria-hidden="true" /> Ubah data</button>
                            {resident.residentAccountId && <button type="button" className="chairman-household-secondary" onClick={() => openAction("reset", household, resident)} disabled={submitting}><KeyRound size={17} aria-hidden="true" /> Atur PIN</button>}
                          </div>}
                        </div>
                      ))}
                    </div>
                    {active && (
                      <div className="chairman-household-actions" aria-label={`Tindakan untuk rumah ${household.houseNumber}`}>
                        <button type="button" className="chairman-household-secondary" onClick={() => openAction("replace", household)} disabled={submitting}><UserRound size={17} aria-hidden="true" /> Ganti warga</button>
                        <button type="button" className="chairman-household-danger" onClick={() => openAction("deactivate", household)} disabled={submitting}><UserRoundX size={17} aria-hidden="true" /> Tutup masa tinggal</button>
                      </div>
                    )}
                  </article>
                  {activeTarget?.householdId === household.householdId && renderActionForm()}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isCreate && (
        <section className="chairman-household-panel chairman-household-form-panel" aria-labelledby="chairman-household-create-title">
          <div className="chairman-household-panel-heading">
            <span className="chairman-household-icon"><UserRoundPlus size={21} aria-hidden="true" /></span>
            <div><h2 id="chairman-household-create-title">Tambah rumah dan warga</h2><p>Buat catatan baru tanpa mengganti riwayat rumah tangga sebelumnya.</p></div>
          </div>
          <form className="chairman-household-form" onSubmit={(event) => void submitCreate(event)}>
            <label htmlFor="household-existing-house">Rumah</label>
            <select id="household-existing-house" value={createHouseId} onChange={(event) => setCreateHouseId(event.target.value)} disabled={submitting}>
              {data.availableHouses.map((house) => <option key={house.houseId} value={house.houseId}>{house.houseLabel?.trim() || `Rumah ${house.houseNumber}`} · {house.houseNumber}</option>)}
              <option value="new">Tambah nomor rumah baru</option>
            </select>
            {useNewHouse && <>
              <label htmlFor="household-new-number">Nomor rumah</label>
              <input id="household-new-number" value={createNumber} onChange={(event) => setCreateNumber(event.target.value)} maxLength={40} required autoComplete="off" />
              <label htmlFor="household-new-label">Label rumah <span>(opsional)</span></label>
              <input id="household-new-label" value={createLabel} onChange={(event) => setCreateLabel(event.target.value)} maxLength={120} autoComplete="off" />
            </>}
            <label htmlFor="household-starts-on">Mulai tinggal</label>
            <input id="household-starts-on" type="date" value={createStartsOn} min={jakartaBusinessDateValue()} onChange={(event) => setCreateStartsOn(event.target.value)} required disabled={submitting} />
            <label htmlFor="household-create-name">Nama warga</label>
            <input id="household-create-name" value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={160} required autoComplete="name" disabled={submitting} />
            <label htmlFor="household-create-phone">Nomor telepon <span>(opsional)</span></label>
            <input id="household-create-phone" type="tel" value={createPhone} onChange={(event) => setCreatePhone(event.target.value)} maxLength={32} autoComplete="tel" disabled={submitting} />
            <label htmlFor="household-create-pin">PIN awal warga</label>
            <input id="household-create-pin" type="password" value={createPin} onChange={(event) => setCreatePin(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="\d{6}" minLength={6} maxLength={6} autoComplete="new-password" required disabled={submitting} />
            <p className="chairman-household-note">PIN harus tepat enam angka. PIN hanya digunakan untuk membuat kredensial dan tidak disimpan di perangkat ini.</p>
            <ActionButtons submitting={submitting} onCancel={clearForm} submitLabel="Buat rumah dan warga" />
          </form>
        </section>
      )}
    </section>
  );

  function renderActionForm() {
    if (!activeTarget || !formTarget || formTarget.kind === "create") return null;
    const household = activeTarget;
    const focusResident = formTarget.kind === "edit" || formTarget.kind === "reset" ? formTarget.resident : null;
    const residentNames = household.residents.map((resident) => resident.fullName).filter(Boolean).join(", ") || "warga rumah ini";
    const title = formTarget.kind === "edit" ? "Ubah data warga"
      : formTarget.kind === "deactivate" ? "Tutup masa tinggal"
        : formTarget.kind === "replace" ? "Ganti warga"
          : "Atur ulang PIN warga";
    return (
      <section className="chairman-household-inline-form" aria-label={title}>
        <div className="chairman-household-inline-heading"><h4>{title}</h4><button type="button" className="chairman-household-close" onClick={clearForm} aria-label="Tutup formulir" disabled={submitting}>Tutup</button></div>
        {formTarget.kind === "edit" && <form className="chairman-household-form" onSubmit={(event) => void submitEdit(event)}>
          <label htmlFor="household-edit-name">Nama warga</label><input id="household-edit-name" value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={160} required disabled={submitting} />
          <label htmlFor="household-edit-phone">Nomor telepon <span>(opsional)</span></label><input id="household-edit-phone" type="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} maxLength={32} disabled={submitting} />
          <label htmlFor="household-edit-label">Label rumah <span>(opsional)</span></label><input id="household-edit-label" value={editLabel} onChange={(event) => setEditLabel(event.target.value)} maxLength={120} disabled={submitting} />
          <ActionButtons submitting={submitting} onCancel={clearForm} submitLabel="Simpan perubahan" />
        </form>}
        {formTarget.kind === "deactivate" && <form className="chairman-household-form" onSubmit={(event) => void submitDeactivate(event)}>
          <p className="chairman-household-note">Tagihan sampai bulan yang dipilih tetap menjadi kewajiban rumah tangga ini. Tidak ada pemutihan otomatis.</p>
          <label htmlFor="household-deactivate-month">Bulan terakhir tinggal aktif</label><input id="household-deactivate-month" type="month" min={jakartaYearMonth()} value={deactivateMonth} onChange={(event) => { setDeactivateMonth(event.target.value); setConfirming(false); }} required disabled={submitting} />
          <label htmlFor="household-deactivate-reason">Alasan penutupan</label><textarea id="household-deactivate-reason" value={deactivateReason} onChange={(event) => { setDeactivateReason(event.target.value); setConfirming(false); }} minLength={1} maxLength={500} required disabled={submitting} />
          {confirming && <ConfirmBox title="Pastikan penutupan masa tinggal" text={`Masa tinggal ${residentNames} di ${household.houseNumber} berakhir setelah ${monthLabel(deactivateMonth)}. Riwayat dan tunggakan yang sudah ada tetap tersimpan.`} />}
          <ActionButtons submitting={submitting} confirming={confirming} onCancel={() => confirming ? setConfirming(false) : clearForm()} submitLabel="Tinjau penutupan" confirmLabel="Ya, tutup masa tinggal" danger />
        </form>}
        {formTarget.kind === "replace" && <form className="chairman-household-form" onSubmit={(event) => void submitReplace(event)}>
          <p className="chairman-household-note">Warga baru mendapat rumah tangga dan riwayat tagihan terpisah. Tunggakan lama tetap pada warga sebelumnya.</p>
          <label htmlFor="household-replace-month">Berlaku mulai bulan</label><input id="household-replace-month" type="month" min={nextJakartaMonth()} value={replaceMonth} onChange={(event) => { setReplaceMonth(event.target.value); setConfirming(false); }} required disabled={submitting} />
          <label htmlFor="household-replace-name">Nama warga baru</label><input id="household-replace-name" value={replaceName} onChange={(event) => { setReplaceName(event.target.value); setConfirming(false); }} maxLength={160} required disabled={submitting} />
          <label htmlFor="household-replace-phone">Nomor telepon <span>(opsional)</span></label><input id="household-replace-phone" type="tel" value={replacePhone} onChange={(event) => { setReplacePhone(event.target.value); setConfirming(false); }} maxLength={32} disabled={submitting} />
          <label htmlFor="household-replace-pin">PIN awal warga baru</label><input id="household-replace-pin" type="password" value={replacePin} onChange={(event) => { setReplacePin(event.target.value.replace(/\D/g, "").slice(0, 6)); setConfirming(false); }} inputMode="numeric" pattern="\d{6}" minLength={6} maxLength={6} autoComplete="new-password" required disabled={submitting} />
          <label htmlFor="household-replace-reason">Alasan penggantian</label><textarea id="household-replace-reason" value={replaceReason} onChange={(event) => { setReplaceReason(event.target.value); setConfirming(false); }} maxLength={500} required disabled={submitting} />
          {confirming && <ConfirmBox title="Konfirmasi pergantian warga" text={`Masa tinggal ${residentNames} berakhir pada akhir ${monthLabel(previousMonth(replaceMonth))}; warga baru mulai ${monthLabel(replaceMonth)}. Tunggakan dan pembayaran lama tidak dipindahkan.`} />}
          <ActionButtons submitting={submitting} confirming={confirming} onCancel={() => confirming ? setConfirming(false) : clearForm()} submitLabel="Tinjau pergantian" confirmLabel="Ya, ganti warga" danger />
        </form>}
        {formTarget.kind === "reset" && <form className="chairman-household-form" onSubmit={(event) => void submitReset(event)}>
          <p className="chairman-household-note">Sesi aktif warga akan dicabut. Warga perlu masuk kembali menggunakan PIN baru.</p>
          <label htmlFor="household-reset-pin">PIN baru</label><input id="household-reset-pin" type="password" value={resetPin} onChange={(event) => { setResetPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setConfirming(false); }} inputMode="numeric" pattern="\d{6}" minLength={6} maxLength={6} autoComplete="new-password" required disabled={submitting} />
          <label htmlFor="household-reset-reason">Alasan pengaturan PIN</label><textarea id="household-reset-reason" value={resetReason} onChange={(event) => { setResetReason(event.target.value); setConfirming(false); }} maxLength={500} required disabled={submitting} />
          {confirming && <ConfirmBox title="Konfirmasi pengaturan PIN" text={`PIN untuk ${focusResident?.fullName ?? "warga"} akan diganti dan sesi sebelumnya akan dicabut.`} />}
          <ActionButtons submitting={submitting} confirming={confirming} onCancel={() => confirming ? setConfirming(false) : clearForm()} submitLabel="Tinjau perubahan PIN" confirmLabel="Ya, atur PIN baru" danger />
        </form>}
      </section>
    );
  }
}

function previousMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ConfirmBox({ title, text }: { title: string; text: string }) {
  return <div className="chairman-household-confirm" role="group" aria-label={title}>
    <strong>{title}</strong>
    <p>{text}</p>
    <p className="chairman-household-note">Tindakan ini dicatat dan tidak menghapus riwayat keuangan.</p>
  </div>;
}

function ActionButtons({
  submitting,
  confirming = false,
  onCancel,
  submitLabel,
  confirmLabel,
  danger = false,
}: {
  submitting: boolean;
  confirming?: boolean;
  onCancel: () => void;
  submitLabel: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return <div className="chairman-household-form-actions">
    <button className="chairman-household-secondary" type="button" onClick={onCancel} disabled={submitting}>Batal</button>
    <button className={danger ? "chairman-household-danger" : "chairman-household-primary"} type="submit" disabled={submitting}>
      {submitting ? "Menyimpan…" : confirming ? confirmLabel : submitLabel}
      {!submitting && !confirming && <ArrowRight size={17} aria-hidden="true" />}
    </button>
  </div>;
}
