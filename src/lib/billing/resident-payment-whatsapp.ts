import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { appAccounts, officialAssignments, people } from "@/db/schema";
import type { ResidentPaymentRequestResult } from "@/lib/billing/resident-payment-request";
import { monthNames } from "@/lib/billing/resident-card";
import { officialAssignmentActiveOn } from "@/lib/officials/lifecycle";

function whatsappNumber(value: string | null) {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("62") || digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function periodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${monthNames[month - 1]} ${year}`;
}

function rupiah(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function createResidentPaymentWhatsAppLink(
  database: AppDatabase,
  input: {
    rtUnitId: string;
    houseNumber: string;
    residentName: string;
    request: ResidentPaymentRequestResult;
  },
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
      eq(officialAssignments.rtUnitId, input.rtUnitId),
      eq(officialAssignments.role, "treasurer"),
      officialAssignmentActiveOn(today),
    ))
    .limit(2);

  if (treasurers.length !== 1) return null;
  const destination = whatsappNumber(treasurers[0].phone);
  if (!destination) return null;

  const createdAt = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(input.request.createdAt);
  const message = [
    "Halo Bendahara, saya mengajukan pembayaran iuran.",
    `Nama: ${input.residentName}`,
    `Nomor rumah: ${input.houseNumber}`,
    `Bulan: ${input.request.periods.map(periodLabel).join(", ")}`,
    `Jumlah: ${rupiah(input.request.totalAmount)}`,
    `Waktu pengajuan: ${createdAt} WIB`,
    `Nomor pengajuan: ${input.request.requestCode}`,
  ].join("\n");
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
