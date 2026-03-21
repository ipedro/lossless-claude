import { describe, it, expect, vi } from "vitest";
import { runDoctor } from "../../src/doctor/doctor.js";
import { REQUIRED_HOOKS } from "../../installer/install.js";

// Mock ensureDaemon to prevent spawning real processes when daemon appears down
vi.mock("../../src/daemon/lifecycle.js", () => ({
  ensureDaemon: vi.fn().mockResolvedValue({ connected: false }),
}));

describe("doctor hook validation", () => {
  it("reports hooks as passing when they are absent from settings.json", async () => {
    const settings = JSON.stringify({ mcpServers: { "lcm": {} } });
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
    for (const { event } of REQUIRED_HOOKS) {
      expect(hookResult?.message).toContain(event);
    }
  });
});
