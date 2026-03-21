import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export const REQUIRED_HOOKS: { event: string; command: string }[] = [
  { event: "PreCompact", command: "lossless-claude compact" },
  { event: "SessionStart", command: "lossless-claude restore" },
  { event: "SessionEnd", command: "lossless-claude session-end" },
  { event: "UserPromptSubmit", command: "lossless-claude user-prompt" },
];

const LC_MCP = { command: "lossless-claude", args: ["mcp"] };

function makeHookEntry(command: string): { matcher: string; hooks: { type: string; command: string }[] } {
  return { matcher: "", hooks: [{ type: "command", command }] };
}

function hasHookCommand(entries: any[], command: string): boolean {
  return entries.some((entry: any) =>
    Array.isArray(entry.hooks) && entry.hooks.some((h: any) => h.command === command)
  );
}

export function mergeClaudeSettings(existing: any): any {
  const settings = JSON.parse(JSON.stringify(existing));
  settings.hooks = settings.hooks ?? {};
  settings.mcpServers = settings.mcpServers ?? {};

  for (const { event, command } of REQUIRED_HOOKS) {
    const entries = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = entries;
    if (!hasHookCommand(entries, command)) {
      entries.push(makeHookEntry(command));
    }
  }

  settings.mcpServers["lossless-claude"] = LC_MCP;
  return settings;
}

export interface ServiceDeps {
  spawnSync: (cmd: string, args: string[], opts?: any) => SpawnSyncReturns<string>;
  readFileSync: (path: string, encoding: string) => string;
  writeFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string, opts?: any) => void;
  existsSync: (path: string) => boolean;
  promptUser: (question: string) => Promise<string>;
  ensureDaemon?: (opts: { port: number; pidFilePath: string; spawnTimeoutMs: number }) => Promise<{ connected: boolean }>;
  runDoctor?: () => Promise<Array<{ name: string; status: string; category?: string; message?: string }>>;
}

