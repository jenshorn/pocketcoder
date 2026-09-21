import { expect, test } from "bun:test";
import { retainNodeIdentities } from "./kubernetes-evidence";

test.each([
  { mode: "replacement", error: "Termination provider changed", patches: 1, reads: 1 },
  { mode: "persistent", error: "Conflict", patches: 5, reads: 4 },
  { mode: "forbidden", error: "Forbidden", patches: 1, reads: 0 },
])("pod metadata retry fails closed: %j", async (expected) => {
  const { mode } = expected;
  const pod = {
    metadata: {
      name: "pod",
      uid: "original",
      resourceVersion: "1",
      finalizers: [],
      ownerReferences: [{ kind: "Job", uid: "job", controller: true }],
    },
    spec: { nodeName: "node" },
  };
  let patches = 0;
  let reads = 0;
  const run = async (args: string[]) => {
    if (args[0] === "get" && args[1] === "pods") return JSON.stringify({ items: [pod] });
    if (args[0] === "get" && args[1] === "pod") {
      reads++;
      return JSON.stringify({
        ...pod,
        metadata: { ...pod.metadata, uid: mode === "replacement" ? "other" : "original" },
      });
    }
    if (args[0] === "get" && args[1] === "node")
      return JSON.stringify({ metadata: { uid: "node" }, spec: { providerID: "aws:///zone/instance" } });
    if (args[0] === "patch" && args[1] === "pod") {
      patches++;
      throw new Error(`Error from server (${mode === "forbidden" ? "Forbidden" : "Conflict"})`);
    }
    throw new Error("Unexpected command");
  };
  await expect(retainNodeIdentities(run, "job", "job")).rejects.toThrow(expected.error);
  expect(patches).toBe(expected.patches);
  expect(reads).toBe(expected.reads);
});
