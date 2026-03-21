#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, argv, cwd as getCwd, exit } from "node:process";
import { createLosslessCodexSessionId, createRunLosslessCodexDeps, runLosslessCodexTurn } from "../src/adapters/codex.js";

async function main(): Promise<void> {
  const session = {
    lcmSessionId: createLosslessCodexSessionId(),
    cwd: getCwd(),
    restoreLoaded: false,
  };

  let activeChild: { kill: (signal?: NodeJS.Signals | number) => boolean } | undefined;
  const deps = createRunLosslessCodexDeps();
  deps.onSpawnedProcess = (child) => {
    activeChild = child;
  };

  const cleanupAndExit = (code: number) => {
    activeChild?.kill("SIGINT");
    exit(code);
  };

  process.on("SIGINT", () => cleanupAndExit(130));
  process.on("SIGTERM", () => cleanupAndExit(143));

  const runPrompt = async (prompt: string): Promise<number> => {
    const trimmed = prompt.trim();
    if (!trimmed) return 0;

    const result = await runLosslessCodexTurn(session, trimmed, deps);
    activeChild = undefined;

    if (result.exitCode !== 0) {
      if (result.stderr.trim()) {
        stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
      }
      return result.exitCode;
    }

    const output = result.assistantText || result.stdout.trim();
    if (output) {
      stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    }
    return 0;
  };

  const firstPrompt = argv.slice(2).join(" ").trim();
  if (firstPrompt) {
    exit(await runPrompt(firstPrompt));
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  try {
    while (true) {
      const prompt = await rl.question("> ");
      const code = await runPrompt(prompt);
      if (code !== 0) {
        rl.close();
        exit(code);
      }
    }
  } catch {
    rl.close();
  }
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
