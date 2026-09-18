import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "@pstdio/pocketcoder-db";
import { SQL } from "bun";
import { withStore } from "./cli-context";

const databaseUrl = process.env.POCKETCODER_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("operator store connections", () => {
  test("uses one connection and releases it after a command", async () => {
    const schema = `cli_pool_${randomUUID().replaceAll("-", "")}`;
    const observer = new SQL(databaseUrl as string, { max: 1 });
    const url = new URL(databaseUrl as string);
    url.searchParams.set("application_name", schema);
    const previousUrl = process.env.POCKETCODER_DATABASE_URL;
    const previousSchema = process.env.POCKETCODER_DATABASE_SCHEMA;
    try {
      await migrateDatabase(observer, schema);
      process.env.POCKETCODER_DATABASE_URL = url.href;
      process.env.POCKETCODER_DATABASE_SCHEMA = schema;
      await withStore(async (store) => {
        expect(await store.listPrincipals()).toEqual([]);
        // Let every eagerly opened connection finish authentication before counting.
        await Bun.sleep(100);
        const rows =
          await observer`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = ${schema}`;
        expect(rows[0].count).toBe(1);
      });
      const rows =
        await observer`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = ${schema}`;
      expect(rows[0].count).toBe(0);
    } finally {
      if (previousUrl === undefined) delete process.env.POCKETCODER_DATABASE_URL;
      else process.env.POCKETCODER_DATABASE_URL = previousUrl;
      if (previousSchema === undefined) delete process.env.POCKETCODER_DATABASE_SCHEMA;
      else process.env.POCKETCODER_DATABASE_SCHEMA = previousSchema;
      await observer.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await observer.end();
    }
  });
});
