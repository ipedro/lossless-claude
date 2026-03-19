import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
export const BASE_DIR = join(homedir(), ".lossless-claude");
export const projectId = (cwd) => createHash("sha256").update(cwd).digest("hex");
export const projectDir = (cwd) => join(BASE_DIR, "projects", projectId(cwd));
export const projectDbPath = (cwd) => join(projectDir(cwd), "db.sqlite");
export const projectMetaPath = (cwd) => join(projectDir(cwd), "meta.json");
//# sourceMappingURL=project.js.map