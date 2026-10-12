import { and, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { officialAssignments } from "@/db/schema";
export { jakartaBusinessDate } from "@/lib/time/jakarta";

export function officialAssignmentActiveOn(businessDate: string): SQL {
  return and(
    lte(officialAssignments.startsOn, businessDate),
    or(isNull(officialAssignments.endsOn), gte(officialAssignments.endsOn, businessDate)),
  )!;
}
