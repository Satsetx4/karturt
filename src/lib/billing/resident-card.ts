export type ResidentDue = { billingYear: number; month: number; amount: number; dueDate: string; status: "paid" | "unpaid" | "waived" | "not_due"; waivedReason: string | null };
export const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Pending verification belongs to future active payment requests (Phase 5).
export function dueToken(due: ResidentDue) {
  return due.status.toUpperCase() as "PAID" | "UNPAID" | "WAIVED" | "NOT_DUE";
}
export function yearMonths(dues: ResidentDue[], year: number) {
  return monthNames.map((name, index) => ({ name, month: index + 1, due: dues.find(d => d.billingYear === year && d.month === index + 1) }));
}
export function duesSummary(dues: ResidentDue[], _businessDate: string) {
  return dues.reduce((total, due) => ({
    paid: total.paid + (due.status === "paid" ? due.amount : 0),
    arrears: total.arrears + (due.status === "unpaid" && due.dueDate < _businessDate ? due.amount : 0),
    unpaid: total.unpaid + (due.status === "unpaid" ? due.amount : 0),
  }), { paid: 0, arrears: 0, unpaid: 0 });
}


