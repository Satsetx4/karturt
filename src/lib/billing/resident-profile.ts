import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { houses, households, people, rtUnits } from "@/db/schema";
import type { Principal } from "@/lib/auth/permissions";
import { assertCanPerform } from "@/lib/auth/permissions";
export async function getResidentProfile(
  database: AppDatabase,
  principal: Principal,
) {
  if (
    principal.role !== "resident" ||
    !principal.rtUnitId ||
    !principal.householdId ||
    !principal.personId
  )
    throw new Error("Forbidden: resident profile only.");
  assertCanPerform(principal, "billing:read:self", {
    rtUnitId: principal.rtUnitId,
    householdId: principal.householdId,
  });
  const [profile] = await database
    .select({
      name: people.fullName,
      houseNumber: houses.number,
      rtName: rtUnits.name,
      startsOn: households.startsOn,
    })
    .from(households)
    .innerJoin(
      houses,
      and(
        eq(houses.id, households.houseId),
        eq(houses.rtUnitId, households.rtUnitId),
      ),
    )
    .innerJoin(
      people,
      and(
        eq(people.householdId, households.id),
        eq(people.rtUnitId, households.rtUnitId),
        eq(people.id, principal.personId),
      ),
    )
    .innerJoin(rtUnits, eq(rtUnits.id, households.rtUnitId))
    .where(
      and(
        eq(households.id, principal.householdId),
        eq(households.rtUnitId, principal.rtUnitId),
      ),
    )
    .limit(1);
  if (!profile) throw new Error("Resident profile unavailable.");
  return profile;
}
