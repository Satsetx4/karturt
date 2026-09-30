import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { houses, households, people } from "@/db/schema";

export async function resolveResidentProvisioningTarget(
  database: AppDatabase,
  input: { rtUnitId: string; householdId: string; personId: string },
) {
  const [target] = await database
    .select({
      rtUnitId: households.rtUnitId,
      householdId: households.id,
      personId: people.id,
      houseNumber: houses.number,
    })
    .from(households)
    .innerJoin(houses, and(
      eq(houses.id, households.houseId),
      eq(houses.rtUnitId, households.rtUnitId),
    ))
    .innerJoin(people, and(
      eq(people.rtUnitId, households.rtUnitId),
      eq(people.householdId, households.id),
      eq(people.id, input.personId),
    ))
    .where(and(
      eq(households.id, input.householdId),
      eq(households.rtUnitId, input.rtUnitId),
      eq(households.status, "active"),
      eq(people.isActive, true),
    ))
    .limit(1);

  if (!target) throw new Error("Resident provisioning requires an active person and household in the selected RT.");
  return {
    rtUnitId: target.rtUnitId,
    householdId: target.householdId,
    personId: target.personId,
    loginIdentifier: target.houseNumber.trim().toUpperCase(),
  };
}
