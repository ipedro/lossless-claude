import { describe, it, expect } from "vitest";
import { AGENTS, findAgent } from "../../src/connectors/registry.js";
import { CONNECTOR_TYPES, requiresRestart } from "../../src/connectors/types.js";

describe("connector registry", () => {
  it("has exactly 22 agents", () => {
    expect(AGENTS).toHaveLength(22);
  });

  it("all agents have required fields", () => {
    for (const agent of AGENTS) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.category).toBeTruthy();
      expect(CONNECTOR_TYPES).toContain(agent.defaultType);
      expect(agent.supportedTypes.length).toBeGreaterThan(0);
      expect(agent.supportedTypes).toContain(agent.defaultType);
    }
  });

  it("all agent ids are unique", () => {
    const ids = AGENTS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("configPaths keys match supportedTypes", () => {
    for (const agent of AGENTS) {
      const configKeys = Object.keys(agent.configPaths);
      for (const key of configKeys) {
        expect(agent.supportedTypes).toContain(key);
      }
    }
  });

  it("findAgent works by id and name", () => {
    expect(findAgent("claude-code")?.name).toBe("Claude Code");
    expect(findAgent("Claude Code")?.id).toBe("claude-code");
    expect(findAgent("nonexistent")).toBeUndefined();
  });

  it("requiresRestart returns false only for rules", () => {
    expect(requiresRestart("rules")).toBe(false);
    expect(requiresRestart("hook")).toBe(true);
    expect(requiresRestart("mcp")).toBe(true);
    expect(requiresRestart("skill")).toBe(true);
  });
});
