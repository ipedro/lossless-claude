import { describe, it, expect, vi } from "vitest";
import { runDoctor } from "../../src/doctor/doctor.js";
import { REQUIRED_HOOKS } from "../../installer/install.js";

describe("doctor hook validation", () => {
  it("reports all 4 hooks as passing when all present", async () => {
    const allHooks: Record<string, any[]> = {};
    for (const { event, command } of REQUIRED_HOOKS) {
      allHooks[event] = [{ matcher: "", hooks: [{ type: "command", command }] }];
    }
    const settings = JSON.stringify({ hooks: allHooks, mcpServers: { "lossless-claude": {} } });
    const results = await runDoctor({
      existsSync: () => true,
      readFileSync: (p: string) => {
        if (p.endsWith("config.json")) return JSON.stringify({ llm: { provider: "claude-process" } });
        if (p.endsWith("settings.json")) return settings;
        if (p.endsWith("package.json")) return JSON.stringify({ version: "0.5.0" });
        return "{}";
      },
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      fetch: vi.fn().mockResolvedValue({ ok: false }),
      homedir: "/tmp/test-home",
      platform: "darwin",
    });
    const hookResult = results.find(r => r.name === "hooks");
    expect(hookResult?.status).toBe("pass");
    expect(hookResult?.message).toContain("SessionEnd");
    expect(hookResult?.message).toContain("UserPromptSubmit");
  });
});
