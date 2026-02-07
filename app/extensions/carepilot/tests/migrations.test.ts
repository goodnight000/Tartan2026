import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const createdDbs = new Set<string>();

function createDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `carepilot-migrations-${randomUUID()}.sqlite`);
  createdDbs.add(dbPath);
  return dbPath;
}

afterEach(async () => {
  const fs = await import("node:fs/promises");
  for (const dbPath of createdDbs) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await fs.unlink(`${dbPath}${suffix}`);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
  createdDbs.clear();
});

describe("carepilot migrations", () => {
  it("re-applies migration 004 safely when migration table drift occurs", () => {
    const dbPath = createDbPath();
    const db = openCarePilotDb(dbPath);
    try {
      runCarePilotMigrations({ db });
      db.prepare("DELETE FROM carepilot_schema_migrations WHERE filename = ?").run(
        "004_memory_migration_fields.sql",
      );

      const rerun = runCarePilotMigrations({ db });
      expect(rerun.applied).toContain("004_memory_migration_fields.sql");
    } finally {
      closeCarePilotDb(db);
    }
  });
});
