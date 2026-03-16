/**
 * Compatibility bridge for Claude Code plugin-sdk context-engine symbols.
 *
 * This module intentionally exports only stable plugin-sdk surface area.
 */

export type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  IngestResult,
  IngestBatchResult,
  BootstrapResult,
  SubagentSpawnPreparation,
  SubagentEndReason,
} from "openclaw/plugin-sdk";

export {
  registerContextEngine,
  type ContextEngineFactory,
} from "openclaw/plugin-sdk";

// TODO: Replace openclaw/plugin-sdk imports with Claude Code SDK when available
export type ClaudePluginApi = import("openclaw/plugin-sdk").OpenClawPluginApi;
