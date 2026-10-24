import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  WATCHED_THRESHOLD,
  parseMediaKey,
  type ListEntry,
  type ListName,
  type MediaKind,
  type ProgressEntry,
  type ProgressUpdate,
  type TitleSummary,
} from '@movie/shared';

interface ProgressRow {
  media_key: string;
  kind: MediaKind;
  title_id: number;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number;
  watched: number;
  updated_at: number;
}

interface ListRow {
  list: ListName;
  kind: MediaKind;
  title_id: number;
  added_at: number;
  snapshot: string;
}

const toProgress = (r: ProgressRow): ProgressEntry => ({
  mediaKey: r.media_key,
  kind: r.kind,
  id: r.title_id,
  ...(r.season !== null && r.episode !== null ? { season: r.season, episode: r.episode } : {}),
  position: r.position,
  duration: r.duration,
  watched: r.watched === 1,
  updatedAt: r.updated_at,
});

/**
 * Хранилище истории на встроенном `node:sqlite` (Node ≥ 22.13) — без нативных
 * зависимостей, чтобы сервер ставился на любой мини-ПК / NAS одной командой.
 * Профиль один (домашний); для мультипрофиля добавляется колонка profile_id.
 */
export class LibraryDb {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS progress (
        media_key  TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        title_id   INTEGER NOT NULL,
        season     INTEGER,
        episode    INTEGER,
        position   REAL NOT NULL DEFAULT 0,
        duration   REAL NOT NULL DEFAULT 0,
        watched    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS progress_title ON progress(kind, title_id);
      CREATE INDEX IF NOT EXISTS progress_updated ON progress(updated_at DESC);
      CREATE TABLE IF NOT EXISTS lists (
        list     TEXT NOT NULL,
        kind     TEXT NOT NULL,
        title_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        PRIMARY KEY (list, kind, title_id)
      );
    `);
  }

  saveProgress(key: string, update: ProgressUpdate): ProgressEntry {
    const ref = parseMediaKey(key);
    if (!ref) throw new Error(`invalid media key: ${key}`);
    const prev = this.getProgress(key);
    const reached = update.duration > 0 && update.position / update.duration >= WATCHED_THRESHOLD;
    // «Просмотрено» не снимается автоматически при пересмотре — только явным watched:false.
    const watched = update.watched ?? (reached || prev?.watched === true);
    this.db
      .prepare(
        `INSERT INTO progress (media_key, kind, title_id, season, episode, position, duration, watched, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_key) DO UPDATE SET
           position = excluded.position,
           duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE progress.duration END,
           watched = excluded.watched,
           updated_at = excluded.updated_at`,
      )
      .run(
        key,
        ref.kind,
        ref.id,
        ref.season ?? null,
        ref.episode ?? null,
        update.position,
        update.duration,
        watched ? 1 : 0,
        Date.now(),
      );
    return this.getProgress(key)!;
  }

  getProgress(key: string): ProgressEntry | null {
    const row = this.db.prepare('SELECT * FROM progress WHERE media_key = ?').get(key) as ProgressRow | undefined;
    return row ? toProgress(row) : null;
  }

  /** Вся история — фронт строит из неё «Продолжить просмотр» и фильтр «Скрыть просмотренные». */
  listProgress(limit = 1000): ProgressEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM progress ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as unknown as ProgressRow[];
    return rows.map(toProgress);
  }

  progressForTitle(kind: MediaKind, id: number): ProgressEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM progress WHERE kind = ? AND title_id = ? ORDER BY updated_at DESC')
      .all(kind, id) as unknown as ProgressRow[];
    return rows.map(toProgress);
  }

  deleteProgress(key: string): void {
    this.db.prepare('DELETE FROM progress WHERE media_key = ?').run(key);
  }

  addToList(list: ListName, snapshot: TitleSummary): void {
    this.db
      .prepare(
        `INSERT INTO lists (list, kind, title_id, added_at, snapshot) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(list, kind, title_id) DO UPDATE SET snapshot = excluded.snapshot`,
      )
      .run(list, snapshot.kind, snapshot.id, Date.now(), JSON.stringify(snapshot));
  }

  removeFromList(list: ListName, kind: MediaKind, id: number): void {
    this.db.prepare('DELETE FROM lists WHERE list = ? AND kind = ? AND title_id = ?').run(list, kind, id);
  }

  getLists(): ListEntry[] {
    const rows = this.db.prepare('SELECT * FROM lists ORDER BY added_at DESC').all() as unknown as ListRow[];
    return rows.map((r) => ({
      list: r.list,
      kind: r.kind,
      id: r.title_id,
      addedAt: r.added_at,
      snapshot: JSON.parse(r.snapshot) as TitleSummary,
    }));
  }

  close(): void {
    this.db.close();
  }
}
