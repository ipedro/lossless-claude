import { describe, it, expect } from "vitest";
import pkg from "../package.json";

describe("package.json", () => {
  it("has correct name", () => expect(pkg.name).toBe("@ipedro/lossless-claude"));
  it("has bin entry", () => expect(pkg.bin).toHaveProperty("lossless-claude"));
  it("has anthropic sdk", () => expect(pkg.dependencies).toHaveProperty("@anthropic-ai/sdk"));
  it("has mcp sdk", () => expect(pkg.dependencies).toHaveProperty("@modelcontextprotocol/sdk"));
  it("does not have pi-ai", () => expect(pkg.dependencies).not.toHaveProperty("@mariozechner/pi-ai"));
  it("does not have pi-agent-core", () => expect(pkg.dependencies).not.toHaveProperty("@mariozechner/pi-agent-core"));

  it("does not use prepack (breaks npm install from git without node_modules)", () => {
    expect(pkg.scripts).not.toHaveProperty("prepack");
  });

  it("uses prepublishOnly for build (only runs during npm publish)", () => {
    expect(pkg.scripts).toHaveProperty("prepublishOnly", "npm run build");
  });
});
