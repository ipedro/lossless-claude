import { describe, it, expect } from "vitest";
import { loadDaemonConfig } from "../../src/daemon/config.js";

describe("loadDaemonConfig", () => {
  it("returns defaults when no config file exists", () => {
    const c = loadDaemonConfig("/nonexistent/config.json");
    expect(c.daemon.port).toBe(3737);
    expect(c.daemon.socketPath).toContain("daemon.sock");
    expect(c.llm.model).toBe("claude-haiku-4-5");
    expect(c.compaction.leafTokens).toBe(1000);
    expect(c.restoration.recentSummaries).toBe(3);
    expect(c.restoration.semanticTopK).toBe(5);
    expect(c.version).toBe(1);
  });

  it("merges partial config over defaults", () => {
    const c = loadDaemonConfig("/nonexistent/config.json", { daemon: { port: 4000 } });
    expect(c.daemon.port).toBe(4000);
    expect(c.daemon.socketPath).toContain("daemon.sock");
  });

  it("interpolates ${ANTHROPIC_API_KEY} from env", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { apiKey: "${ANTHROPIC_API_KEY}" } }, { ANTHROPIC_API_KEY: "sk-test" });
    expect(c.llm.apiKey).toBe("sk-test");
  });

  it("falls back to env var when apiKey not set and provider is anthropic", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic" } }, { ANTHROPIC_API_KEY: "sk-env" });
    expect(c.llm.apiKey).toBe("sk-env");
  });

  it("defaults provider to 'openai' (resolved from claude-cli) with localhost baseURL", () => {
    const c = loadDaemonConfig("/nonexistent/config.json");
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:3456/v1");
  });

  it("merges provider and baseURL from file config", () => {
    const c = loadDaemonConfig("/nonexistent/config.json", {
      llm: { provider: "openai", baseURL: "http://localhost:11435/v1", model: "qwen2.5:14b" }
    });
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:11435/v1");
    expect(c.llm.model).toBe("qwen2.5:14b");
  });

  it("does NOT inject ANTHROPIC_API_KEY when provider is openai", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "openai" } }, { ANTHROPIC_API_KEY: "sk-leaked" });
    expect(c.llm.apiKey).toBe("");
  });

  it("still injects ANTHROPIC_API_KEY when provider is anthropic", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic" } }, { ANTHROPIC_API_KEY: "sk-env" });
    expect(c.llm.apiKey).toBe("sk-env");
  });

  it("resolves 'claude-cli' provider to 'openai' with localhost baseURL", () => {
    const c = loadDaemonConfig("/nonexistent", {
      llm: { provider: "claude-cli" },
    });
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:3456/v1");
  });

  it("resolves 'claude-cli' + claudeCliProxy.port override to correct baseURL", () => {
    const c = loadDaemonConfig("/nonexistent", {
      llm: { provider: "claude-cli" },
      claudeCliProxy: { port: 9999 },
    });
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:9999/v1");
  });

  it("resolves 'claude-cli' + claudeCliProxy.enabled=false to 'disabled'", () => {
    const c = loadDaemonConfig("/nonexistent", {
      llm: { provider: "claude-cli" },
      claudeCliProxy: { enabled: false },
    });
    expect(c.llm.provider).toBe("disabled");
  });

  it("throws when provider resolves to 'anthropic' and apiKey is missing", () => {
    expect(() =>
      loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic", apiKey: "" } }, {})
    ).toThrow("LCM_SUMMARY_API_KEY is required");
  });

  it("does not throw for 'anthropic' when apiKey is provided", () => {
    expect(() =>
      loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic", apiKey: "sk-test" } }, {})
    ).not.toThrow();
  });

  it("does not throw for 'anthropic' when ANTHROPIC_API_KEY env var is set", () => {
    expect(() =>
      loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic" } }, { ANTHROPIC_API_KEY: "sk-env" })
    ).not.toThrow();
  });

  it("LCM_SUMMARY_PROVIDER env var overrides config provider", () => {
    const c = loadDaemonConfig(
      "/nonexistent",
      { llm: { provider: "claude-cli" } },
      { LCM_SUMMARY_PROVIDER: "openai" }
    );
    expect(c.llm.provider).toBe("openai");
  });

  it("LCM_SUMMARY_PROVIDER=anthropic disables claudeCliProxy", () => {
    const c = loadDaemonConfig(
      "/nonexistent",
      { llm: { provider: "claude-cli", apiKey: "sk-test" } },
      { LCM_SUMMARY_PROVIDER: "anthropic" }
    );
    expect(c.llm.provider).toBe("anthropic");
    expect(c.claudeCliProxy.enabled).toBe(false);
  });

  it("defaults claudeCliProxy fields correctly", () => {
    const c = loadDaemonConfig("/nonexistent");
    expect(c.claudeCliProxy).toEqual({
      enabled: true,
      port: 3456,
      startupTimeoutMs: 10000,
      model: "claude-haiku-4-5",
    });
  });

  it("defaults llm.provider to 'claude-cli' (resolves to openai + localhost)", () => {
    const c = loadDaemonConfig("/nonexistent");
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:3456/v1");
  });

  it("disables claudeCliProxy when provider is explicitly set to 'anthropic'", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic", apiKey: "sk-test" } }, {});
    expect(c.claudeCliProxy.enabled).toBe(false);
  });

  it("disables claudeCliProxy when provider is explicitly set to 'openai'", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "openai", baseURL: "http://custom/v1" } }, {});
    expect(c.claudeCliProxy.enabled).toBe(false);
  });

  it("throws when LCM_SUMMARY_PROVIDER is set to an invalid value", () => {
    expect(() =>
      loadDaemonConfig("/nonexistent", {}, { LCM_SUMMARY_PROVIDER: "ollama" })
    ).toThrow('Invalid LCM_SUMMARY_PROVIDER="ollama"');
  });
});
