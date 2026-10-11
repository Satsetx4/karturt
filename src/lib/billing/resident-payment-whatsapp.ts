import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, officialAssignments, people } from "@/db/schema";
import type { ResidentPaymentRequestResult } from "@/lib/billing/resident-payment-request";
import { monthNames } from "@/lib/billing/resident-card";
import { jakartaBusinessDate, officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

export type ResidentPaymentWhatsAppSnapshot = Pick<
  ResidentPaymentRequestResult,
  "requestCode" | "status" | "periods" | "totalAmount" | "createdAt"
>;

function whatsappNumber(value: string | null | undefined) {
  if (!value || !/^\+?[\d()\s-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (!digits.startsWith("62") || digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function periodLabel(period: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return null;
  return monthNames[Number(match[2]) - 1] + " " + match[1];
}

function rupiah(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Read only the active Treasurer of the authenticated Resident's RT, never a client-supplied target. */
export async function getResidentTreasurerWhatsAppNumber(database: AppDatabase, rtUnitId: string) {
  const treasurers = await database
    .select({ phone: people.phone })
    .from(officialAssignments)
    .innerJoin(appAccounts, and(
      eq(appAccounts.id, officialAssignments.appAccountId),
      eq(appAccounts.rtUnitId, officialAssignments.rtUnitId),
      eq(appAccounts.accountType, "official"),
      eq(appAccounts.status, "active"),
    ))
    .innerJoin(people, and(
      eq(people.id, appAccounts.personId),
      eq(people.rtUnitId, appAccounts.rtUnitId),
      eq(people.isActive, true),
    ))
    .where(and(
      eq(officialAssignments.rtUnitId, rtUnitId),
      eq(officialAssignments.role, "treasurer"),
      officialAssignmentActiveOn(jakartaBusinessDate()),
    ))
    .limit(2);

  if (treasurers.length !== 1) return null;
  return whatsappNumber(treasurers[0].phone);
}

/** Build a link for a resident to open manually. Pending is never proof that money was received. */
export function createResidentPaymentWhatsAppUrl(input: {
  destinationNumber: string | null | undefined;
  houseNumber: string;
  residentName: string;
  request: ResidentPaymentWhatsAppSnapshot;
}) {
  if (input.request.status !== "pending") return null;
  const destination = whatsappNumber(input.destinationNumber);
  const code = input.request.requestCode;
  if (!destination || !/^KRT-[A-F0-9]{16}$/.test(code)) return null;
  if (!input.houseNumber.trim() || !input.residentName.trim()) return null;
  const periods = input.request.periods.map(periodLabel);
  if (periods.length === 0 || periods.some((period) => !period) ||
      new Set(input.request.periods).size !== periods.length) return null;
  const amount = rupiah(input.request.totalAmount);
  if (!amount || !Number.isFinite(input.request.createdAt.getTime())) return null;

  const createdAt = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(input.request.createdAt);
  const message = [
    "Halo Bendahara, saya meminta konfirmasi atas pengajuan pembayaran iuran.",
    "Status permintaan masih menunggu verifikasi Bendahara.",
    "Nama: " + input.residentName,
    "Nomor rumah: " + input.houseNumber,
    "Bulan: " + periods.join(", "),
    "Jumlah pengajuan: " + amount,
    "Waktu pengajuan: " + createdAt + " WIB",
    "Nomor pengajuan: " + code,
  ].join("\n");
  return "https://wa.me/" + destination + "?text=" + encodeURIComponent(message);
}

export async function createResidentPaymentWhatsAppLink(
  database: AppDatabase,
  input: {
    rtUnitId: string;
    houseNumber: string;
    residentName: string;
    request: ResidentPaymentWhatsAppSnapshot;
  },
) {
  if (input.request.status !== "pending") return null;
  const destinationNumber = await getResidentTreasurerWhatsAppNumber(database, input.rtUnitId);
  return createResidentPaymentWhatsAppUrl({ destinationNumber, ...input });
}
