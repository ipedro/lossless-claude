import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BUILT_IN_PATTERNS: string[] = [
  "sk-[A-Za-z0-9]{20,}",
  "sk-ant-[A-Za-z0-9\\-]{40,}",
  "ghp_[A-Za-z0-9]{36}",
  "AKIA[0-9A-Z]{16}",
  "-----BEGIN .* KEY-----",
  "Bearer [A-Za-z0-9\\-._~+/]+=*",
  "[Pp]assword\\s*[:=]\\s*\\S+",
];

/**
 * Returns true if a regex pattern source can match across whitespace boundaries.
 * Patterns containing a literal space, \s, or a dot (which matches space) are
 * considered "spanning" and will be applied to the full text rather than
 * token-by-token.
 */
function isSpanningPattern(source: string): boolean {
  // Check for literal space or \s — unambiguous spanning intent
  if (/ |\s/.test(source)) return true;
  // Check for unescaped `.` which can match spaces
  // Walk the source and look for `.` not preceded by `\`
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (source[i] === ".") return true;
  }
  return false;
}

export class ScrubEngine {
  private readonly spanningPatterns: Array<{ source: string; regex: RegExp }> = [];
  private readonly tokenPatterns: Array<{ source: string; regex: RegExp }> = [];
  readonly invalidPatterns: string[] = [];

  constructor(globalPatterns: string[], projectPatterns: string[]) {
    const all = [...BUILT_IN_PATTERNS, ...globalPatterns, ...projectPatterns];
    for (const source of all) {
      try {
        const regex = new RegExp(source, "g");
        if (isSpanningPattern(source)) {
          this.spanningPatterns.push({ source, regex });
        } else {
          this.tokenPatterns.push({ source, regex });
        }
      } catch {
        this.invalidPatterns.push(source);
      }
    }
  }

  /**
   * Redact all matching patterns in text, replacing matches with [REDACTED].
   *
   * Strategy:
   * - "Spanning" patterns (those that can match across whitespace) are applied
   *   to the full text via a multi-range merge to avoid one pattern consuming
   *   another's matches.
   * - "Token" patterns (no whitespace/dot in source) are applied token-by-token
   *   so that greedy `.*`-style patterns in one token don't eat adjacent tokens.
   */
  scrub(text: string): string {
    // Step 1: collect ranges from spanning patterns applied to full text
    const ranges: Array<[number, number]> = [];
    for (const { regex } of this.spanningPatterns) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) regex.lastIndex++;
      }
    }

    // Step 2: apply token patterns per whitespace-separated segment
    // Split text into alternating [content, separator] pairs
    const segments = text.split(/(\s+)/);
    const tokenRanges: Array<[number, number]> = [];
    let offset = 0;
    for (const seg of segments) {
      // Only apply token patterns to non-whitespace segments
      if (!/^\s+$/.test(seg) && this.tokenPatterns.length > 0) {
        for (const { regex } of this.tokenPatterns) {
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(seg)) !== null) {
            tokenRanges.push([offset + m.index, offset + m.index + m[0].length]);
            if (m[0].length === 0) regex.lastIndex++;
          }
        }
      }
      offset += seg.length;
    }

    const allRanges = [...ranges, ...tokenRanges];
    if (allRanges.length === 0) return text;

    // Sort and merge overlapping ranges
    allRanges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    let [curStart, curEnd] = allRanges[0];
    for (let i = 1; i < allRanges.length; i++) {
      const [s, e] = allRanges[i];
      if (s <= curEnd) {
        curEnd = Math.max(curEnd, e);
      } else {
        merged.push([curStart, curEnd]);
        curStart = s;
        curEnd = e;
      }
    }
    merged.push([curStart, curEnd]);

    // Build result
    let result = "";
    let pos = 0;
    for (const [s, e] of merged) {
      result += text.slice(pos, s) + "[REDACTED]";
      pos = e;
    }
    result += text.slice(pos);
    return result;
  }

  /** Parse a sensitive-patterns.txt file. Returns empty array if file is absent. */
  static async loadProjectPatterns(filePath: string): Promise<string[]> {
    try {
      const content = await readFile(filePath, "utf-8");
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    } catch {
      return [];
    }
  }

  /** Build a ScrubEngine for a given project directory. */
  static async forProject(
    globalPatterns: string[],
    projectDir: string,
  ): Promise<ScrubEngine> {
    const projectPatterns = await ScrubEngine.loadProjectPatterns(
      join(projectDir, "sensitive-patterns.txt"),
    );
    return new ScrubEngine(globalPatterns, projectPatterns);
  }
}
