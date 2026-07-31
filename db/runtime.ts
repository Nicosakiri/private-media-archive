import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

export function getD1() {
  if (!env.DB) {
    throw new Error("D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const db = getD1();
    schemaReady = db
      .batch([
        db.prepare(`
          CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            creator TEXT NOT NULL DEFAULT '',
            media_type TEXT NOT NULL,
            book_category TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'in_progress',
            progress_text TEXT NOT NULL DEFAULT '',
            progress_percent INTEGER NOT NULL DEFAULT 0,
            platform TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            started_at TEXT NOT NULL DEFAULT '',
            last_seen_at TEXT NOT NULL DEFAULT '',
            completed_at TEXT NOT NULL DEFAULT '',
            rating INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `),
        db.prepare(`
          CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY NOT NULL,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            progress_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
          )
        `),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS entries_status_idx ON entries (status)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS notes_entry_idx ON notes (entry_id)",
        ),
      ])
      .then(() => undefined);
  }
  await schemaReady;
}
