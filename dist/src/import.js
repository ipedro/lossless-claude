import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
export function cwdToProjectHash(cwd) {
    return cwd.replace(/\//g, '-').replace(/^-/, '');
}
function buildProjectMap(lcmDir) {
    const lcmProjectsDir = join(lcmDir ?? join(homedir(), '.lossless-claude'), 'projects');
    const map = new Map();
    if (!existsSync(lcmProjectsDir))
        return map;
    for (const entry of readdirSync(lcmProjectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const metaPath = join(lcmProjectsDir, entry.name, 'meta.json');
        if (!existsSync(metaPath))
            continue;
        try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
            if (meta.cwd) {
                const hash = cwdToProjectHash(meta.cwd);
                map.set(hash, meta.cwd);
            }
        }
        catch { }
    }
    return map;
}
export function findSessionFiles(projectDir) {
    const files = [];
    if (!existsSync(projectDir))
        return files;
    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push({
                path: join(projectDir, entry.name),
                sessionId: basename(entry.name, '.jsonl'),
            });
        }
        if (entry.isDirectory()) {
            const subagentsDir = join(projectDir, entry.name, 'subagents');
            if (existsSync(subagentsDir)) {
                for (const sub of readdirSync(subagentsDir, { withFileTypes: true })) {
                    if (sub.isFile() && sub.name.endsWith('.jsonl')) {
                        files.push({
                            path: join(subagentsDir, sub.name),
                            sessionId: basename(sub.name, '.jsonl'),
                        });
                    }
                }
            }
        }
    }
    return files;
}
export async function importSessions(client, options = {}) {
    const claudeProjectsDir = options._claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
    const result = { imported: 0, skippedEmpty: 0, failed: 0, totalMessages: 0 };
    const projectDirs = [];
    if (options.all) {
        if (!existsSync(claudeProjectsDir))
            return result;
        const projectMap = buildProjectMap(options._lcmDir);
        for (const entry of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const cwd = projectMap.get(entry.name);
            if (!cwd)
                continue;
            projectDirs.push({ dir: join(claudeProjectsDir, entry.name), cwd });
        }
    }
    else {
        const cwd = options.cwd ?? process.cwd();
        const hash = cwdToProjectHash(cwd);
        const dir = join(claudeProjectsDir, hash);
        if (existsSync(dir)) {
            projectDirs.push({ dir, cwd });
        }
    }
    for (const { dir, cwd } of projectDirs) {
        const sessionFiles = findSessionFiles(dir);
        for (const { path, sessionId } of sessionFiles) {
            if (options.dryRun) {
                if (options.verbose)
                    console.log(`  [dry-run] ${sessionId}`);
                result.imported++;
                continue;
            }
            try {
                const res = await client.post('/ingest', {
                    session_id: sessionId,
                    cwd,
                    transcript_path: path,
                });
                if (res.ingested === 0 && res.totalTokens === 0) {
                    result.skippedEmpty++;
                    if (options.verbose)
                        console.log(`  \u2298 ${sessionId}: empty`);
                }
                else {
                    result.imported++;
                    result.totalMessages += res.ingested;
                    if (options.verbose)
                        console.log(`  \u2713 ${sessionId}: ${res.ingested} messages`);
                }
            }
            catch {
                result.failed++;
                if (options.verbose)
                    console.log(`  \u2717 ${sessionId}: failed`);
            }
        }
    }
    return result;
}
//# sourceMappingURL=import.js.map