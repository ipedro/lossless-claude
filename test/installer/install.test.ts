import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mergeClaudeSettings,
  resolveBinaryPath,
  install,
  type ServiceDeps,
} from "../../installer/install.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSpawn(status = 0, stdout = "") {
  return vi.fn().mockReturnValue({ status, stdout, stderr: "", pid: 1, output: [], signal: null });
}

function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & {
  spawnSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  mkdirSync: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
  promptUser: ReturnType<typeof vi.fn>;
} {
  return {
    spawnSync: makeSpawn(),
    readFileSync: vi.fn().mockReturnValue("{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    promptUser: vi.fn().mockResolvedValue("1"), // default: option 1 (Anthropic)
    ...overrides,
  };
}

// ─── mergeClaudeSettings ────────────────────────────────────────────────────

describe("mergeClaudeSettings", () => {
  it("adds hooks and mcpServers to empty settings", () => {
    const r = mergeClaudeSettings({});
    expect(r.hooks.PreCompact[0]).toEqual({ matcher: "", hooks: [{ type: "command", command: "lossless-claude compact" }] });
    expect(r.hooks.SessionStart[0]).toEqual({ matcher: "", hooks: [{ type: "command", command: "lossless-claude restore" }] });
    expect(r.mcpServers["lossless-claude"]).toBeDefined();
  });

  it("preserves existing hooks", () => {
    const r = mergeClaudeSettings({ hooks: { PreCompact: [{ matcher: "", hooks: [{ type: "command", command: "other" }] }] } });
    expect(r.hooks.PreCompact).toHaveLength(2);
    expect(r.hooks.PreCompact[0].hooks[0].command).toBe("other");
  });

  it("does not duplicate if already present", () => {
    const r = mergeClaudeSettings({ hooks: { PreCompact: [{ matcher: "", hooks: [{ type: "command", command: "lossless-claude compact" }] }] } });
    expect(r.hooks.PreCompact).toHaveLength(1);
  });
});

// ─── resolveBinaryPath ──────────────────────────────────────────────────────

describe("resolveBinaryPath", () => {
  it("returns path from which when available", () => {
    const spawnMock = makeSpawn(0, "/usr/local/bin/lossless-claude\n");
    const deps = {
      spawnSync: spawnMock,
      existsSync: vi.fn().mockReturnValue(false),
    };
    expect(resolveBinaryPath(deps)).toBe("/usr/local/bin/lossless-claude");
    expect(spawnMock).toHaveBeenCalledWith("sh", ["-c", "command -v lossless-claude"], expect.anything());
  });

  it("falls back to ~/.npm-global/bin when which fails", () => {
    const npmGlobal = join(homedir(), ".npm-global", "bin", "lossless-claude");
    const deps = {
      spawnSync: makeSpawn(1, ""),
      existsSync: vi.fn().mockImplementation((p: string) => p === npmGlobal),
    };
    expect(resolveBinaryPath(deps)).toBe(npmGlobal);
  });

  it("returns bare binary name when nothing found", () => {
    const deps = {
      spawnSync: makeSpawn(1, ""),
      existsSync: vi.fn().mockReturnValue(false),
    };
    expect(resolveBinaryPath(deps)).toBe("lossless-claude");
  });
});

// ─── install ────────────────────────────────────────────────────────────────

describe("install", () => {
  it("accepts deps parameter and warns when cipher.yml is missing", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const deps = makeDeps({ existsSync: vi.fn().mockReturnValue(false) });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(install(deps)).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cipher.yml"));
    warnSpy.mockRestore();
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

it("writes config.json with provider=claude-cli and empty apiKey in non-TTY mode", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const writeFileMock = vi.fn();
    const deps = makeDeps({ existsSync: vi.fn().mockReturnValue(false), writeFileSync: writeFileMock });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    // Find the config.json write call
    const configWriteCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configWriteCall).toBeDefined();
    const written = JSON.parse(configWriteCall![1]);
    // Non-TTY path: defaults to claude-cli with empty apiKey
    expect(written.llm.provider).toBe("claude-cli");
    expect(written.llm.apiKey).toBe("");
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("invokes setup.sh as step 0 before other steps", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const spawnMock = makeSpawn(0);
    const deps = makeDeps({ spawnSync: spawnMock, existsSync: vi.fn().mockReturnValue(false) });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    const firstCall = spawnMock.mock.calls[0];
    expect(firstCall[0]).toBe("bash");
    expect(firstCall[1][0]).toContain("setup.sh");
    warnSpy.mockRestore();
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("continues when setup.sh exits non-zero", async () => {
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const deps = makeDeps({
      spawnSync: makeSpawn(1),
      existsSync: vi.fn().mockReturnValue(false),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(install(deps)).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("setup.sh"));
    warnSpy.mockRestore();
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });
});

// ─── install dry-run ─────────────────────────────────────────────────────────

describe("install with DryRunServiceDeps", () => {
  it("prints [dry-run] lines and writes no real files", async () => {
    const { DryRunServiceDeps } = await import("../../installer/dry-run-deps.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(install(new DryRunServiceDeps())).resolves.not.toThrow();

    const dryRunLines = logSpy.mock.calls
      .flatMap((c: any[]) => c)
      .filter((s: any) => typeof s === "string" && s.includes("[dry-run]"));

    expect(dryRunLines.some((l: string) => l.includes("would write:"))).toBe(true);
    expect(dryRunLines.some((l: string) => l.includes("settings.json"))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── summarizer picker ───────────────────────────────────────────────────────

describe("summarizer picker", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("option 1 (Claude Max / Pro): writes provider=claude-cli to config.json", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn().mockResolvedValueOnce("1"), // picker: option 1 (Claude Max/Pro)
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("claude-cli");
    expect(written.llm.apiKey).toBeFalsy();
  });

  it("option 2 (Anthropic API): writes provider=anthropic and apiKey literal to config.json", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("2"),  // picker: option 2
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("anthropic");
    expect(written.llm.apiKey).toBe("${ANTHROPIC_API_KEY}");
    expect(written.llm.model).toBe("claude-haiku-4-5-20251001");
  });

  it("option 3 (local model): reads cipher.yml and writes provider=openai", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const cipherContent = `
llm:
  provider: openai
  model: mlx-community/Qwen2.5-14B-Instruct-4bit
  baseURL: http://localhost:11435/v1
`;
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith("cipher.yml") ? true : false
      ),
      readFileSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith("cipher.yml") ? cipherContent : "{}"
      ),
      writeFileSync: writeFileMock,
      promptUser: vi.fn().mockResolvedValueOnce("3"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("openai");
    expect(written.llm.baseURL).toBe("http://localhost:11435/v1");
    expect(written.llm.model).toBe("mlx-community/Qwen2.5-14B-Instruct-4bit");
    expect(written.llm.apiKey).toBe("");
  });

  it("option 4 (custom server): prompts for URL and model, writes provider=openai", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("4")                           // picker: option 4
        .mockResolvedValueOnce("http://192.168.1.5:8080/v1") // URL prompt
        .mockResolvedValueOnce("my-model"),                   // model prompt
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("openai");
    expect(written.llm.baseURL).toBe("http://192.168.1.5:8080/v1");
    expect(written.llm.model).toBe("my-model");
  });

  it("invalid input re-prompts once then defaults to option 1 (claude-cli)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("9")   // invalid
        .mockResolvedValueOnce("9"),  // invalid again → default to 1
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("claude-cli");
  });

  it("non-TTY (process.stdin.isTTY is false): skips picker and defaults to claude-cli", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const writeFileMock = vi.fn();
    const promptUserMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: promptUserMock,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    expect(promptUserMock).not.toHaveBeenCalled(); // picker was skipped
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("claude-cli");
    expect(written.llm.apiKey).toBe("");
  });
});

// ─── setup.sh dry-run preview ────────────────────────────────────────────────

describe("setup.sh XGH_DRY_RUN=1 preview", () => {
  it.skipIf(!existsSync("/bin/bash"))("prints [dry-run] lines and exits 0 without writing files", async () => {
    const { spawnSync } = await import("node:child_process");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const setupScript = join(dirname(fileURLToPath(import.meta.url)), "../../installer/setup.sh");
    const result = spawnSync("bash", [setupScript], {
      encoding: "utf-8",
      env: { ...process.env, XGH_DRY_RUN: "1", XGH_BACKEND: "ollama" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[dry-run] backend:");
    expect(result.stdout).toContain("[dry-run] would write: ~/.cipher/cipher.yml");
  });
});
