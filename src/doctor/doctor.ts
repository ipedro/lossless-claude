import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CheckResult, DoctorDeps } from "./types.js";
import { mergeClaudeSettings } from "../../installer/install.js";

const COLORS = {
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  red: "\x1b[0;31m",
  cyan: "\x1b[0;36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  nc: "\x1b[0m",
};

function defaultDeps(): DoctorDeps {
  return {
    existsSync,
    readFileSync: (p, enc) => readFileSync(p, enc as BufferEncoding),
    writeFileSync,
    mkdirSync: (p, o) => mkdirSync(p, o),
    spawnSync: (cmd, args, opts) => {
      const r = spawnSync(cmd, args, { encoding: "utf-8", ...opts });
      return { status: r.status, stdout: r.stdout as string, stderr: r.stderr as string };
    },
    fetch: globalThis.fetch,
    homedir: homedir(),
    platform: platform(),
  };
}

interface DoctorConfig {
  port: number;
  backend: string;
  summarizer: string;
  remoteUrl: string;
  modelPort: number;
  embeddingModel: string;
  llmModel: string;
}

function loadConfig(deps: DoctorDeps): DoctorConfig {
  const configPath = join(deps.homedir, ".lossless-claude", "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(deps.readFileSync(configPath, "utf-8"));
  } catch {}

  // Also read cipher.yml for model info
  let backend = "unknown";
  let embeddingModel = "";
  let llmModel = "";
  let modelPort = 11434;
  let remoteUrl = "";

  const cipherYml = join(deps.homedir, ".cipher", "cipher.yml");
  try {
    const content = deps.readFileSync(cipherYml, "utf-8");
    // Parse backend from provider
    const providerMatch = content.match(/^llm:\s*\n\s+provider:\s*(\S+)/m);
    if (providerMatch) {
      const provider = providerMatch[1];
      if (provider === "ollama") backend = "ollama";
      else backend = "vllm-mlx"; // openai provider = vllm-mlx or remote
    }
    // Parse models
    const llmModelMatch = content.match(/^llm:[\s\S]*?^\s+model:\s*(\S+)/m);
    if (llmModelMatch) llmModel = llmModelMatch[1];
    const embedMatch = content.match(/^embedding:[\s\S]*?^\s+model:\s*(\S+)/m);
    if (embedMatch) embeddingModel = embedMatch[1];
    // Parse port from baseURL
    const urlMatch = content.match(/baseURL:\s*http:\/\/localhost:(\d+)/);
    if (urlMatch) modelPort = parseInt(urlMatch[1], 10);
    // Check for remote URL
    const remoteMatch = content.match(/baseURL:\s*(http:\/\/(?!localhost)\S+)/);
    if (remoteMatch) {
      backend = "remote";
      remoteUrl = remoteMatch[1].replace(/\/v1$/, "");
    }
  } catch {}

  const llm = config.llm as Record<string, string> | undefined;
  return {
    port: (config.daemon as Record<string, number> | undefined)?.port ?? (config as Record<string, unknown>).port as number ?? 3737,
    backend,
    summarizer: llm?.provider ?? "disabled",
    remoteUrl,
    modelPort,
    embeddingModel,
    llmModel,
  };
}

async function checkUrl(url: string, deps: DoctorDeps): Promise<boolean> {
  try {
    const res = await deps.fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function testMcpHandshake(): Promise<CheckResult> {
  return new Promise((resolve) => {
    const initMsg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "doctor", version: "0.1" } } });
    const listMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const child = spawn("lossless-claude", ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); }, 6000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("close", () => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n");
      const toolsLine = lines.find((l) => l.includes('"tools/list"') || (l.includes('"tools"') && l.includes('"id":2')));
      if (toolsLine) {
        try {
          const parsed = JSON.parse(toolsLine);
          const count = parsed.result?.tools?.length ?? 0;
          resolve({ name: "mcp-handshake-lcm", category: "MCP Servers", status: count === 5 ? "pass" : "warn", message: `lossless-claude: ${count}/5 tools` });
          return;
        } catch {}
      }
      resolve({ name: "mcp-handshake-lcm", category: "MCP Servers", status: "warn", message: `lossless-claude: 0/5 tools` });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ name: "mcp-handshake-lcm", category: "MCP Servers", status: "warn", message: "Could not spawn MCP process" });
    });

    // Send initialize, wait 300ms, then send tools/list, then close stdin after 500ms
    child.stdin.write(initMsg + "\n");
    setTimeout(() => {
      child.stdin.write(listMsg + "\n");
      setTimeout(() => { child.stdin.end(); }, 500);
    }, 300);
  });
}

