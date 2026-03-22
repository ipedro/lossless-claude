export function upsertRedactionCounts(db, pid, counts) {
    if (counts.builtIn === 0 && counts.global === 0 && counts.project === 0)
        return;
    const upsert = db.prepare(`
    INSERT INTO redaction_stats (project_id, category, count)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id, category) DO UPDATE SET count = count + excluded.count
  `);
    if (counts.builtIn > 0)
        upsert.run(pid, "built_in", counts.builtIn);
    if (counts.global > 0)
        upsert.run(pid, "global", counts.global);
    if (counts.project > 0)
        upsert.run(pid, "project", counts.project);
}
//# sourceMappingURL=redaction-stats.js.map