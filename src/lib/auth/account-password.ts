import type { AccountType } from "@/db/schema";

export function isValidAccountPassword(type: AccountType, password: string) {
  if (type === "resident") return /^\d{6}$/.test(password);
  return password.length >= 16 && password.length <= 128;
}
