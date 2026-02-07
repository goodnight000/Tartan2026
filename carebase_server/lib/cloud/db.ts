import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') ?? 'carebase.db';
const dbPathResolved = path.isAbsolute(DB_PATH)
  ? DB_PATH
  : path.join(process.cwd(), DB_PATH);

const db = new Database(dbPathResolved);

db.pragma('journal_mode = WAL');

db.exec(`
  create table if not exists carebase_records (
    key text primary key,
    encrypted_value blob not null,
    sensitivity_level text not null,
    created_at integer not null,
    updated_at integer not null,
    synced_at integer
  );

  create table if not exists carebase_sync (
    id integer primary key check (id = 1),
    last_sync integer
  );
  insert or ignore into carebase_sync (id, last_sync) values (1, null);
`);

export function getDb() {
  return db;
}
