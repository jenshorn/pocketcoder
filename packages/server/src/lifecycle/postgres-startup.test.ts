import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { migrateDatabase, PostgresStore } from "@pstdio/pocketcoder-db";
import { fixtureTemplatePersistent } from "@pstdio/pocketcoder-testkit";
import { SQL } from "bun";
import { loadConfig } from "../config/config";
import { startPocketCoderServer } from "./lifecycle";

const databaseUrl = process.env.POCKETCODER_TEST_DATABASE_URL;
const dockerAvailable = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

describe.skipIf(!databaseUrl || !dockerAvailable)("PostgreSQL server lifecycle", () => {
  test.each([false, true])("starts and drains shutdown work (legacy=%s)", async (legacy) => {
    const schema = `startup_${randomUUID().slice(0, 8)}`;
    const sql = new SQL(databaseUrl as string);
    const store = new PostgresStore(databaseUrl as string, schema);
    const messages: string[] = [];
    let running: Awaited<ReturnType<typeof startPocketCoderServer>> | undefined;
    try {
      await migrateDatabase(sql, schema);
      await store.init();
      const parsed = fixtureTemplatePersistent();
      await store.upsertTemplate({
        name: parsed.manifest.metadata.name,
        version: parsed.manifest.spec.version,
        digest: parsed.digest,
        description: null,
        spec: parsed.manifest.spec,
      });
      if (legacy)
        await sql.unsafe(`UPDATE "${schema}".templates SET spec = $1::jsonb`, [JSON.stringify(parsed.manifest.spec)]);
      const config = {
        ...loadConfig({ POCKETCODER_DATABASE_URL: databaseUrl, POCKETCODER_AUTH_PEPPER: "disposable-test-pepper" }),
        databaseSchema: schema,
        listenHost: "127.0.0.1",
        listenPort: 0,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        running = await startPocketCoderServer(config, { log: (message) => messages.push(message) });
        expect((await fetch(`${running.url}/readyz`)).status).toBe(200);
        await running.stop();
        running = undefined;
      }
      expect(messages.filter((message) => message.includes("failed"))).toEqual([]);
    } finally {
      await running?.stop();
      await store.close();
      await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await sql.end();
    }
  });
});
