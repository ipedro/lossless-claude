import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../daemon/client.js";
import { ensureDaemon, type EnsureDaemonOptions, type EnsureDaemonResult } from "../daemon/lifecycle.js";
import { estimateTokens, type ParsedMessage } from "../transcript.js";

type CodexContentBlock = {
  type?: string;
  text?: string;
};

type CodexMessageEvent = {
  type: "message";
  role?: string;
  content?: string | CodexContentBlock[];
};

type CodexCommandExecutionItem = {
  type: "command_execution";
  command?: string;
  aggregated_output?: string;
};

type CodexAgentMessageItem = {
  type: "agent_message";
  text?: string;
};

type CodexCompletedItemEvent = {
  type: "item.completed";
  item?: CodexCommandExecutionItem | CodexAgentMessageItem | Record<string, unknown>;
};

type CodexThreadStartedEvent = {
  type: "thread.started";
  thread_id?: string;
};

type CodexEvent = CodexMessageEvent | CodexCompletedItemEvent | CodexThreadStartedEvent | Record<string, unknown>;

export type LosslessCodexSession = {
  lcmSessionId: string;
  codexSessionId?: string;
  cwd: string;
  restoreLoaded: boolean;
};

export type RunLosslessCodexDeps = {
  ensureDaemon: (opts: EnsureDaemonOptions) => Promise<EnsureDaemonResult>;
  client: { post: <T = unknown>(path: string, body: unknown) => Promise<T> };
  spawn: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
  onSpawnedProcess?: (child: ChildProcessWithoutNullStreams) => void;
  resolveBinaryPath: () => string;
  resolveNativeCodexSessionId: (jsonl: string) => Promise<string | undefined> | string | undefined;
};

export type LosslessCodexTurnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  assistantText: string;
};

function getMissingCodexCliMessage(): string {
  return [
    "Codex CLI is not installed or not on PATH.",
    "Install it first, for example: npm install -g @openai/codex",
    "Then run lossless-codex again.",
  ].join("\n");
}

function stripMarkup(text: string): string {
  return text.replace(/<\/?[\w-]+>/g, "").trim();
}

function extractMessageText(content: string | CodexContentBlock[] | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pushMessage(messages: ParsedMessage[], role: ParsedMessage["role"], content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  messages.push({ role, content: trimmed, tokenCount: estimateTokens(trimmed) });
}

function parseJsonl(jsonl: string, strict = false): CodexEvent[] {
  const events: CodexEvent[] = [];

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      events.push(JSON.parse(trimmed) as CodexEvent);
    } catch (error) {
      if (strict) throw error;
    }
  }

  return events;
}

function isCodexMessageEvent(event: CodexEvent): event is CodexMessageEvent {
  return event.type === "message";
}

function isCodexCompletedItemEvent(event: CodexEvent): event is CodexCompletedItemEvent {
  return event.type === "item.completed";
}

function isCodexThreadStartedEvent(event: CodexEvent): event is CodexThreadStartedEvent {
  return event.type === "thread.started";
}

function isCommandExecutionItem(item: unknown): item is CodexCommandExecutionItem {
  return Boolean(item) && typeof item === "object" && (item as { type?: string }).type === "command_execution";
}

function isAgentMessageItem(item: unknown): item is CodexAgentMessageItem {
  return Boolean(item) && typeof item === "object" && (item as { type?: string }).type === "agent_message";
}

function normalizeEvents(events: CodexEvent[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const event of events) {
    if (isCodexMessageEvent(event)) {
      const role = event.role;
      if (!role || !["user", "assistant", "system"].includes(role)) continue;
      pushMessage(messages, role as ParsedMessage["role"], extractMessageText(event.content));
      continue;
    }

    if (!isCodexCompletedItemEvent(event) || !event.item) continue;

    if (isCommandExecutionItem(event.item)) {
      if (typeof event.item.command === "string" && event.item.command.trim()) {
        pushMessage(messages, "assistant", `Tool call shell: ${event.item.command}`);
      }
      if (typeof event.item.aggregated_output === "string" && event.item.aggregated_output.trim()) {
        pushMessage(messages, "tool", event.item.aggregated_output);
      }
      continue;
    }

    if (isAgentMessageItem(event.item) && typeof event.item.text === "string") {
      pushMessage(messages, "assistant", event.item.text);
    }
  }

  return messages;
}

function extractThreadId(jsonl: string): string | undefined {
  for (const event of parseJsonl(jsonl)) {
    if (isCodexThreadStartedEvent(event) && typeof event.thread_id === "string" && event.thread_id.trim()) {
      return event.thread_id;
    }
  }

  return undefined;
}

function ensureUserMessage(messages: ParsedMessage[], userPrompt: string): ParsedMessage[] {
  if (messages.some((message) => message.role === "user")) {
    return messages;
  }

  return [
    { role: "user", content: userPrompt, tokenCount: estimateTokens(userPrompt) },
    ...messages,
  ];
}

function getLastAssistantText(messages: ParsedMessage[]): string {
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant" && !message.content.startsWith("Tool call "),
  );
  return assistantMessages.at(-1)?.content ?? "";
}

