#!/usr/bin/env node
import { argv, exit, stdin, stdout } from "node:process";

const command = argv[2];

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (stdin.isTTY) { resolve(""); return; }
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function main() {
  // Handle flags before switch
  if (command === "--version" || command === "-v") {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    stdout.write(pkg.version + "\n");
    exit(0);
  }

  switch (command) {
    case "daemon": {
      if (argv[3] === "start") {
        if (argv.includes("--detach")) {
          const { spawn } = await import("node:child_process");
          const child = spawn(process.execPath, [process.argv[1], "daemon", "start"], {
            detached: true,
            stdio: "ignore",
            env: process.env,
          });
          child.unref();
          if (child.pid) {
            const { writeFileSync, mkdirSync } = await import("node:fs");
            const { join } = await import("node:path");
            const { homedir } = await import("node:os");
            const lcDir = join(homedir(), ".lossless-claude");
            mkdirSync(lcDir, { recursive: true });
            writeFileSync(join(lcDir, "daemon.pid"), String(child.pid));
            console.log(`lossless-claude daemon started in background (PID ${child.pid})`);
          }
          exit(0);
        }
        const { createDaemon } = await import("../src/daemon/server.js");
        const { loadDaemonConfig } = await import("../src/daemon/config.js");
        const { join } = await import("node:path");
        const { homedir } = await import("node:os");
        const config = loadDaemonConfig(join(homedir(), ".lossless-claude", "config.json"));
        const daemon = await createDaemon(config);
        console.log(`lossless-claude daemon started on port ${daemon.address().port}`);
        process.on("SIGTERM", () => exit(0));
        process.on("SIGINT", () => exit(0));
      }
      break;
    }
    case "compact":
    case "restore":
    case "session-end":
    case "user-prompt": {
      const { dispatchHook } = await import("../src/hooks/dispatch.js");
      const input = await readStdin();
      const r = await dispatchHook(command, input);
      if (r.stdout) stdout.write(r.stdout);
      exit(r.exitCode);
      break;
    }
    case "mcp": {
      const { startMcpServer } = await import("../src/mcp/server.js");
      await startMcpServer();
      break;
    }
    case "install": {
      const dryRun = argv.includes("--dry-run");
      const { install } = await import("../installer/install.js");
      if (dryRun) {
        const { DryRunServiceDeps } = await import("../installer/dry-run-deps.js");
        console.log("\n  lossless-claude install --dry-run\n");
        await install(new DryRunServiceDeps());
        console.log("\n  No changes written.");
      } else {
        await install();
      }
      break;
    }
    case "uninstall": {
      const dryRun = argv.includes("--dry-run");
      const { uninstall } = await import("../installer/uninstall.js");
      if (dryRun) {
        const { DryRunServiceDeps } = await import("../installer/dry-run-deps.js");
        console.log("\n  lossless-claude uninstall --dry-run\n");
        await uninstall(new DryRunServiceDeps());
        console.log("\n  No changes written.");
      } else {
        await uninstall();
      }
      break;
    }
    case "status": {
      const { loadDaemonConfig } = await import("../src/daemon/config.js");
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");
      const config = loadDaemonConfig(join(homedir(), ".lossless-claude", "config.json"));
      const port = config.daemon?.port ?? 3737;

      let daemonStatus = "down";
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) daemonStatus = "up";
      } catch {}

      const provider = config.llm?.provider ?? "unknown";
      const providerDisplay = provider === "auto"
        ? "auto (Claude->claude-process, Codex->codex-process)"
        : provider;
      console.log(`daemon: ${daemonStatus} · provider: ${providerDisplay}`);
      break;
    }
    case "stats": {
      const verbose = argv.includes("--verbose") || argv.includes("-v");
      const { collectStats, printStats } = await import("../src/stats.js");
      printStats(collectStats(), verbose);
      break;
    }
    case "doctor": {
      const { runDoctor, printResults } = await import("../src/doctor/doctor.js");
      const results = await runDoctor();
      printResults(results);
      const failures = results.filter((r: { status: string }) => r.status === "fail");
      exit(failures.length > 0 ? 1 : 0);
      break;
    }
    default:
      console.error("Usage: lossless-claude <daemon|compact|restore|session-end|user-prompt|mcp|install|uninstall|doctor|status|stats> [--dry-run|-v]");
      exit(1);
  }
}

main().catch((err) => { console.error(err); exit(1); });
