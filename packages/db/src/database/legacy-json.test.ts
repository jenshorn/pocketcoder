import { describe, expect, test } from "bun:test";
import { createPostgresFixture, insertTestWorkspace, TEST_DATABASE_URL } from "../test-fixtures";

describe.skipIf(!TEST_DATABASE_URL)("legacy JSON records", () => {
  test("loads templates written with the 0.7.1 Bun SQL parameter encoding", async () => {
    const fixture = await createPostgresFixture("legacy_template");
    try {
      // 0.7.1 passed JSON.stringify(value) to Bun SQL with a jsonb parameter.
      await fixture.sql.unsafe(`UPDATE "${fixture.schema}".templates SET spec = $1::jsonb`, [
        JSON.stringify(fixture.template.spec),
      ]);
      const [shape] = await fixture.sql.unsafe(`SELECT jsonb_typeof(spec) AS kind FROM "${fixture.schema}".templates`);
      expect(shape.kind).toBe("string");
      expect(await fixture.store.listTemplates(null)).toEqual([fixture.template]);
      expect(await fixture.store.getTemplate(fixture.template.name)).toEqual(fixture.template);
      expect(await fixture.store.upsertTemplate(fixture.template)).toMatchObject({
        row: fixture.template,
        created: false,
        conflict: false,
      });
    } finally {
      await fixture.dispose();
    }
  });

  test("reads and filters legacy workspaces, then appends outputs without corrupting the map", async () => {
    const fixture = await createPostgresFixture("legacy_workspace");
    try {
      const workspace = await insertTestWorkspace(fixture, "legacy", { source: "upgrade" });
      await fixture.sql.unsafe(
        `UPDATE "${fixture.schema}".workspaces SET
         template_snapshot = $1::jsonb, metadata = $2::jsonb,
         health = $3::jsonb, launch_input = $4::jsonb, outputs = $5::jsonb WHERE id = $6`,
        [workspace.templateSnapshot, workspace.metadata, workspace.health, workspace.launchInput, { old: "42" }]
          .map((value) => JSON.stringify(value))
          .concat(workspace.id),
      );
      expect(await fixture.store.getWorkspace(workspace.id)).toMatchObject({
        ...workspace,
        outputs: { old: "42" },
      });
      expect(
        await fixture.store.listWorkspaces(fixture.principal.id, { metadata: { source: "upgrade" }, limit: 10 }),
      ).toHaveLength(1);
      for (const value of ["42", "true", "null", '{"valid":"string"}']) {
        await fixture.store.appendOutput({
          workspaceId: workspace.id,
          seq: 0,
          name: "new",
          value,
          occurredAt: new Date(),
        });
        expect((await fixture.store.getWorkspace(workspace.id))?.outputs).toEqual({ old: "42", new: value });
        expect((await fixture.store.listOutputs(workspace.id)).at(-1)?.value).toBe(value);
      }
    } finally {
      await fixture.dispose();
    }
  });
});
