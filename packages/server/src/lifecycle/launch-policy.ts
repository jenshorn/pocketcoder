import { readFileSync } from "node:fs";
import type { WorkspaceRow } from "@pstdio/pocketcoder-runtime-core";

export function launchPolicyConfig(env: Record<string, string | undefined>) {
  const url = env.POCKETCODER_LAUNCH_POLICY_URL;
  const tokenFile = env.POCKETCODER_LAUNCH_POLICY_TOKEN_FILE;
  if (!url && !tokenFile) return undefined;
  if (!url || !tokenFile) throw new Error("Launch policy requires both URL and token file");
  const parsed = new URL(url);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
  ) {
    throw new Error("Launch policy requires HTTPS or a loopback HTTP endpoint");
  }
  return { url, tokenFile };
}

export function createLaunchPolicy(url: string, token: string) {
  return async (
    workspace: Pick<WorkspaceRow, "id" | "principalId" | "externalId" | "templateName" | "launchMode" | "metadata">,
  ): Promise<boolean> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          principal_id: workspace.principalId,
          external_id: workspace.externalId,
          template_name: workspace.templateName,
          launch_mode: workspace.launchMode,
          metadata: workspace.metadata,
        }),
      });
      if (response.status !== 200) return false;
      const decision = await response.json();
      return (
        typeof decision === "object" &&
        decision !== null &&
        "allowed" in decision &&
        decision.allowed === true &&
        "workspace_id" in decision &&
        decision.workspace_id === workspace.id
      );
    } catch {
      // Never log authorization headers, workspace metadata or response bodies.
      return false;
    }
  };
}

export function loadLaunchPolicy(config: ReturnType<typeof launchPolicyConfig>) {
  if (!config) return undefined;
  const token = readFileSync(config.tokenFile, "utf8").trim();
  if (token.length < 24 || /\s/.test(token)) throw new Error("Invalid launch policy control token");
  return createLaunchPolicy(config.url, token);
}
