import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const LC_HOOK_COMPACT_CMD = "lossless-claude compact";
const LC_HOOK_RESTORE_CMD = "lossless-claude restore";
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

  // Merge PreCompact
  settings.hooks.PreCompact = settings.hooks.PreCompact ?? [];
  if (!hasHookCommand(settings.hooks.PreCompact, LC_HOOK_COMPACT_CMD)) {
    settings.hooks.PreCompact.push(makeHookEntry(LC_HOOK_COMPACT_CMD));
  }

  // Merge SessionStart
  settings.hooks.SessionStart = settings.hooks.SessionStart ?? [];
  if (!hasHookCommand(settings.hooks.SessionStart, LC_HOOK_RESTORE_CMD)) {
    settings.hooks.SessionStart.push(makeHookEntry(LC_HOOK_RESTORE_CMD));
  }

  // Add MCP server
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

export function buildLaunchdPlist(binaryPath: string, logPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lossless-claude.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

export function buildSystemdUnit(binaryPath: string): string {
  return `[Unit]
Description=lossless-claude daemon
After=network.target

[Service]
ExecStart=${binaryPath} daemon start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function setupDaemonService(deps: ServiceDeps = defaultDeps): void {
  const platform = process.platform;
  const binaryPath = resolveBinaryPath(deps);

  if (platform === "darwin") {
    console.log("Setting up daemon service (launchd)...");

    const plistDir = join(homedir(), "Library", "LaunchAgents");
    const plistPath = join(plistDir, "com.lossless-claude.daemon.plist");
    const logPath = join(homedir(), ".lossless-claude", "daemon.log");

    deps.mkdirSync(plistDir, { recursive: true });
    deps.writeFileSync(plistPath, buildLaunchdPlist(binaryPath, logPath));

    // Unload first (idempotent — ignore errors if not loaded)
    deps.spawnSync("launchctl", ["unload", plistPath], { stdio: "inherit" });
    // Load and start
    const load = deps.spawnSync("launchctl", ["load", plistPath], { stdio: "inherit" });
    if (load.status !== 0) {
      console.warn(`Warning: launchctl load exited with status ${load.status}`);
    }

    console.log("Daemon service registered and started.");
  } else if (platform === "linux") {
    console.log("Setting up daemon service (systemd)...");

    const unitDir = join(homedir(), ".config", "systemd", "user");
    const unitPath = join(unitDir, "lossless-claude.service");

    deps.mkdirSync(unitDir, { recursive: true });
    deps.writeFileSync(unitPath, buildSystemdUnit(binaryPath));

    deps.spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    const enable = deps.spawnSync("systemctl", ["--user", "enable", "lossless-claude"], { stdio: "inherit" });
    if (enable.status !== 0) {
      console.warn(`Warning: systemctl enable exited with status ${enable.status}`);
    }
    const start = deps.spawnSync("systemctl", ["--user", "start", "lossless-claude"], { stdio: "inherit" });
    if (start.status !== 0) {
      console.warn(`Warning: systemctl start exited with status ${start.status}`);
    }

    console.log("Daemon service registered and started.");
  } else {
    console.warn(`Warning: Unsupported platform "${platform}". Skipping daemon service setup.`);
    console.log("Run: lossless-claude daemon start");
  }
}

type SummarizerConfig = {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseURL: string;
};

function parseCipherYml(content: string): { model: string; baseURL: string } | null {
  try {
    let inLlmSection = false;
    let model = "";
    let baseURL = "";
    for (const line of content.split("\n")) {
      if (/^llm:\s*$/.test(line)) { inLlmSection = true; continue; }
      if (inLlmSection && /^[^\s]/.test(line)) break; // left llm section
      if (inLlmSection) {
        const modelMatch = line.match(/^\s+model:\s*(\S+)/);
        if (modelMatch) model = modelMatch[1];
        const urlMatch = line.match(/^\s+baseURL:\s*(\S+)/);
        if (urlMatch) baseURL = urlMatch[1];
      }
    }
    if (!model || !baseURL) return null;
    // Ensure /v1 suffix (ollama's native API doesn't include it, OpenAI-compat needs it)
    if (!baseURL.endsWith("/v1")) baseURL = baseURL + "/v1";
    return { model, baseURL };
  } catch {
    return null;
  }
}

async function pickSummarizer(deps: ServiceDeps, cipherConfigPath: string): Promise<SummarizerConfig> {
  // Non-TTY (CI, piped stdin): skip interactive picker, default to Anthropic
  if (!process.stdin.isTTY) {
    const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
    return { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey, baseURL: "" };
  }

  console.log("\n  ─── Summarizer (for conversation compaction)\n");
  console.log("  1) Anthropic API     (best quality — requires API key)");
  console.log("  2) Local model       (reuse your vllm-mlx / ollama endpoint)");
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

  if (choice === "2") {
    // Read from cipher.yml
    try {
      const cipherContent = deps.readFileSync(cipherConfigPath, "utf-8");
      const parsed = parseCipherYml(cipherContent);
      if (parsed) {
        return { provider: "openai", model: parsed.model, apiKey: "", baseURL: parsed.baseURL };
      }
    } catch {}
    console.warn("  Warning: Could not read local model config from cipher.yml — falling back to manual entry.");
    choice = "3";
  }

  if (choice === "3") {
    const baseURL = (await deps.promptUser("  Server URL (e.g. http://192.168.1.x:8080/v1): ")).trim();
    const model = (await deps.promptUser("  Model name: ")).trim();
    return { provider: "openai", model, apiKey: "", baseURL };
  }

  // Option 1: Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    apiKey,
    baseURL: "",
  };
}

export async function install(deps: ServiceDeps = defaultDeps): Promise<void> {
  // Step 0: infrastructure setup (backend, models, Qdrant, cipher.yml)
  const setupScript = join(dirname(fileURLToPath(import.meta.url)), "setup.sh");
  const setupResult = deps.spawnSync("bash", [setupScript], { stdio: "inherit", env: process.env });
  if (setupResult.status !== 0) {
    console.warn(`Warning: setup.sh exited with code ${setupResult.status} — continuing`);
  }

  const lcDir = join(homedir(), ".lossless-claude");
  deps.mkdirSync(lcDir, { recursive: true });

  // 1. Check cipher config
  const cipherConfig = join(homedir(), ".cipher", "cipher.yml");
  if (!deps.existsSync(cipherConfig)) {
    console.warn("Warning: ~/.cipher/cipher.yml not found — semantic search will be unavailable until setup completes");
  }

  // 2. Create or update config.json
  const configPath = join(lcDir, "config.json");
  if (!deps.existsSync(configPath)) {
    const cipherConfigPath = join(homedir(), ".cipher", "cipher.yml");
    const summarizerConfig = await pickSummarizer(deps, cipherConfigPath);
    const { loadDaemonConfig } = await import("../src/daemon/config.js");
    const defaults = loadDaemonConfig("/nonexistent");
    defaults.llm = { ...defaults.llm, ...summarizerConfig };
    deps.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    console.log(`Created ${configPath}`);
  }

  // 4. Merge ~/.claude/settings.json
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let existing: any = {};
  if (deps.existsSync(settingsPath)) {
    try { existing = JSON.parse(deps.readFileSync(settingsPath, "utf-8")); } catch {}
  }
  const merged = mergeClaudeSettings(existing);
  deps.mkdirSync(join(homedir(), ".claude"), { recursive: true });
  deps.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  console.log(`Updated ${settingsPath}`);

  // 5. Set up and start the persistent daemon service
  setupDaemonService(deps);

  console.log(`\nlossless-claude installed successfully!`);
}

// Re-export rmSync so uninstall.ts can share the pattern
export { rmSync };
