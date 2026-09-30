import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

describe("legacy billing migration upgrade", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  it("converts legacy not-yet-resident waivers into zero-obligation NOT_DUE rows", async () => {
    const migrationFolder = resolve(process.cwd(), "drizzle");
    const migrations = readdirSync(migrationFolder)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const upgradeMigration = "0003_due_auth_audit_domain.sql";
    const priorMigrations = migrations.filter((name) => name < upgradeMigration);

    for (const name of priorMigrations) {
      await client.exec(readFileSync(resolve(migrationFolder, name), "utf8"));
    }

    const [rt] = (await client.query<{ id: string }>(`
      INSERT INTO rt_units (code, name, rw_code, village)
      VALUES ('RT-UPGRADE', 'Migration Upgrade RT', 'RW-UPGRADE', 'Village Upgrade')
      RETURNING id
    `)).rows;
    const [house] = (await client.query<{ id: string }>(`
      INSERT INTO houses (rt_unit_id, number) VALUES ($1, 'U-01') RETURNING id
    `, [rt!.id])).rows;
    const [household] = (await client.query<{ id: string }>(`
      INSERT INTO households (rt_unit_id, house_id, starts_on)
      VALUES ($1, $2, '2026-05-01') RETURNING id
    `, [rt!.id, house!.id])).rows;
    const [year] = (await client.query<{ id: string }>(`
      INSERT INTO billing_years (rt_unit_id, year, status) VALUES ($1, 2026, 'open') RETURNING id
    `, [rt!.id])).rows;
    const [due] = (await client.query<{ id: string }>(`
      INSERT INTO monthly_dues (
        rt_unit_id, household_id, billing_year_id, month, amount, due_date, status, waived_reason
      ) VALUES ($1, $2, $3, 1, 0, '2026-01-10', 'waived', 'not_yet_resident')
      RETURNING id
    `, [rt!.id, household!.id, year!.id])).rows;

    await client.exec(readFileSync(resolve(migrationFolder, upgradeMigration), "utf8"));

    const [migrated] = (await client.query<{ status: string; waived_reason: string | null }>(
      "SELECT status::text, waived_reason FROM monthly_dues WHERE id = $1",
      [due!.id],
    )).rows;
    expect(migrated).toEqual({ status: "not_due", waived_reason: null });
  });
});
