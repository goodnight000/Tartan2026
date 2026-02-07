import type { CarePilotDb } from "./db.js";
import { withCarePilotTransaction } from "./db.js";

export type SqlParam = string | number | bigint | Uint8Array | null;
export type CarePilotRow = Record<string, SqlParam>;

export type CarePilotListOptions = {
  where?: Record<string, SqlParam | undefined>;
  limit?: number;
};

export type CarePilotTableRepository = {
  create: (row: CarePilotRow) => CarePilotRow;
  get: (id: string) => CarePilotRow | null;
  update: (id: string, patch: Record<string, SqlParam | undefined>) => CarePilotRow | null;
  list: (options?: CarePilotListOptions) => CarePilotRow[];
};

export type CarePilotClinicalStore = {
  patientProfiles: CarePilotTableRepository;
  conditions: CarePilotTableRepository;
  allergies: CarePilotTableRepository;
  medications: CarePilotTableRepository;
  symptomStates: CarePilotTableRepository;
  appointments: CarePilotTableRepository;
  actionAudit: CarePilotTableRepository;
  consentTokens: CarePilotTableRepository;
  healthSignals: CarePilotTableRepository;
  healthConnections: CarePilotTableRepository;
  documents: CarePilotTableRepository;
  extractedFindings: CarePilotTableRepository;
  policyEvents: CarePilotTableRepository;
  memoryMigrationSidecar: CarePilotTableRepository;
};

type RepositoryConfig = {
  db: CarePilotDb;
  table: string;
  primaryKey: string;
};

function assertIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function sanitizeSqlParam(value: SqlParam | boolean): SqlParam {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}

function readRows(statement: string, db: CarePilotDb, params: SqlParam[] = []): CarePilotRow[] {
  return db.prepare(statement).all(...params) as CarePilotRow[];
}

function createRepository(config: RepositoryConfig): CarePilotTableRepository {
  const quotedTable = assertIdentifier(config.table);
  const quotedPrimaryKey = assertIdentifier(config.primaryKey);

  return {
    create(row) {
      const keys = Object.keys(row);
      if (keys.length === 0) {
        throw new Error(`Cannot insert empty row into ${config.table}`);
      }

      const columns = keys.map(assertIdentifier).join(", ");
      const placeholders = keys.map(() => "?").join(", ");
      const values = keys.map((key) => sanitizeSqlParam(row[key]));

      withCarePilotTransaction(config.db, () => {
        config.db.prepare(`INSERT INTO ${quotedTable} (${columns}) VALUES (${placeholders})`).run(...values);
      });

      const inserted = config.db
        .prepare(`SELECT * FROM ${quotedTable} WHERE ${quotedPrimaryKey} = ?`)
        .get(row[config.primaryKey]) as CarePilotRow | undefined;

      if (!inserted) {
        throw new Error(`Insert succeeded but no row returned for ${config.table}`);
      }

      return inserted;
    },

    get(id) {
      const row = config.db
        .prepare(`SELECT * FROM ${quotedTable} WHERE ${quotedPrimaryKey} = ?`)
        .get(id) as CarePilotRow | undefined;
      return row ?? null;
    },

    update(id, patch) {
      const entries = Object.entries(patch).filter(
        ([key, value]) => key !== config.primaryKey && value !== undefined,
      );
      if (entries.length === 0) {
        return this.get(id);
      }

      const assignments = entries.map(([key]) => `${assertIdentifier(key)} = ?`).join(", ");
      const values = entries.map(([, value]) => sanitizeSqlParam(value as SqlParam | boolean));

      withCarePilotTransaction(config.db, () => {
        config.db
          .prepare(`UPDATE ${quotedTable} SET ${assignments} WHERE ${quotedPrimaryKey} = ?`)
          .run(...values, id);
      });

      return this.get(id);
    },

    list(options) {
      const where = options?.where ?? {};
      const whereEntries = Object.entries(where).filter(([, value]) => value !== undefined);
      const clauses: string[] = [];
      const params: SqlParam[] = [];

      for (const [column, value] of whereEntries) {
        clauses.push(`${assertIdentifier(column)} = ?`);
        params.push(sanitizeSqlParam(value as SqlParam | boolean));
      }

      const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
      const limit =
        typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
          ? Math.floor(options.limit)
          : 100;

      return readRows(
        `SELECT * FROM ${quotedTable}${whereSql} ORDER BY ${quotedPrimaryKey} ASC LIMIT ?`,
        config.db,
        [...params, limit],
      );
    },
  };
}

export function createCarePilotClinicalStore(db: CarePilotDb): CarePilotClinicalStore {
  return {
    patientProfiles: createRepository({ db, table: "patient_profile", primaryKey: "id" }),
    conditions: createRepository({ db, table: "conditions", primaryKey: "id" }),
    allergies: createRepository({ db, table: "allergies", primaryKey: "id" }),
    medications: createRepository({ db, table: "medications", primaryKey: "id" }),
    symptomStates: createRepository({ db, table: "symptom_states", primaryKey: "id" }),
    appointments: createRepository({ db, table: "appointments", primaryKey: "id" }),
    actionAudit: createRepository({ db, table: "action_audit", primaryKey: "id" }),
    consentTokens: createRepository({ db, table: "consent_tokens", primaryKey: "token" }),
    healthSignals: createRepository({ db, table: "health_signals", primaryKey: "id" }),
    healthConnections: createRepository({ db, table: "health_connections", primaryKey: "id" }),
    documents: createRepository({ db, table: "documents", primaryKey: "id" }),
    extractedFindings: createRepository({ db, table: "extracted_findings", primaryKey: "id" }),
    policyEvents: createRepository({ db, table: "policy_events", primaryKey: "id" }),
    memoryMigrationSidecar: createRepository({
      db,
      table: "memory_migration_sidecar",
      primaryKey: "id",
    }),
  };
}
