import { describe, expect, it } from "vitest";
import {
  dueToken,
  duesSummary,
  yearMonths,
  type ResidentDue,
} from "../../src/lib/billing/resident-card";
const due = (status: ResidentDue["status"], month: number): ResidentDue => ({
  status,
  month,
  billingYear: 2026,
  amount: status === "not_due" ? 0 : 40000,
  dueDate: `2026-${String(month).padStart(2, "0")}-10`,
  waivedReason: status === "waived" ? "Decision" : null,
});
describe("resident card semantics", () => {
  it("retains UNPAID before due date; never fabricates pending verification", () => {
    expect(dueToken(due("unpaid", 12))).toBe("UNPAID");
  });
  it("distinguishes waiver and absent obligation", () => {
    expect(dueToken(due("waived", 1))).toBe("WAIVED");
    expect(dueToken(due("not_due", 2))).toBe("NOT_DUE");
  });
  it("excludes waived/not due/future from arrears, includes future in unpaid", () => {
    expect(
      duesSummary(
        [
          due("waived", 1),
          due("not_due", 2),
          due("paid", 3),
          due("unpaid", 4),
          due("unpaid", 12),
        ],
        "2026-06-15",
      ),
    ).toEqual({ paid: 40000, arrears: 40000, unpaid: 80000 });
  });
  it("does not call a due overdue on day 10", () => {
    expect(duesSummary([due("unpaid", 6)], "2026-06-10").arrears).toBe(0);
  });
  it("renders Jan-Dec in order and preserves missing records without assigning NOT_DUE", () => {
    const months = yearMonths([due("unpaid", 12), due("paid", 1)], 2026);
    expect(months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(months[1].due).toBeUndefined();
    expect(months[11].due?.status).toBe("unpaid");
    expect(yearMonths([due("paid", 1)], 2025).every((m) => !m.due)).toBe(true);
  });
});
