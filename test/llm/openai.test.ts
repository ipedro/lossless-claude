import { describe, it, expect } from "vitest";
import type { LcmSummarizeFn } from "../../src/llm/types.js";

describe("LcmSummarizeFn type", () => {
  it("is importable from types.ts", () => {
    // If this file compiles, the type exists
    const fn: LcmSummarizeFn = async (_text, _aggressive, _ctx) => "ok";
    expect(typeof fn).toBe("function");
  });
});
