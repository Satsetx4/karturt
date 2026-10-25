import { and, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { officialAssignments } from "@/db/schema";

export function jakartaBusinessDate(now = new Date()) {
  const r3BusinessDate = process.env.KARTURT_R3_BUSINESS_DATE;
  if (r3BusinessDate !== undefined) {
    if (process.env.APP_ENV !== "staging" || process.env.DATABASE_ENV !== "staging") {
      throw new Error("KARTURT_R3_BUSINESS_DATE is allowed only when APP_ENV and DATABASE_ENV are staging.");
    }
    if (!/^[a-z0-9]{8,20}$/.test(process.env.KARTURT_R3_RUN_ID ?? "") ||
        !/^[A-Za-z0-9.#:/_-]{3,160}$/.test(process.env.KARTURT_R3_AUTHORIZATION_REF ?? "") ||
        !/^[0-9a-f]{40}$/.test(process.env.KARTURT_COMPILED_RELEASE_SHA ?? "")) {
      throw new Error("KARTURT_R3_BUSINESS_DATE requires a bounded R3 app identity and compiled release SHA.");
    }
    const parsedDate = Date.parse(`${r3BusinessDate}T00:00:00.000Z`);
    const year = Number(r3BusinessDate.slice(0, 4));
    const currentJakartaYear = Number(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
    }).format(now));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r3BusinessDate) || year < currentJakartaYear || year > currentJakartaYear + 1 || !Number.isFinite(parsedDate) ||
        new Date(parsedDate).toISOString().slice(0, 10) !== r3BusinessDate) {
      throw new Error("KARTURT_R3_BUSINESS_DATE must be a valid date in the current or next Jakarta calendar year.");
    }
    return r3BusinessDate;
  }

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
