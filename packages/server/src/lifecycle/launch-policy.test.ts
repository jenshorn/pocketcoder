import { expect, test } from "bun:test";
import { createLaunchPolicy } from "./launch-policy";

test.each(["allow", "deny", "wrong-workspace", "unavailable", "redirect", "malformed"])(
  "launch policy requires an explicit matching response: %s",
  async (mode) => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer synthetic-control-token");
        const body = (await request.json()) as { workspace_id: string };
        expect(body.workspace_id).toBe("generation");
        expect(body).not.toHaveProperty("launchInput");
        if (mode === "unavailable") return new Response("unavailable", { status: 503 });
        if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "/other" } });
        if (mode === "malformed") return new Response("not json");
        return Response.json({
          allowed: mode !== "deny",
          workspace_id: mode === "wrong-workspace" ? "other" : "generation",
        });
      },
    });
    try {
      const authorize = createLaunchPolicy(server.url.toString(), "synthetic-control-token");
      const workspace = {
        id: "generation",
        principalId: "principal",
        externalId: "task",
        templateName: "template",
        launchMode: "create" as const,
        metadata: {},
        launchInput: { bootstrap_code: "never-forward" },
      };
      expect(await authorize(workspace)).toBe(mode === "allow");
    } finally {
      server.stop(true);
    }
  },
);
