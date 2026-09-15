import type { StorageRef } from "@pstdio/pocketcoder-runtime-core";
import type { PersistenceContext } from "./persistence-base";

// A successful preserve leaves a redundant source allocation. Keep it until
// every checkpoint using it has been deleted; failed preserves keep their data.
export async function cleanupPreservedStorage(context: PersistenceContext, storageId: string) {
  const { store, driver } = context.deps;
  const storage = await store.getStorage(storageId);
  if (storage?.state !== "retained") return;
  if (storage.lastErrorCode && storage.lastErrorCode !== "storage_cleanup_failed") return;
  const workspace = await store.getWorkspace(storage.workspaceId);
  if (workspace?.state !== "preserved" || !workspace.terminalAt) return;
  const checkpoints = (await store.listCheckpoints(storage.principalId)).filter(
    (checkpoint) => checkpoint.storageId === storage.id,
  );
  if (checkpoints.length === 0 || checkpoints.some((checkpoint) => checkpoint.state !== "deleted")) return;
  const checkpointIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  const operations = await store.listIncompleteOperations();
  if (
    operations.some(
      (operation) =>
        operation.workspaceId === workspace.id ||
        operation.resultWorkspaceId === workspace.id ||
        (operation.checkpointId !== null && checkpointIds.has(operation.checkpointId)),
    )
  )
    return;

  try {
    // Provider removal may still be finishing even though preserve is terminal.
    if ((await driver.list()).some((provider) => provider.workspaceId === workspace.id)) return;
    await context.storageDriver().deleteStorage(storage.providerRef as StorageRef);
    const now = context.now();
    await store.updateWorkspaceStorage(
      storage.id,
      {
        state: "deleted",
        deletedAt: now,
        retainedUntil: null,
        lastErrorCode: null,
      },
      now,
    );
  } catch (error) {
    await store.updateWorkspaceStorage(storage.id, { lastErrorCode: "storage_cleanup_failed" }, context.now());
    context.deps.log?.(`storage cleanup ${storage.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
