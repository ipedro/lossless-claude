import { describe, it, expect } from "vitest";
import { ScrubEngine } from "../src/scrub.js";

describe("ScrubEngine — built-in patterns", () => {
  const engine = new ScrubEngine([], []);

  it("redacts OpenAI keys (sk-...)", () => {
    expect(engine.scrub("key=sk-abcdefghijklmnopqrstu")).toContain("[REDACTED]");
  });

  it("redacts Anthropic keys (sk-ant-...)", () => {
    expect(engine.scrub("key=sk-ant-api03-" + "a".repeat(40))).toContain("[REDACTED]");
  });

  it("redacts GitHub PATs (ghp_...)", () => {
    expect(engine.scrub("token=ghp_" + "A".repeat(36))).toContain("[REDACTED]");
  });

  it("redacts AWS access key IDs (AKIA...)", () => {
    expect(engine.scrub("aws_access_key_id=AKIAIOSFODNN7EXAMPLE")).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    expect(engine.scrub("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9")).toContain("[REDACTED]");
  });

  it("redacts PEM key headers", () => {
    expect(engine.scrub("-----BEGIN RSA KEY-----")).toContain("[REDACTED]");
  });

  it("does not redact normal text", () => {
    const text = "Hello world, this is safe content.";
    expect(engine.scrub(text)).toBe(text);
  });
});

describe("ScrubEngine — custom patterns", () => {
  it("applies user-defined global patterns", () => {
    const engine = new ScrubEngine(["MY_TOKEN_[A-Z0-9]+"], []);
    expect(engine.scrub("token=MY_TOKEN_ABC123")).toContain("[REDACTED]");
  });

  it("applies per-project patterns", () => {
    const engine = new ScrubEngine([], ["PROJ_SECRET_[A-Z]+"]);
    expect(engine.scrub("secret=PROJ_SECRET_XYZ")).toContain("[REDACTED]");
  });

  it("global patterns precede project patterns (merge order)", () => {
    const engine = new ScrubEngine(["GLOBAL_[A-Z0-9]+"], ["LOCAL_[A-Z0-9]+"]);
    expect(engine.scrub("GLOBAL_123 and LOCAL_456")).toBe("[REDACTED] and [REDACTED]");
  });

  it("warns and skips invalid regex patterns, continues scrubbing valid ones", () => {
    const engine = new ScrubEngine(["[invalid"], ["VALID_[A-Z]+"]);
    expect(engine.scrub("VALID_ABC")).toContain("[REDACTED]");
    expect(engine.invalidPatterns).toContain("[invalid");
  });
});

describe("ScrubEngine.loadProjectPatterns", () => {
  it("parses patterns file, ignoring comment lines and blanks", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(tmpdir(), "sensitive-patterns-test.txt");
    await writeFile(file, "# comment\nMY_PAT\n\n# another comment\nSECRET_KEY\n");
    const patterns = await ScrubEngine.loadProjectPatterns(file);
    expect(patterns).toEqual(["MY_PAT", "SECRET_KEY"]);
  });

  it("returns empty array when file does not exist", async () => {
    const patterns = await ScrubEngine.loadProjectPatterns("/nonexistent/path.txt");
    expect(patterns).toEqual([]);
  });
});
