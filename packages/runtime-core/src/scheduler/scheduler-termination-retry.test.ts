import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { digestOf, snapshotOf } from "@pstdio/pocketcoder-contracts";
import { MemoryStore } from "@pstdio/pocketcoder-memory-store";
import { FakeDriver, fixtureTemplateEcho } from "@pstdio/pocketcoder-testkit";
import { DEFAULT_LIMITS, Scheduler, type WorkspaceDriver } from "../index";

for (const mode of ["finalize", "warm", "retain"] as const) {
  for (const failure of ["stop", "remove"] as const) {
    test(`${mode}: failed provider ${failure} holds capacity and retries after scheduler restart`, async () => {
      const store = new MemoryStore();
      const provider = new FakeDriver();
      let unavailable = true;
      let now = new Date("2026-09-16T12:00:00Z");
      const driver: WorkspaceDriver = {
        kind: provider.kind,
        create: (launch) => provider.create(launch),
        createWarm: (launch) => provider.createWarm(launch),
        inspect: (ref) => provider.inspect(ref),
        list: () => provider.list(),
        listWarm: () => provider.listWarm(),
        stop: async (ref) => {
          if (failure === "stop" && unavailable) throw new Error("provider unavailable");
          await provider.stop(ref);
        },
        remove: async (ref) => {
          if (failure === "remove" && unavailable) throw new Error("provider unavailable");
          await provider.remove(ref);
        },
      };
      const principal = await store.createPrincipal("test", ["admin"], ["*"]);
      const parsed = fixtureTemplateEcho();
      if (mode === "retain") parsed.manifest.spec.persistence.checkpoint.onFailure = "retain-for-recovery";
      const template = (
        await store.upsertTemplate({
          name: parsed.manifest.metadata.name,
          version: parsed.manifest.spec.version,
          digest: parsed.digest,
          description: null,
          spec: parsed.manifest.spec,
        })
      ).row;
      const queue = async () => {
        const id = randomUUID();
        const result = await store.insertWorkspace({
          id,
          principalId: principal.id,
          externalId: id,
          idempotencyKey: id,
          requestDigest: digestOf({ id }),
          templateId: template.id,
          templateSnapshot: snapshotOf(parsed),
          launchInput: {},
          metadata: {},
          deadlineAt: new Date(now.getTime() + 3600000),
          createdAt: now,
        });
        if (result.kind === "capacity_exceeded") throw new Error("unexpected capacity");
        return result.workspace;
      };
      const deps = {
        store,
        driver,
        now: () => now,
        onError: () => {},
        connections: {
          isConnected: () => false,
          shutdown: () => false,
          signal: () => false,
          close: () => {},
        },
        secrets: {
          generate: () => randomUUID(),
          digest: (s: string) => new TextEncoder().encode(s),
        },
        limits: { ...DEFAULT_LIMITS, globalActiveWorkspaces: 1 },
        workspaceServerUrl: "http://localhost",
      };
      const scheduler = new Scheduler(deps);
      const first = await queue();
      await scheduler.tick();
      const active = await store.getWorkspace(first.id);
      if (!active) throw new Error("missing workspace");
      if (mode === "warm") {
        await store.updateWorkspace(
          first.id,
          {
            provisioningMode: "warm",
            registrationExpiresAt: new Date(now.getTime() - 1),
          },
          now,
        );
        await scheduler.sweep();
        expect((await store.getWorkspace(first.id))?.state).toBe("provisioning");
        expect((await store.getWorkspace(first.id))?.providerRef).toEqual(active.providerRef);
        unavailable = false;
        await new Scheduler(deps).sweep();
        expect((await store.getWorkspace(first.id))?.state).toBe("queued");
        expect(await provider.list()).toEqual([]);
        return;
      }
      if (mode === "retain") {
        await store.insertWorkspaceStorage({
          id: randomUUID(),
          workspaceId: first.id,
          principalId: principal.id,
          providerKind: "fake",
          providerRef: { kind: "fake", id: "storage" },
          state: "ready",
          mountManifest: [],
          logicalBytes: null,
          fileCount: null,
          retainedUntil: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          lastErrorCode: null,
        });
      }
      await scheduler.finalize(active, "failed", "child_exit_failure", now, mode === "retain");
      if (mode === "retain") expect((await store.getWorkspaceStorage(first.id))?.state).toBe("ready");
      expect((await store.getWorkspace(first.id))?.state).toBe("terminating");
      expect((await store.getWorkspace(first.id))?.terminalIntent).toBe("failed");
      const next = await queue();
      await scheduler.admit();
      expect((await store.getWorkspace(next.id))?.state).toBe("queued");
      unavailable = false;
      now = new Date(now.getTime() + 120000);
      await new Scheduler(deps).tick();
      expect((await store.getWorkspace(first.id))?.state).toBe("failed");
      if (mode === "retain") expect((await store.getWorkspaceStorage(first.id))?.state).toBe("retained");
      expect((await store.getWorkspace(first.id))?.reasonCode).toBe("child_exit_failure");
      expect((await store.getWorkspace(next.id))?.state).toBe("provisioning");
      expect((await provider.list()).map((row) => row.workspaceId)).toEqual([next.id]);
    });
  }
}
