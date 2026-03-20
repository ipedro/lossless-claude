import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createDaemon } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";
import { runLcmMigrations } from "../../../src/db/migration.js";
import { PromotedStore } from "../../../src/db/promoted.js";
import { projectDbPath } from "../../../src/daemon/project.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /prompt-search", () => {
  it("returns hints for matching promoted entries", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-prompt-search-"));
    tempDirs.push(tempDir);

    // Pre-populate promoted table
    const dbPath = projectDbPath(tempDir);
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    runLcmMigrations(db);
    const store = new PromotedStore(db);
    store.insert({ content: "We decided to use React for the frontend", tags: ["decision"], projectId: "p1" });
    store.insert({ content: "Database is PostgreSQL running on port 5432", tags: ["decision"], projectId: "p1" });
    db.close();

    const config = loadDaemonConfig("/nonexistent");
    config.daemon.port = 0;
    // Set minScore to 0 so all FTS5 matches pass the filter (rank is always negative)
    config.restoration.promptSearchMinScore = 0;
    const daemon = await createDaemon(config);
    const port = daemon.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "React frontend", cwd: tempDir }),
      });
      const data = await res.json() as { hints: string[] };
      expect(res.status).toBe(200);
      expect(Array.isArray(data.hints)).toBe(true);
      expect(data.hints.length).toBeGreaterThanOrEqual(1);
      expect(data.hints[0]).toContain("React");
    } finally {
      await daemon.stop();
    }
  });

  it("returns empty hints when no entries match", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-prompt-search-nomatch-"));
    tempDirs.push(tempDir);

    // Pre-populate with unrelated content
    const dbPath = projectDbPath(tempDir);
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    runLcmMigrations(db);
    const store = new PromotedStore(db);
    store.insert({ content: "We decided to use React for the frontend", tags: ["decision"], projectId: "p1" });
    db.close();

    const config = loadDaemonConfig("/nonexistent");
    config.daemon.port = 0;
    // High minScore to filter out weak matches
    config.restoration.promptSearchMinScore = 999;
    const daemon = await createDaemon(config);
    const port = daemon.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "React", cwd: tempDir }),
      });
      const data = await res.json() as { hints: string[] };
      expect(res.status).toBe(200);
      expect(data.hints).toEqual([]);
    } finally {
      await daemon.stop();
    }
  });

  it("returns empty hints when no db exists", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-prompt-search-nodb-"));
    tempDirs.push(tempDir);

    const config = loadDaemonConfig("/nonexistent");
    config.daemon.port = 0;
    const daemon = await createDaemon(config);
    const port = daemon.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "something", cwd: tempDir }),
      });
      const data = await res.json() as { hints: string[] };
      expect(res.status).toBe(200);
      expect(data.hints).toEqual([]);
    } finally {
      await daemon.stop();
    }
  });

  it("returns empty hints when query or cwd is missing", async () => {
    const config = loadDaemonConfig("/nonexistent");
    config.daemon.port = 0;
    const daemon = await createDaemon(config);
    const port = daemon.address().port;

    try {
      // Missing query
      const res1 = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: "/some/dir" }),
      });
      const data1 = await res1.json() as { hints: string[] };
      expect(res1.status).toBe(200);
      expect(data1.hints).toEqual([]);

      // Missing cwd
      const res2 = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "something" }),
      });
      const data2 = await res2.json() as { hints: string[] };
      expect(res2.status).toBe(200);
      expect(data2.hints).toEqual([]);
    } finally {
      await daemon.stop();
    }
  });

  it("truncates long content to snippetLength", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-prompt-search-truncate-"));
    tempDirs.push(tempDir);

    const longContent = "React " + "x".repeat(300);
    const dbPath = projectDbPath(tempDir);
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    runLcmMigrations(db);
    const store = new PromotedStore(db);
    store.insert({ content: longContent, tags: [], projectId: "p1" });
    db.close();

    const config = loadDaemonConfig("/nonexistent");
    config.daemon.port = 0;
    config.restoration.promptSearchMinScore = 0;
    config.restoration.promptSnippetLength = 50;
    const daemon = await createDaemon(config);
    const port = daemon.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/prompt-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "React", cwd: tempDir }),
      });
      const data = await res.json() as { hints: string[] };
      expect(res.status).toBe(200);
      expect(data.hints.length).toBeGreaterThanOrEqual(1);
      expect(data.hints[0].length).toBeLessThanOrEqual(53); // 50 + "..."
      expect(data.hints[0].endsWith("...")).toBe(true);
    } finally {
      await daemon.stop();
    }
  });
});
