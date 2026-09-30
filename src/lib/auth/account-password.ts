import type { AccountType } from "@/db/schema";

export function isValidAccountPassword(type: AccountType, password: string) {
  return type !== "resident" || /^\d{6}$/.test(password);
}
