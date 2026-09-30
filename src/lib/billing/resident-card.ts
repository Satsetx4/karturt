export type ResidentDue = {
  billingYear: number;
  month: number;
  amount: number;
  dueDate: string;
  status: "paid" | "unpaid" | "waived" | "not_due";
  paymentRequestStatus?: "pending" | "verified" | "rejected" | "cancelled" | null;
};
export type CurrentResidentStatusToken =
  | "PAID"
  | "UNPAID"
  | "WAIVED"
  | "NOT_DUE";
export type ResidentStatusToken = CurrentResidentStatusToken | "PENDING";

export const monthNames = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const domainStatusTokens: Record<
  ResidentDue["status"],
  CurrentResidentStatusToken
> = {
  paid: "PAID",
  unpaid: "UNPAID",
  waived: "WAIVED",
  not_due: "NOT_DUE",
};

export const residentStatusLabels: Record<ResidentStatusToken, string> = {
  PAID: "Sudah bayar",
  UNPAID: "Belum bayar",
  WAIVED: "Dibebaskan",
  NOT_DUE: "Tidak perlu bayar",
  PENDING: "Menunggu konfirmasi",
};

export function dueToken(due: ResidentDue): ResidentStatusToken {
  if (due.paymentRequestStatus === "pending") return "PENDING";
  return domainStatusTokens[due.status];
}

export function formatResidentDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(
    new Date(year, month - 1, day),
  );
}
export function yearMonths(dues: ResidentDue[], year: number) {
  return monthNames.map((name, index) => ({
    name,
    month: index + 1,
    due: dues.find((d) => d.billingYear === year && d.month === index + 1),
  }));
}
export function duesSummary(dues: ResidentDue[], _businessDate: string) {
  return dues.reduce(
    (total, due) => ({
      paid: total.paid + (due.status === "paid" ? due.amount : 0),
      arrears:
        total.arrears +
        (due.status === "unpaid" && due.dueDate < _businessDate
          ? due.amount
          : 0),
      unpaid: total.unpaid + (due.status === "unpaid" ? due.amount : 0),
    }),
    { paid: 0, arrears: 0, unpaid: 0 },
  );
}
