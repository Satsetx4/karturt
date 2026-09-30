import { and, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { officialAssignments } from "@/db/schema";

export function jakartaBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function officialAssignmentActiveOn(businessDate: string): SQL {
  return and(
    lte(officialAssignments.startsOn, businessDate),
    or(isNull(officialAssignments.endsOn), gte(officialAssignments.endsOn, businessDate)),
  )!;
}
