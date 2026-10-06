import { monthNames } from "@/lib/billing/resident-card";

export type ResidentPaymentWhatsAppRequest = {
  requestCode: string;
  status: "pending" | "verified" | "rejected" | "cancelled";
  periods: string[];
  totalAmount: number;
};

function whatsappNumber(value: string | null | undefined) {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("62") || digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function periodLabel(period: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return null;
  return `${monthNames[Number(match[2]) - 1]} ${match[1]}`;
}

function rupiah(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const formatted = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
  return formatted.replace(/^Rp[\s\u00a0]+/, "Rp");
}

function listPeriods(periods: string[]) {
  const labels = periods.map(periodLabel);
  if (labels.length === 0 || labels.some((label) => label === null)) return null;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")}, dan ${labels.at(-1)}`;
}

/** Build a manual WhatsApp deep link. The phone must come from demo-only server configuration. */
export function createResidentPaymentWhatsAppLink(input: {
  destinationNumber: string | null | undefined;
  rtName: string;
  houseNumber: string;
  request: ResidentPaymentWhatsAppRequest;
}) {
  if (input.request.status !== "pending") return null;
  const destination = whatsappNumber(input.destinationNumber);
  const periods = listPeriods(input.request.periods);
  const total = rupiah(input.request.totalAmount);
  if (!destination || !periods || !total || !input.rtName.trim() || !input.houseNumber.trim()) return null;

  const message = [
    `Halo Bendahara ${input.rtName}, saya dari rumah ${input.houseNumber} telah melakukan pembayaran iuran KartuRT untuk ${periods} sebesar ${total}.`,
    `Kode permintaan: ${input.request.requestCode}.`,
    "Mohon dilakukan verifikasi pembayaran. Terima kasih.",
  ].join(" ");
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