export async function runDoctor(overrides?: Partial<DoctorDeps>): Promise<CheckResult[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const results: CheckResult[] = [];
  const config = loadConfig(deps);

  // ── Stack info ──
  results.push({
    name: "stack",
    category: "Stack",
    status: "pass",
    message: `Backend: ${config.backend} · Summarizer: ${config.summarizer}`,
  });

  // ── 1. Binary version ──
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  try {
    const pkg = JSON.parse(deps.readFileSync(pkgPath, "utf-8"));
    results.push({ name: "version", category: "Stack", status: "pass", message: `v${pkg.version}` });
  } catch {
    results.push({ name: "version", category: "Stack", status: "warn", message: "Could not read version" });
  }

  // ── 2. config.json ──
  const configPath = join(deps.homedir, ".lossless-claude", "config.json");
  if (deps.existsSync(configPath)) {
    results.push({ name: "config", category: "Stack", status: "pass", message: configPath });
  } else {
    results.push({ name: "config", category: "Stack", status: "fail", message: `Missing — run: lossless-claude install` });
  }

  // ── 3. cipher.yml ──
  const cipherYml = join(deps.homedir, ".cipher", "cipher.yml");
  if (deps.existsSync(cipherYml)) {
    results.push({ name: "cipher.yml", category: "Stack", status: "pass", message: `${cipherYml} (${config.backend}, ${config.llmModel || "unknown"})` });
  } else {
    results.push({ name: "cipher.yml", category: "Stack", status: "fail", message: "Missing — run: lossless-claude install" });
  }

  // ── Infrastructure (conditional on backend) ──

  // Qdrant (always needed)
  const qdrantHealthy = await checkUrl("http://localhost:6333/healthz", deps);
  if (qdrantHealthy) {
    results.push({ name: "qdrant", category: "Infrastructure", status: "pass", message: "localhost:6333 (healthy)" });
  } else {
    // Try to auto-fix: start Qdrant
    let fixed = false;
    if (deps.platform === "darwin") {
      const r = deps.spawnSync("brew", ["services", "start", "qdrant"], {});
      if (r.status === 0) {
        // Wait a moment then recheck
        await new Promise(r => setTimeout(r, 2000));
        fixed = await checkUrl("http://localhost:6333/healthz", deps);
      }
    } else {
      const r = deps.spawnSync("systemctl", ["--user", "start", "lossless-claude-qdrant"], {});
      if (r.status === 0) {
        await new Promise(r => setTimeout(r, 2000));
        fixed = await checkUrl("http://localhost:6333/healthz", deps);
      }
    }
    if (fixed) {
      results.push({ name: "qdrant", category: "Infrastructure", status: "warn", message: "localhost:6333 — restarted", fixApplied: true });
    } else {
      const fix = deps.platform === "darwin" ? "brew services start qdrant" : "systemctl --user start lossless-claude-qdrant";
      results.push({ name: "qdrant", category: "Infrastructure", status: "fail", message: `localhost:6333 unreachable\n     Fix: ${fix}` });
    }
  }

  // Backend-specific checks
  if (config.backend === "vllm-mlx") {
    const vllmOk = await checkUrl(`http://localhost:${config.modelPort}/v1/models`, deps);
    if (vllmOk) {
      results.push({ name: "vllm-mlx", category: "Infrastructure", status: "pass", message: `localhost:${config.modelPort} (responding)` });
    } else {
      results.push({ name: "vllm-mlx", category: "Infrastructure", status: "warn", message: `localhost:${config.modelPort} not responding\n     Fix: vllm-mlx serve` });
    }
  } else if (config.backend === "ollama") {
    const ollamaOk = await checkUrl(`http://localhost:${config.modelPort}`, deps);
    if (ollamaOk) {
      results.push({ name: "ollama", category: "Infrastructure", status: "pass", message: `localhost:${config.modelPort} (responding)` });
    } else {
      let fixed = false;
      if (deps.platform === "darwin") {
        const r = deps.spawnSync("brew", ["services", "start", "ollama"], {});
        if (r.status === 0) {
          await new Promise(r => setTimeout(r, 2000));
          fixed = await checkUrl(`http://localhost:${config.modelPort}`, deps);
        }
      }
      if (fixed) {
        results.push({ name: "ollama", category: "Infrastructure", status: "warn", message: `localhost:${config.modelPort} — restarted`, fixApplied: true });
      } else {
        results.push({ name: "ollama", category: "Infrastructure", status: "fail", message: `localhost:${config.modelPort} not responding\n     Fix: brew services start ollama` });
      }
    }
  } else if (config.backend === "remote" && config.remoteUrl) {
    const remoteOk = await checkUrl(`${config.remoteUrl}/v1/models`, deps);
    if (remoteOk) {
      results.push({ name: "remote", category: "Infrastructure", status: "pass", message: `${config.remoteUrl} (reachable)` });
    } else {
      results.push({ name: "remote", category: "Infrastructure", status: "warn", message: `${config.remoteUrl} unreachable` });
    }
  }

  // ── Daemon ──
  const daemonHealthy = await checkUrl(`http://localhost:${config.port}/health`, deps);
  if (daemonHealthy) {
    results.push({ name: "daemon", category: "Daemon", status: "pass", message: `localhost:${config.port} (up)` });
  } else {
    // Auto-fix: restart daemon service
    let fixed = false;
    if (deps.platform === "darwin") {
      const plistPath = join(deps.homedir, "Library", "LaunchAgents", "com.lossless-claude.daemon.plist");
      if (deps.existsSync(plistPath)) {
        deps.spawnSync("launchctl", ["unload", plistPath], {});
        deps.spawnSync("launchctl", ["load", plistPath], {});
        await new Promise(r => setTimeout(r, 3000));
        fixed = await checkUrl(`http://localhost:${config.port}/health`, deps);
      }
    } else {
      deps.spawnSync("systemctl", ["--user", "restart", "lossless-claude"], {});
      await new Promise(r => setTimeout(r, 3000));
      fixed = await checkUrl(`http://localhost:${config.port}/health`, deps);
    }
    if (fixed) {
      results.push({ name: "daemon", category: "Daemon", status: "warn", message: `localhost:${config.port} — restarted`, fixApplied: true });
    } else {
      results.push({ name: "daemon", category: "Daemon", status: "fail", message: `localhost:${config.port} not responding\n     Fix: lossless-claude daemon start` });
    }
  }

  // Daemon service registered
  if (deps.platform === "darwin") {
    const plistPath = join(deps.homedir, "Library", "LaunchAgents", "com.lossless-claude.daemon.plist");
    if (deps.existsSync(plistPath)) {
      results.push({ name: "daemon-service", category: "Daemon", status: "pass", message: "com.lossless-claude.daemon (registered)" });
    } else {
      results.push({ name: "daemon-service", category: "Daemon", status: "fail", message: "Plist missing — run: lossless-claude install" });
    }
  } else {
    const unitPath = join(deps.homedir, ".config", "systemd", "user", "lossless-claude.service");
    if (deps.existsSync(unitPath)) {
      results.push({ name: "daemon-service", category: "Daemon", status: "pass", message: "lossless-claude.service (registered)" });
    } else {
      results.push({ name: "daemon-service", category: "Daemon", status: "fail", message: "Unit file missing — run: lossless-claude install" });
    }
  }

  // ── Settings ──
  const settingsPath = join(deps.homedir, ".claude", "settings.json");
  let settingsData: Record<string, unknown> = {};
  try {
    settingsData = JSON.parse(deps.readFileSync(settingsPath, "utf-8"));
  } catch {}

  const hooks = settingsData.hooks as Record<string, unknown[]> | undefined;
  const hasCompactHook = hooks?.PreCompact?.some((e: unknown) =>
    JSON.stringify(e).includes("lossless-claude compact")
  ) ?? false;
  const hasRestoreHook = hooks?.SessionStart?.some((e: unknown) =>
    JSON.stringify(e).includes("lossless-claude restore")
  ) ?? false;

  if (hasCompactHook && hasRestoreHook) {
    results.push({ name: "hooks", category: "Settings", status: "pass", message: "PreCompact \u2713  SessionStart \u2713" });
  } else {
    // Auto-fix: merge hooks
    try {
      const merged = mergeClaudeSettings(settingsData);
      deps.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      results.push({ name: "hooks", category: "Settings", status: "warn", message: "Hooks missing — fixed", fixApplied: true });
    } catch {
      results.push({ name: "hooks", category: "Settings", status: "fail", message: "Hooks missing — run: lossless-claude install" });
    }
  }

  const mcpServers = settingsData.mcpServers as Record<string, unknown> | undefined;
  if (mcpServers?.["lossless-claude"]) {
    results.push({ name: "mcp-lossless-claude", category: "Settings", status: "pass", message: "lossless-claude MCP \u2713" });
  } else {
    // Auto-fix
    try {
      const merged = mergeClaudeSettings(settingsData);
      deps.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      results.push({ name: "mcp-lossless-claude", category: "Settings", status: "warn", message: "MCP entry missing — fixed", fixApplied: true });
    } catch {
      results.push({ name: "mcp-lossless-claude", category: "Settings", status: "fail", message: "MCP entry missing — run: lossless-claude install" });
    }
  }

  // ── Cipher ──
  const hasCipher = deps.spawnSync("sh", ["-c", "command -v cipher"], {}).status === 0;
  if (hasCipher) {
    results.push({ name: "cipher-binary", category: "MCP Servers", status: "pass", message: "cipher binary found" });
  } else {
    // Auto-fix
    const r = deps.spawnSync("npm", ["install", "-g", "@byterover/cipher"], { stdio: "pipe" } as object);
    if (r.status === 0) {
      results.push({ name: "cipher-binary", category: "MCP Servers", status: "warn", message: "cipher installed", fixApplied: true });
    } else {
      results.push({ name: "cipher-binary", category: "MCP Servers", status: "fail", message: "cipher not found\n     Fix: npm install -g @byterover/cipher" });
    }
  }

  const cipherMcpPath = join(deps.homedir, ".local", "bin", "cipher-mcp");
  if (deps.existsSync(cipherMcpPath)) {
    results.push({ name: "cipher-mcp-wrapper", category: "MCP Servers", status: "pass", message: "~/.local/bin/cipher-mcp" });
  } else {
    results.push({ name: "cipher-mcp-wrapper", category: "MCP Servers", status: "fail", message: "Wrapper missing — run: lossless-claude install" });
  }

  if (mcpServers?.cipher) {
    results.push({ name: "cipher-mcp-entry", category: "MCP Servers", status: "pass", message: "cipher MCP \u2713" });
  } else {
    results.push({ name: "cipher-mcp-entry", category: "MCP Servers", status: "warn", message: "cipher MCP not in settings.json — run: lossless-claude install" });
  }

  // ── Summarizer (conditional) ──
  if (config.summarizer === "claude-cli") {
    const hasClaude = deps.spawnSync("sh", ["-c", "command -v claude"], {}).status === 0;
    if (hasClaude) {
      results.push({ name: "claude-cli", category: "Summarizer", status: "pass", message: "claude CLI found" });
    } else {
      results.push({ name: "claude-cli", category: "Summarizer", status: "fail", message: "claude CLI not found\n     Fix: npm install -g @anthropic-ai/claude-code" });
    }

    const hasClaudeServer = deps.spawnSync("sh", ["-c", "command -v claude-server || command -v claude-max-api"], {}).status === 0;
    if (hasClaudeServer) {
      results.push({ name: "claude-server", category: "Summarizer", status: "pass", message: "claude-server binary found" });
    } else {
      const r = deps.spawnSync("npm", ["install", "-g", "claude-max-api-proxy"], { stdio: "pipe" } as object);
      if (r.status === 0) {
        results.push({ name: "claude-server", category: "Summarizer", status: "warn", message: "claude-max-api-proxy installed", fixApplied: true });
      } else {
        results.push({ name: "claude-server", category: "Summarizer", status: "fail", message: "claude-server not found\n     Fix: npm install -g claude-max-api-proxy" });
      }
    }
  } else if (config.summarizer === "anthropic") {
    if (process.env.ANTHROPIC_API_KEY) {
      results.push({ name: "anthropic-key", category: "Summarizer", status: "pass", message: "ANTHROPIC_API_KEY set" });
    } else {
      results.push({ name: "anthropic-key", category: "Summarizer", status: "warn", message: "ANTHROPIC_API_KEY not set in environment" });
    }
  }

  // ── MCP handshake ──
  if (daemonHealthy) {
    try {
      const mcpResult = await testMcpHandshake();
      results.push(mcpResult);
    } catch {
      results.push({ name: "mcp-handshake-lcm", category: "MCP Servers", status: "warn", message: "Could not test MCP handshake" });
    }
  }

  return results;
}

export function printResults(results: CheckResult[]): void {
  let currentCategory = "";

  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      console.log(`\n  ${COLORS.cyan}──${COLORS.nc} ${COLORS.bold}${currentCategory}${COLORS.nc} ${COLORS.cyan}──${COLORS.nc}`);
    }
    if (r.name === "stack") {
      console.log(`  ${COLORS.dim}${r.message}${COLORS.nc}`);
      continue;
    }

    const icon = r.status === "pass" ? `${COLORS.green}\u2705` : r.status === "warn" ? `${COLORS.yellow}\u26A0\uFE0F ` : `${COLORS.red}\u274C`;
    const suffix = r.fixApplied ? ` ${COLORS.dim}(auto-fixed)${COLORS.nc}` : "";
    console.log(`  ${icon}${COLORS.nc} ${r.name}: ${r.message}${suffix}`);
  }

  const pass = results.filter(r => r.status === "pass" && r.name !== "stack").length;
  const fail = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;

  console.log(`\n  ${pass} passed, ${fail} failed, ${warn} warnings\n`);
}
