import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, chmodSync } from "node:fs";
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

export function buildLaunchdPlist(binaryPath: string, logPath: string, nodeBinDir?: string): string {
  const nodePath = nodeBinDir ?? "/opt/homebrew/bin";
  const pathValue = `${nodePath}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathValue}</string>
  </dict>
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
    const nodeBinDir = dirname(process.execPath);
    deps.writeFileSync(plistPath, buildLaunchdPlist(binaryPath, logPath, nodeBinDir));

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
  provider: "claude-cli" | "anthropic" | "openai";
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
  // Non-TTY (CI, piped stdin): skip interactive picker, default to claude-cli
  if (!process.stdin.isTTY) {
    return { provider: "claude-cli", model: "claude-haiku-4-5", apiKey: "", baseURL: "" };
  }

  console.log("\n  ─── Summarizer (for conversation compaction)\n");
  console.log("  1) Claude Max / Pro  (recommended — uses your subscription, no API key needed)");
  console.log("  2) Anthropic API     (direct API access — requires API key)");
  console.log("  3) Local model       (reuse your vllm-mlx / ollama endpoint)");
  console.log("  4) Custom server     (any OpenAI-compatible URL)");
  console.log("");

  let choice = (await deps.promptUser("  Pick [1]: ")).trim();
  if (!["1", "2", "3", "4"].includes(choice)) {
    console.log("  Invalid choice — please enter 1, 2, 3, or 4.");
    choice = (await deps.promptUser("  Pick [1]: ")).trim();
  }
  if (!["1", "2", "3", "4"].includes(choice)) {
    choice = "1"; // default after two invalid attempts
  }

  if (choice === "1") {
    return { provider: "claude-cli", model: "claude-haiku-4-5", apiKey: "", baseURL: "" };
  }

  if (choice === "2") {
    const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
    return { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey, baseURL: "" };
  }

  if (choice === "3") {
    // Read from cipher.yml
    try {
      const cipherContent = deps.readFileSync(cipherConfigPath, "utf-8");
      const parsed = parseCipherYml(cipherContent);
      if (parsed) {
        return { provider: "openai", model: parsed.model, apiKey: "", baseURL: parsed.baseURL };
      }
    } catch {}
    console.warn("  Warning: Could not read local model config from cipher.yml — falling back to manual entry.");
    choice = "4";
  }

  if (choice === "4") {
    const baseURL = (await deps.promptUser("  Server URL (e.g. http://192.168.1.x:8080/v1): ")).trim();
    const model = (await deps.promptUser("  Model name: ")).trim();
    return { provider: "openai", model, apiKey: "", baseURL };
  }

  // Fallback (should not reach here)
  return { provider: "claude-cli", model: "claude-haiku-4-5", apiKey: "", baseURL: "" };
}

// ── Cipher installation (A2) ──

export interface CipherConfig {
  embeddingModel: string;
  embeddingBaseURL: string;
  embeddingDimensions: string;
  llmModel: string;
  llmBaseURL: string;
  backend: string;
}

export function parseCipherConfig(cipherYmlPath: string, deps: Pick<ServiceDeps, "readFileSync">): CipherConfig | null {
  try {
    const content = deps.readFileSync(cipherYmlPath, "utf-8");
    let embeddingModel = "", embeddingBaseURL = "", embeddingDimensions = "768";
    let llmModel = "", llmBaseURL = "";
    let backend = "vllm-mlx";

    // Parse embedding section
    const embedSection = content.match(/^embedding:[\s\S]*?(?=^\w|\Z)/m);
    if (embedSection) {
      const modelMatch = embedSection[0].match(/model:\s*(\S+)/);
      if (modelMatch) embeddingModel = modelMatch[1];
      const urlMatch = embedSection[0].match(/baseURL:\s*(\S+)/);
      if (urlMatch) embeddingBaseURL = urlMatch[1];
      const dimMatch = embedSection[0].match(/dimensions:\s*(\d+)/);
      if (dimMatch) embeddingDimensions = dimMatch[1];
    }

    // Parse llm section
    const llmSection = content.match(/^llm:[\s\S]*?(?=^\w|\Z)/m);
    if (llmSection) {
      const modelMatch = llmSection[0].match(/model:\s*(\S+)/);
      if (modelMatch) llmModel = modelMatch[1];
      const urlMatch = llmSection[0].match(/baseURL:\s*(\S+)/);
      if (urlMatch) llmBaseURL = urlMatch[1];
      const providerMatch = llmSection[0].match(/provider:\s*(\S+)/);
      if (providerMatch && providerMatch[1] === "ollama") backend = "ollama";
    }

    // Detect remote
    if (llmBaseURL && !llmBaseURL.includes("localhost") && !llmBaseURL.includes("127.0.0.1")) {
      backend = "remote";
    }

    if (!embeddingModel || !llmModel) return null;
    return { embeddingModel, embeddingBaseURL, embeddingDimensions, llmModel, llmBaseURL, backend };
  } catch {
    return null;
  }
}

export function installCipherPackage(deps: Pick<ServiceDeps, "spawnSync">): boolean {
  const has = deps.spawnSync("sh", ["-c", "command -v cipher"], { encoding: "utf-8" });
  if (has.status === 0) return true;

  console.log("Installing cipher (@byterover/cipher)...");
  const r = deps.spawnSync("npm", ["install", "-g", "@byterover/cipher"], { stdio: "inherit" });
  return r.status === 0;
}

export function installCipherWrapper(deps: Pick<ServiceDeps, "mkdirSync" | "existsSync">): void {
  const templatesDir = join(dirname(fileURLToPath(import.meta.url)), "templates");
  const binDir = join(homedir(), ".local", "bin");
  const libDir = join(homedir(), ".local", "lib");

  deps.mkdirSync(binDir, { recursive: true });
  deps.mkdirSync(libDir, { recursive: true });

  // Copy cipher-mcp wrapper
  const wrapperSrc = join(templatesDir, "cipher-mcp.js");
  const wrapperDest = join(binDir, "cipher-mcp");
  copyFileSync(wrapperSrc, wrapperDest);
  chmodSync(wrapperDest, 0o755);

  // Copy fix-openai-embeddings
  const fixSrc = join(templatesDir, "fix-openai-embeddings.js");
  const fixDest = join(libDir, "fix-openai-embeddings.js");
  copyFileSync(fixSrc, fixDest);

  console.log("Installed cipher-mcp wrapper and OpenAI SDK fix.");
}

export function mergeCipherSettings(existing: any, config: CipherConfig): any {
  const settings = JSON.parse(JSON.stringify(existing));
  settings.mcpServers = settings.mcpServers ?? {};

  const wrapperPath = join(homedir(), ".local", "bin", "cipher-mcp");

  // Determine base URLs — ensure /v1 suffix
  const embeddingURL = config.embeddingBaseURL.endsWith("/v1") ? config.embeddingBaseURL : config.embeddingBaseURL + "/v1";
  const llmURL = config.llmBaseURL.endsWith("/v1") ? config.llmBaseURL : config.llmBaseURL + "/v1";

  settings.mcpServers.cipher = {
    type: "stdio",
    command: wrapperPath,
    args: [],
    env: {
      MCP_SERVER_MODE: "aggregator",
      VECTOR_STORE_TYPE: "qdrant",
      VECTOR_STORE_URL: "http://localhost:6333",
      EMBEDDING_PROVIDER: "openai",
      EMBEDDING_MODEL: config.embeddingModel,
      EMBEDDING_BASE_URL: embeddingURL,
      EMBEDDING_DIMENSIONS: config.embeddingDimensions,
      EMBEDDING_API_KEY: "placeholder",
      OPENAI_API_KEY: "placeholder",
      OPENAI_BASE_URL: llmURL,
      LLM_PROVIDER: "openai",
      LLM_MODEL: config.llmModel,
      LLM_BASE_URL: llmURL,
      LLM_API_KEY: "placeholder",
      CIPHER_LOG_LEVEL: "info",
      SEARCH_MEMORY_TYPE: "both",
      USE_WORKSPACE_MEMORY: "true",
    },
  };

  return settings;
}

// ── claude-max-api-proxy installation (A3) ──

export function installClaudeServer(deps: Pick<ServiceDeps, "spawnSync">, config: { provider: string }): boolean {
  if (config.provider !== "claude-cli") return true;

  const has = deps.spawnSync("sh", ["-c", "command -v claude-server || command -v claude-max-api"], { encoding: "utf-8" });
  if (has.status === 0) return true;

  console.log("Installing claude-max-api-proxy (Claude Max summarizer)...");
  const r = deps.spawnSync("npm", ["install", "-g", "claude-max-api-proxy"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.warn("Warning: Could not install claude-max-api-proxy — summarization via Claude CLI may not work");
    return false;
  }
  return true;
}

// ── Health-wait (A4) ──

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

  // 5. Install cipher package and wrapper
  const cipherYmlPath = join(homedir(), ".cipher", "cipher.yml");
  installCipherPackage(deps);
  installCipherWrapper(deps);

  // 6. Register cipher MCP in settings.json
  const cipherCfg = parseCipherConfig(cipherYmlPath, deps);
  if (cipherCfg) {
    const settingsNow = JSON.parse(deps.readFileSync(settingsPath, "utf-8"));
    const withCipher = mergeCipherSettings(settingsNow, cipherCfg);
    deps.writeFileSync(settingsPath, JSON.stringify(withCipher, null, 2));
    console.log("Registered cipher MCP in settings.json");
  } else {
    console.warn("Warning: Could not parse cipher.yml — cipher MCP not registered");
  }

  // 7. Install claude-max-api-proxy if summarizer is claude-cli
  const configData = JSON.parse(deps.readFileSync(configPath, "utf-8"));
  const provider = configData?.llm?.provider ?? "disabled";
  installClaudeServer(deps, { provider });

  // 8. Set up and start the persistent daemon service
  setupDaemonService(deps);

  // 9. Wait for services to come up
  console.log("Waiting for daemon...");
  const daemonPort = configData?.daemon?.port ?? configData?.port ?? 3737;
  const daemonOk = await waitForHealth(`http://localhost:${daemonPort}/health`);
  if (!daemonOk) console.warn("Warning: daemon not responding — run: lossless-claude doctor");

  console.log("Waiting for Qdrant...");
  const qdrantOk = await waitForHealth("http://localhost:6333/healthz");
  if (!qdrantOk) console.warn("Warning: Qdrant not responding — run: lossless-claude doctor");

  // 10. Run doctor for final verification
  console.log("\nRunning doctor...");
  const { runDoctor, printResults } = await import("../src/doctor/doctor.js");
  const results = await runDoctor();
  printResults(results);
  const failures = results.filter((r: { status: string }) => r.status === "fail");
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed. Run 'lossless-claude doctor' for details.`);
  } else {
    console.log("lossless-claude installed successfully! All checks passed.");
  }
}

// Re-export rmSync so uninstall.ts can share the pattern
export { rmSync };