async function runCodexCommand(
  command: string,
  args: string[],
  cwd: string,
  deps: Pick<RunLosslessCodexDeps, "spawn" | "onSpawnedProcess">,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = deps.spawn(command, args, {
    cwd,
    env: { ...process.env },
    stdio: "pipe",
  });
  deps.onSpawnedProcess?.(child);

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  return { exitCode, stdout, stderr };
}

export function createLosslessCodexSessionId(): string {
  return `codex-${randomUUID()}`;
}

export function composeCodexTurnPrompt(input: {
  restoreContext?: string;
  promptHints?: string[];
  userPrompt: string;
}): string {
  const sections: string[] = [];

  const restoreContext = input.restoreContext ? stripMarkup(input.restoreContext) : "";
  if (restoreContext) {
    sections.push(["Shared memory context:", restoreContext].join("\n"));
  }

  if (input.promptHints && input.promptHints.length > 0) {
    sections.push([
      "Relevant memory hints:",
      ...input.promptHints.map((hint) => `- ${stripMarkup(hint)}`),
    ].join("\n"));
  }

  sections.push(["User prompt:", input.userPrompt].join("\n"));
  return sections.filter(Boolean).join("\n\n");
}

export function normalizeCodexExecJsonl(jsonl: string): ParsedMessage[] {
  return normalizeEvents(parseJsonl(jsonl));
}

export function createRunLosslessCodexDeps(port = 3737): RunLosslessCodexDeps {
  const client = new DaemonClient(`http://127.0.0.1:${port}`);

  return {
    ensureDaemon,
    client,
    spawn,
    onSpawnedProcess: undefined,
    resolveBinaryPath: () => "lossless-claude",
    resolveNativeCodexSessionId: async (jsonl: string) => extractThreadId(jsonl),
  };
}

export async function runLosslessCodexTurn(
  session: LosslessCodexSession,
  userPrompt: string,
  deps: RunLosslessCodexDeps = createRunLosslessCodexDeps(),
): Promise<LosslessCodexTurnResult> {
  const pidFilePath = join(homedir(), ".lossless-claude", "daemon.pid");

  let restoreContext = "";
  let promptHints: string[] = [];
  let daemonConnected = false;

  try {
    const daemon = await deps.ensureDaemon({
      port: 3737,
      pidFilePath,
      spawnTimeoutMs: 5000,
      spawnCommand: deps.resolveBinaryPath(),
      spawnArgs: ["daemon", "start"],
    });
    daemonConnected = daemon.connected;

    if (daemonConnected) {
      if (!session.restoreLoaded) {
        const restore = await deps.client.post<{ context?: string }>("/restore", {
          session_id: session.lcmSessionId,
          cwd: session.cwd,
        });
        restoreContext = restore.context ?? "";
        session.restoreLoaded = true;
      }

      const promptSearch = await deps.client.post<{ hints?: string[] }>("/prompt-search", {
        query: userPrompt,
        cwd: session.cwd,
        session_id: session.lcmSessionId,
      });
      promptHints = promptSearch.hints ?? [];
    }
  } catch {
    daemonConnected = false;
  }

  const prompt = daemonConnected
    ? composeCodexTurnPrompt({ restoreContext, promptHints, userPrompt })
    : userPrompt;

  const args = session.codexSessionId
    ? ["exec", "resume", session.codexSessionId, "--json", prompt]
    : ["exec", "--json", prompt];

  let commandResult: { exitCode: number; stdout: string; stderr: string };
  try {
    commandResult = await runCodexCommand("codex", args, session.cwd, deps);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: getMissingCodexCliMessage(),
        assistantText: "",
      };
    }
    throw error;
  }

  const { exitCode, stdout, stderr } = commandResult;
  if (exitCode !== 0) {
    return {
      exitCode,
      stdout,
      stderr,
      assistantText: "",
    };
  }

  if (!session.codexSessionId) {
    try {
      session.codexSessionId = (await deps.resolveNativeCodexSessionId(stdout)) ?? extractThreadId(stdout);
    } catch {
      session.codexSessionId = extractThreadId(stdout);
    }
  }

  let parsedMessages: ParsedMessage[] | undefined;
  try {
    parsedMessages = ensureUserMessage(normalizeEvents(parseJsonl(stdout, true)), userPrompt);
  } catch {
    parsedMessages = undefined;
  }

  if (daemonConnected && parsedMessages && parsedMessages.length > 0) {
    try {
      await deps.client.post("/ingest", {
        session_id: session.lcmSessionId,
        cwd: session.cwd,
        messages: parsedMessages,
      });
      await deps.client.post("/compact", {
        session_id: session.lcmSessionId,
        cwd: session.cwd,
        skip_ingest: true,
        client: "codex",
      });
    } catch {
      // Degrade silently when memory writes fail after Codex succeeds.
    }
  }

  return {
    exitCode,
    stdout,
    stderr,
    assistantText: parsedMessages ? getLastAssistantText(parsedMessages) : "",
  };
}
