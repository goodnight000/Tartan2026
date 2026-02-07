import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../../../src/memory/sqlite.js";
import { resolveUserPath } from "../../../src/utils.js";

export type CarePilotDb = DatabaseSync;

export function resolveCarePilotDbPath(dbPath: string): string {
  return resolveUserPath(dbPath);
}

export function openCarePilotDb(dbPath: string): CarePilotDb {
  const resolvedPath = resolveCarePilotDbPath(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function closeCarePilotDb(db: CarePilotDb): void {
  db.close();
}

export function withCarePilotTransaction<T>(db: CarePilotDb, run: () => T): T {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Rollback best effort only.
    }
    throw error;
  }
}
