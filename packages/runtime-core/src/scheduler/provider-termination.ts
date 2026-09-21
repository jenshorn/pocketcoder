import type { WorkspaceDriver } from "../driver";
import type { WorkspaceRow, WorkspaceStore } from "../types";

type TerminationWorkspace = Pick<WorkspaceRow, "id" | "providerKind" | "providerRef">;

export async function stopWorkspaceProvider(
  store: Pick<WorkspaceStore, "updateWorkspace"> & { getWorkspace(id: string): Promise<TerminationWorkspace | null> },
  driver: Pick<WorkspaceDriver, "stop" | "remove" | "terminationEvidence">,
  workspace: TerminationWorkspace,
  graceSeconds: number,
  at: Date,
  remove = true,
) {
  if (!workspace.providerRef) return;
  const ref = { kind: workspace.providerKind ?? "", id: "", ...workspace.providerRef };
  await driver.stop(ref, graceSeconds);
  const evidence = await driver.terminationEvidence?.(ref);
  if (evidence) {
    const current = await store.getWorkspace(workspace.id);
    if (!current?.providerRef || current.providerRef.id !== workspace.providerRef.id)
      throw new Error("Termination provider changed");
    await store.updateWorkspace(
      workspace.id,
      {
        providerRef: { ...current.providerRef, terminationEvidence: evidence },
      },
      at,
    );
  }
  // Persist before removal: a crash can always retry while the Job still holds
  // the proof; once removed, the runtime row is the durable source.
  if (remove) await driver.remove(ref);
}
