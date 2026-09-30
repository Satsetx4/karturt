import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../src/db/client";
import { rtSettings, rtUnits } from "../../src/db/schema";
import { bootstrapRtUnit } from "../../src/lib/rt/bootstrap";
import { createTestDatabase } from "../helpers/database";

describe("RT bootstrap", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => { testDatabase = await createTestDatabase(); });
  afterAll(async () => { if (testDatabase) await testDatabase.close(); });

  it("is repeat-safe and creates one settings row for the RT", async () => {
    const { db } = testDatabase;
    const values = { code: "RT-05", rwCode: "RW-04", name: "RT 05", village: "Jrebeng Wetan" };
    const first = await bootstrapRtUnit(db as unknown as AppDatabase, values);
    const retry = await bootstrapRtUnit(db as unknown as AppDatabase, values);
    const units = await db.select().from(rtUnits).where(eq(rtUnits.code, values.code));
    const settings = await db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, first.id));

    expect(first).toEqual({ id: first.id, created: true });
    expect(retry).toEqual({ id: first.id, created: false });
    expect(units).toHaveLength(1);
    expect(settings).toHaveLength(1);
  });

  it("keeps concurrent retries unique", async () => {
    const { db } = testDatabase;
    const values = { code: "RT-06", rwCode: "RW-04", name: "RT 06", village: "Jrebeng Wetan" };
    const results = await Promise.all([
      bootstrapRtUnit(db as unknown as AppDatabase, values),
      bootstrapRtUnit(db as unknown as AppDatabase, values),
    ]);
    const units = await db.select().from(rtUnits).where(eq(rtUnits.code, values.code));
    const settings = await db.select().from(rtSettings).where(eq(rtSettings.rtUnitId, results[0]!.id));

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(units).toHaveLength(1);
    expect(settings).toHaveLength(1);
  });
});
