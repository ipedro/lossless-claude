import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CheckResult, DoctorDeps } from "./types.js";
import { mergeClaudeSettings, REQUIRED_HOOKS } from "../../installer/install.js";

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
  summarizer: string;
}

function loadConfig(deps: DoctorDeps): DoctorConfig {
  const configPath = join(deps.homedir, ".lossless-claude", "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(deps.readFileSync(configPath, "utf-8"));
  } catch {}

  const llm = config.llm as Record<string, string> | undefined;
  return {
    port: (config.daemon as Record<string, number> | undefined)?.port ?? (config as Record<string, unknown>).port as number ?? 3737,
    summarizer: llm?.provider ?? "disabled",
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

    // Resolve the binary relative to this file so it works outside Claude Code's PATH
    const binPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "lossless-claude.js");
    const child = spawn(process.execPath, [binPath, "mcp"], { stdio: ["pipe", "pipe", "ignore"] });
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
          resolve({ name: "mcp-handshake-lcm", category: "MCP Servers", status: count === 7 ? "pass" : "warn", message: `lossless-claude: ${count}/7 tools` });
          return;
        } catch {}
      }
      resolve({ name: "mcp-handshake-lcm", category: "MCP Servers", status: "warn", message: `lossless-claude: 0/7 tools` });
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
    message: `Summarizer: ${config.summarizer}`,
  });

  // ── 1. Binary version ──
  // dist/src/doctor/doctor.js → ../../.. → project root
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
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

  // ── Daemon ──
  const daemonHealthy = await checkUrl(`http://localhost:${config.port}/health`, deps);
  if (daemonHealthy) {
    results.push({ name: "daemon", category: "Daemon", status: "pass", message: `localhost:${config.port} (up)` });
  } else {
    // Auto-fix: try ensureDaemon
    try {
      const { ensureDaemon } = await import("../daemon/lifecycle.js");
      const { connected } = await ensureDaemon({
        port: config.port,
        pidFilePath: join(deps.homedir, ".lossless-claude", "daemon.pid"),
        spawnTimeoutMs: 10000,
      });
      if (connected) {
        results.push({ name: "daemon", category: "Daemon", status: "warn", message: `localhost:${config.port} — started`, fixApplied: true });
      } else {
        results.push({ name: "daemon", category: "Daemon", status: "fail", message: `localhost:${config.port} not responding\n     Fix: lossless-claude daemon start` });
      }
    } catch {
      results.push({ name: "daemon", category: "Daemon", status: "fail", message: `localhost:${config.port} not responding\n     Fix: lossless-claude daemon start` });
    }
  }

  // ── Settings ──
  const settingsPath = join(deps.homedir, ".claude", "settings.json");
  let settingsData: Record<string, unknown> = {};
  try {
    settingsData = JSON.parse(deps.readFileSync(settingsPath, "utf-8"));
  } catch {}

  const hooks = settingsData.hooks as Record<string, unknown[]> | undefined;
  const missingHooks: string[] = [];
  const presentHooks: string[] = [];

  for (const { event, command } of REQUIRED_HOOKS) {
    const entries = hooks?.[event];
    const found = Array.isArray(entries) && entries.some((e: any) =>
      Array.isArray(e?.hooks) && e.hooks.some((h: any) => h.command === command)
    );
    if (found) {
      presentHooks.push(event);
    } else {
      missingHooks.push(event);
    }
  }

  if (missingHooks.length === 0) {
    results.push({
      name: "hooks",
      category: "Settings",
      status: "pass",
      message: presentHooks.map(e => `${e} \u2713`).join("  "),
    });
  } else {
    try {
      const merged = mergeClaudeSettings(settingsData);
      deps.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
      results.push({
        name: "hooks",
        category: "Settings",
        status: "warn",
        message: `Missing ${missingHooks.join(", ")} — fixed`,
        fixApplied: true,
      });
    } catch {
      results.push({
        name: "hooks",
        category: "Settings",
        status: "fail",
        message: `Missing ${missingHooks.join(", ")} — run: lossless-claude install`,
      });
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
  console.log(`\n${COLORS.bold}🧠 lossless-claude${COLORS.nc}`);

  let currentCategory = "";

  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      const label = ` ${currentCategory} `;
      const dashes = "─".repeat(42 - 3 - label.length);
      console.log(`\n${COLORS.cyan}──${label}${dashes}${COLORS.nc}`);
    }
    if (r.name === "stack") {
      console.log(`    ${COLORS.dim}${r.message}${COLORS.nc}`);
      continue;
    }

    const icon =
      r.status === "pass" ? `${COLORS.green}✅${COLORS.nc}` :
      r.status === "warn" ? `${COLORS.yellow}⚠️ ${COLORS.nc}` :
                            `${COLORS.red}❌${COLORS.nc}`;
    const suffix = r.fixApplied ? ` ${COLORS.dim}(auto-fixed)${COLORS.nc}` : "";
    console.log(`    ${icon} ${COLORS.dim}${r.name}${COLORS.nc}  ${r.message}${suffix}`);
  }

  const pass = results.filter(r => r.status === "pass" && r.name !== "stack").length;
  const fail = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;

  console.log(`\n  ${pass} passed · ${fail} failed · ${warn} warnings\n`);
}

export function formatResultsPlain(results: CheckResult[]): string {
  const lines: string[] = [];

  // Group results by category
  const categories: Map<string, CheckResult[]> = new Map();
  for (const r of results) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  for (const [category, items] of categories) {
    lines.push(`## ${category}`);

    // Stack entries (name === "stack") go as plain text before the table
    for (const r of items) {
      if (r.name === "stack") {
        lines.push(r.message);
      }
    }

    const tableItems = items.filter(r => r.name !== "stack");
    if (tableItems.length > 0) {
      lines.push("");
      lines.push("| Check | Status |");
      lines.push("|---|---|");
      for (const r of tableItems) {
        const icon = r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
        const suffix = r.fixApplied ? " (auto-fixed)" : "";
        lines.push(`| ${r.name} | ${icon} ${r.message}${suffix} |`);
      }
    }

    lines.push("");
  }

  const pass = results.filter(r => r.status === "pass" && r.name !== "stack").length;
  const fail = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;
  lines.push(`${pass} passed · ${fail} failed · ${warn} warnings`);
  return lines.join("\n");
}
