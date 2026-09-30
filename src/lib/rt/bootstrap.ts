import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db/client";
import { rtSettings, rtUnits } from "@/db/schema";

export async function bootstrapRtUnit(database: AppDatabase, values: typeof rtUnits.$inferInsert) {
  return database.transaction(async (transaction) => {
    const [inserted] = await transaction
      .insert(rtUnits)
      .values(values)
      .onConflictDoNothing({ target: [rtUnits.code, rtUnits.rwCode, rtUnits.village] })
      .returning({ id: rtUnits.id });

    let id = inserted?.id;
    if (!id) {
      const [existing] = await transaction
        .select({ id: rtUnits.id })
        .from(rtUnits)
        .where(and(
          eq(rtUnits.code, values.code),
          eq(rtUnits.rwCode, values.rwCode),
          eq(rtUnits.village, values.village),
        ))
        .limit(1);
      id = existing?.id;
    }
    if (!id) throw new Error("RT unit could not be created or found after the insert.");

    await transaction
      .insert(rtSettings)
      .values({ rtUnitId: id })
      .onConflictDoNothing({ target: rtSettings.rtUnitId });
    return { id, created: Boolean(inserted) };
  });
}