async function readlinePrompt(question: string): Promise<string> {
  const rl = (await import("node:readline/promises")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const defaultDeps: ServiceDeps = { spawnSync: spawnSync as any, readFileSync: (path, encoding) => readFileSync(path, encoding as BufferEncoding) as string, writeFileSync, mkdirSync, existsSync, promptUser: readlinePrompt };

export function resolveBinaryPath(deps: Pick<ServiceDeps, "spawnSync" | "existsSync"> = defaultDeps): string {
  const result = deps.spawnSync("sh", ["-c", "command -v lossless-claude"], { encoding: "utf-8" });
  if (result.status === 0 && typeof result.stdout === "string" && result.stdout.trim()) {
    return result.stdout.trim();
  }

  const fallbacks = [
    join(homedir(), ".npm-global", "bin", "lossless-claude"),
    "/usr/local/bin/lossless-claude",
    "/opt/homebrew/bin/lossless-claude",
  ];
  for (const p of fallbacks) {
    if (deps.existsSync(p)) return p;
  }

  return "lossless-claude";
}


type SummarizerConfig = {
  provider: "claude-process" | "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseURL: string;
};

async function pickSummarizer(deps: ServiceDeps): Promise<SummarizerConfig> {
  // Non-TTY (CI, piped stdin): skip interactive picker, default to claude-process
  if (!process.stdin.isTTY) {
    return { provider: "claude-process", model: "", apiKey: "", baseURL: "" };
  }

  console.log("\n  ─── Summarizer (for conversation compaction)\n");
  console.log("  1) Claude Max / Pro  (recommended — uses your subscription, no API key needed)");
  console.log("  2) Anthropic API     (direct API access — requires API key)");
  console.log("  3) Custom server     (any OpenAI-compatible URL)");
  console.log("");

  let choice = (await deps.promptUser("  Pick [1]: ")).trim();
  if (!["1", "2", "3"].includes(choice)) {
    console.log("  Invalid choice — please enter 1, 2, or 3.");
    choice = (await deps.promptUser("  Pick [1]: ")).trim();
  }
  if (!["1", "2", "3"].includes(choice)) {
    choice = "1"; // default after two invalid attempts
  }

  if (choice === "1") {
    return { provider: "claude-process", model: "", apiKey: "", baseURL: "" };
  }

  if (choice === "2") {
    const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
    return { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey, baseURL: "" };
  }

  if (choice === "3") {
    const baseURL = (await deps.promptUser("  Server URL (e.g. http://192.168.1.x:8080/v1): ")).trim();
    const model = (await deps.promptUser("  Model name: ")).trim();
    return { provider: "openai", model, apiKey: "", baseURL };
  }

  // Fallback (should not reach here)
  return { provider: "claude-process", model: "", apiKey: "", baseURL: "" };
}

// ── Health-wait ──

export async function waitForHealth(
  url: string,
  timeoutMs: number = 10000,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export async function install(deps: ServiceDeps = defaultDeps): Promise<void> {
  const lcDir = join(homedir(), ".lossless-claude");
  deps.mkdirSync(lcDir, { recursive: true });

  // 1. Create or update config.json
  const configPath = join(lcDir, "config.json");
  if (!deps.existsSync(configPath)) {
    const summarizerConfig = await pickSummarizer(deps);
    const { loadDaemonConfig } = await import("../src/daemon/config.js");
    const defaults = loadDaemonConfig("/nonexistent");
    defaults.llm = { ...defaults.llm, ...summarizerConfig };
    deps.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    console.log(`Created ${configPath}`);
  }

  // 2. Merge ~/.claude/settings.json (hooks + MCP)
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let existing: any = {};
  if (deps.existsSync(settingsPath)) {
    try { existing = JSON.parse(deps.readFileSync(settingsPath, "utf-8")); } catch {}
  }
  const merged = mergeClaudeSettings(existing);
  deps.mkdirSync(join(homedir(), ".claude"), { recursive: true });
  deps.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  console.log(`Updated ${settingsPath}`);

  // 3. Install slash commands to ~/.claude/commands/
  const commandsSrc = join(dirname(new URL(import.meta.url).pathname), "../..", ".claude-plugin", "commands");
  const commandsDst = join(homedir(), ".claude", "commands");
  if (deps.existsSync(commandsSrc)) {
    deps.mkdirSync(commandsDst, { recursive: true });
    for (const file of readdirSync(commandsSrc)) {
      if (file.endsWith(".md")) {
        copyFileSync(join(commandsSrc, file), join(commandsDst, file));
      }
    }
    console.log(`Installed slash commands to ${commandsDst}`);
  }

  // 4. Start daemon (lazy daemon — no persistent service)
  const configData = deps.existsSync(configPath)
    ? JSON.parse(deps.readFileSync(configPath, "utf-8"))
    : {};
  console.log("Verifying daemon...");
  const _ensureDaemon = deps.ensureDaemon ?? (async (opts) => {
    const { ensureDaemon } = await import("../src/daemon/lifecycle.js");
    return ensureDaemon(opts);
  });
  const daemonPort = configData?.daemon?.port ?? configData?.port ?? 3737;
  const { connected } = await _ensureDaemon({
    port: daemonPort,
    pidFilePath: join(lcDir, "daemon.pid"),
    spawnTimeoutMs: 30000,
  });
  if (!connected) {
    console.warn("Warning: daemon not responding — run: lossless-claude doctor");
  } else {
    console.log("Daemon started successfully.");
  }

  // 5. Final verification
  console.log("\nRunning doctor...");
  const _runDoctor = deps.runDoctor ?? (async () => {
    const { runDoctor, printResults: _print } = await import("../src/doctor/doctor.js");
    const _results = await runDoctor();
    _print(_results);
    return _results;
  });
  const results = await _runDoctor();
  const failures = results.filter((r: { status: string }) => r.status === "fail");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed. Run 'lossless-claude doctor' for details.`);
  } else {
    console.log("lossless-claude installed successfully! All checks passed.");
  }
}

// Re-export rmSync so uninstall.ts can share the pattern
export { rmSync };
