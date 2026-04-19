// ============================================================
// SQLite Database — Setup, query helpers, and CRUD operations.
// Uses better-sqlite3 for synchronous, fast local storage.
// WAL mode for concurrency. Portable path next to exe.
// ============================================================

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { MIGRATIONS } from './migrations'
import type {
  CachedPostRecord,
  CachedMessageRecord,
  CachedFileRecord,
  DownloadTask,
  DiscordUser
} from '../discord/types'

let db: Database.Database | null = null

function getDataDir(): string {
  // Portable: use ./data/ next to the exe in production, or app path in dev
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'data')
  }
  return path.join(app.getAppPath(), 'data')
}

export function initDatabase(): Database.Database {
  if (db) return db

  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = path.join(dataDir, 'foro-downloader.db')
  
  try {
    db = new Database(dbPath)

    // Performance settings
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('cache_size = -64000') // 64MB cache
    db.pragma('busy_timeout = 10000') // Advance busy timeout for workers or concurrent access (10 seconds)

    // Verify DB integrity! If it throws, it's malformed.
    const quickCheck = db.pragma('quick_check') as { quick_check: string }[]
    if (quickCheck[0].quick_check !== 'ok') {
      throw new Error('database disk image is malformed')
    }

    runMigrations(db)
  } catch (error: any) {
    if (error.message && (error.message.includes('malformed') || error.message.includes('corrupt') || error.message.includes('not a database'))) {
      console.warn('[DB] Database corrupted! Attempting recovery by recreation...', error.message)
      if (db) {
        try { db.close() } catch (e) {}
      }
      // Nuke the corrupted database and its lock files safely
      try { fs.unlinkSync(dbPath) } catch (e) {}
      try { fs.unlinkSync(dbPath + '-wal') } catch (e) {}
      try { fs.unlinkSync(dbPath + '-shm') } catch (e) {}
      
      // Retry initialization fresh
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('foreign_keys = ON')
      db.pragma('cache_size = -64000')
      db.pragma('busy_timeout = 10000')
      runMigrations(db)
    } else {
      throw error
    }
  }

  return db
}

export function runInTransaction<T>(cb: () => T): T {
  return getDatabase().transaction(cb)()
}

function runMigrations(database: Database.Database): void {
  const currentVersion = getCurrentSchemaVersion(database)

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      database.exec(migration.sql)
      console.log(`[DB] Applied migration v${migration.version}`)
    }
  }
}

function getCurrentSchemaVersion(database: Database.Database): number {
  try {
    const row = database.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).get() as { value: string } | undefined
    return row ? parseInt(row.value) : 0
  } catch {
    return 0
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ==================== Cached Posts ====================

export function getCachedPost(threadId: string): CachedPostRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_posts WHERE thread_id = ?')
    .get(threadId) as CachedPostRecord | undefined
  return row || null
}

export function getCachedPostsByChannel(channelId: string): CachedPostRecord[] {
  return getDatabase()
    .prepare(`
      SELECT p.*, u.username as author_name 
      FROM cached_posts p 
      LEFT JOIN cached_users u ON p.author_id = u.user_id 
      WHERE p.channel_id = ? 
      ORDER BY p.created_at DESC
    `)
    .all(channelId) as CachedPostRecord[]
}

export function getOutdatedPosts(channelId: string): CachedPostRecord[] {
  return getDatabase()
    .prepare("SELECT * FROM cached_posts WHERE channel_id = ? AND sync_status = 'outdated'")
    .all(channelId) as CachedPostRecord[]
}

export function upsertCachedPost(post: CachedPostRecord): void {
  getDatabase().prepare(`
    INSERT INTO cached_posts (
      thread_id, guild_id, channel_id, title, author_id, created_at,
      last_message_id, message_count, content_hash, metadata_hash,
      first_synced, last_synced, last_checked, sync_status,
      download_path, file_count, total_size
    ) VALUES (
      @thread_id, @guild_id, @channel_id, @title, @author_id, @created_at,
      @last_message_id, @message_count, @content_hash, @metadata_hash,
      @first_synced, @last_synced, @last_checked, @sync_status,
      @download_path, @file_count, @total_size
    ) ON CONFLICT(thread_id) DO UPDATE SET
      title = @title,
      last_message_id = @last_message_id,
      message_count = @message_count,
      content_hash = @content_hash,
      metadata_hash = @metadata_hash,
      last_synced = @last_synced,
      last_checked = @last_checked,
      sync_status = @sync_status,
      download_path = @download_path,
      file_count = @file_count,
      total_size = @total_size
  `).run(post)
}

export function updatePostSyncStatus(
  threadId: string,
  status: string,
  lastChecked?: string
): void {
  const now = lastChecked || new Date().toISOString()
  getDatabase()
    .prepare('UPDATE cached_posts SET sync_status = ?, last_checked = ? WHERE thread_id = ?')
    .run(status, now, threadId)
}

// ==================== Cached Messages ====================

export function getCachedMessages(threadId: string): CachedMessageRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM cached_messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId) as CachedMessageRecord[]
}

export function getCachedMessage(messageId: string): CachedMessageRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_messages WHERE message_id = ?')
    .get(messageId) as CachedMessageRecord | undefined
  return row || null
}

export function upsertCachedMessage(msg: CachedMessageRecord): void {
  getDatabase().prepare(`
    INSERT INTO cached_messages (
      message_id, thread_id, author_id, content_hash,
      attachment_hash, edited_at, created_at, last_synced, sync_status
    ) VALUES (
      @message_id, @thread_id, @author_id, @content_hash,
      @attachment_hash, @edited_at, @created_at, @last_synced, @sync_status
    ) ON CONFLICT(message_id) DO UPDATE SET
      content_hash = @content_hash,
      attachment_hash = @attachment_hash,
      edited_at = @edited_at,
      last_synced = @last_synced,
      sync_status = @sync_status
  `).run(msg)
}

export function deleteMessagesForThread(threadId: string): void {
  getDatabase()
    .prepare('DELETE FROM cached_messages WHERE thread_id = ?')
    .run(threadId)
}

// ==================== Cached Files ====================

export function getCachedFile(fileId: string): CachedFileRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_files WHERE file_id = ?')
    .get(fileId) as CachedFileRecord | undefined
  return row || null
}

export function getCachedFileByHash(hash: string): CachedFileRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_files WHERE file_hash = ? AND still_valid = 1 LIMIT 1')
    .get(hash) as CachedFileRecord | undefined
  return row || null
}

export function upsertCachedFile(file: CachedFileRecord): void {
  getDatabase().prepare(`
    INSERT INTO cached_files (
      file_id, message_id, original_url, local_path,
      file_hash, file_size, mime_type, filename,
      downloaded_at, still_valid
    ) VALUES (
      @file_id, @message_id, @original_url, @local_path,
      @file_hash, @file_size, @mime_type, @filename,
      @downloaded_at, @still_valid
    ) ON CONFLICT(file_id) DO UPDATE SET
      local_path = @local_path,
      file_hash = @file_hash,
      file_size = @file_size,
      downloaded_at = @downloaded_at,
      still_valid = @still_valid
  `).run({ ...file, still_valid: file.still_valid ? 1 : 0 })
}

export function getFilesForMessage(messageId: string): CachedFileRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM cached_files WHERE message_id = ?')
    .all(messageId) as CachedFileRecord[]
}

// ==================== Download Queue ====================

export function addToQueue(task: {
  thread_id: string
  guild_id: string
  channel_id: string
  guild_name?: string
  channel_name?: string
  thread_name?: string
  priority?: number
  export_options?: string
}): number {
  const result = getDatabase().prepare(`
    INSERT INTO download_queue (
      thread_id, guild_id, channel_id, guild_name, channel_name,
      thread_name, priority, status, created_at, retry_count, export_options
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)
  `).run(
    task.thread_id, task.guild_id, task.channel_id,
    task.guild_name || null, task.channel_name || null,
    task.thread_name || null, task.priority || 0,
    new Date().toISOString(), task.export_options || null
  )
  return result.lastInsertRowid as number
}

export function getQueueItems(status?: string): unknown[] {
  if (status) {
    return getDatabase()
      .prepare('SELECT * FROM download_queue WHERE status = ? ORDER BY priority DESC, created_at ASC')
      .all(status)
  }
  return getDatabase()
    .prepare('SELECT * FROM download_queue ORDER BY priority DESC, created_at ASC')
    .all()
}

export function updateQueueStatus(
  id: number,
  status: string,
  errorMessage?: string
): void {
  const now = new Date().toISOString()
  if (status === 'downloading') {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ?, started_at = ? WHERE id = ?')
      .run(status, now, id)
  } else if (status === 'done' || status === 'error') {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ?, completed_at = ?, error_message = ? WHERE id = ?')
      .run(status, now, errorMessage || null, id)
  } else {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ? WHERE id = ?')
      .run(status, id)
  }
}

export function resetStuckDownloads(): void {
  const d = getDatabase()
  d.prepare("UPDATE download_queue SET status = 'paused' WHERE status = 'downloading'").run()
}

export function incrementRetryCount(id: number): void {
  getDatabase()
    .prepare('UPDATE download_queue SET retry_count = retry_count + 1 WHERE id = ?')
    .run(id)
}

export function clearCompletedQueue(): void {
  getDatabase()
    .prepare("DELETE FROM download_queue WHERE status IN ('done', 'cancelled')")
    .run()
}

// ==================== Cached Users ====================

export function getCachedUser(userId: string): DiscordUser | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_users WHERE user_id = ?')
    .get(userId) as { user_id: string; username: string; global_name: string | null; discriminator: string; avatar: string | null } | undefined
  if (!row) return null
  return {
    id: row.user_id,
    username: row.username,
    global_name: row.global_name,
    discriminator: row.discriminator || '0',
    avatar: row.avatar
  }
}

export function upsertCachedUser(user: DiscordUser): void {
  getDatabase().prepare(`
    INSERT INTO cached_users (user_id, username, global_name, discriminator, avatar, cached_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      discriminator = excluded.discriminator,
      avatar = excluded.avatar,
      cached_at = excluded.cached_at
  `).run(user.id, user.username, user.global_name, user.discriminator, user.avatar, new Date().toISOString())
}

// ==================== Stats ====================

export function getDbStats(): {
  totalPosts: number
  totalMessages: number
  totalFiles: number
  totalSize: number
  queuePending: number
} {
  const d = getDatabase()
  const posts = (d.prepare('SELECT COUNT(*) as c FROM cached_posts').get() as { c: number }).c
  const messages = (d.prepare('SELECT COUNT(*) as c FROM cached_messages').get() as { c: number }).c
  const files = (d.prepare('SELECT COUNT(*) as c FROM cached_files').get() as { c: number }).c
  const size = (d.prepare('SELECT COALESCE(SUM(file_size), 0) as s FROM cached_files').get() as { s: number }).s
  const pending = (d.prepare("SELECT COUNT(*) as c FROM download_queue WHERE status NOT IN ('done', 'cancelled', 'error')").get() as { c: number }).c

  return {
    totalPosts: posts,
    totalMessages: messages,
    totalFiles: files,
    totalSize: size,
    queuePending: pending
  }
}

// ==================== Download History (New - v3) ====================
/**
 * recordDownloadHistory
 * What: Persist a summary record for a completed/failed download task.
 * Why: Provides a stable audit trail for production debugging, analytics,
 *      and user-facing history of exports without touching queue entries.
 * How: Inserts a lightweight summary row into `download_history`. Safe to
 *      call even if the DB is freshly migrated; uses IF NOT EXISTS migration.
 */
export function recordDownloadHistory(data: {
  queue_id?: number
  thread_id: string
  guild_id: string
  channel_id: string
  guild_name?: string | null
  channel_name?: string | null
  thread_name?: string | null
  status: string
  files_count?: number
  total_bytes?: number
  download_path?: string | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
}): void {
  try {
    // Normalization to ensure ALL keys exist for named parameter binding
    // and that missing optional fields default to SQL-friendly nulls.
    const normalizedData = {
      queue_id: data.queue_id ?? null,
      thread_id: data.thread_id,
      guild_id: data.guild_id,
      channel_id: data.channel_id,
      guild_name: data.guild_name ?? null,
      channel_name: data.channel_name ?? null,
      thread_name: data.thread_name ?? null,
      status: data.status,
      files_count: data.files_count ?? 0,
      total_bytes: data.total_bytes ?? 0,
      download_path: data.download_path ?? null,
      error_message: data.error_message ?? null,
      started_at: data.started_at ?? null,
      completed_at: data.completed_at ?? null
    }

    getDatabase().prepare(`
      INSERT INTO download_history (
        queue_id, thread_id, guild_id, channel_id, guild_name, channel_name,
        thread_name, status, files_count, total_bytes, download_path,
        error_message, started_at, completed_at
      ) VALUES (
        @queue_id, @thread_id, @guild_id, @channel_id, @guild_name, @channel_name,
        @thread_name, @status, @files_count, @total_bytes, @download_path,
        @error_message, @started_at, @completed_at
      )
    `).run(normalizedData)
  } catch (e) {
    // Non-fatal: history writes should never crash the app
    console.warn('[DB] recordDownloadHistory failed:', (e as Error).message)
  }
}

/**
 * getDownloadHistory
 * What: Query paginated download history records.
 * Why: Expose to renderer for user history, diagnostics, or telemetry.
 * How: Simple SELECT with LIMIT/OFFSET to avoid heavy queries.
 */
export function getDownloadHistory(limit = 50, offset = 0): any[] {
  try {
    return getDatabase()
      .prepare('SELECT * FROM download_history ORDER BY completed_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
  } catch (e) {
    console.warn('[DB] getDownloadHistory failed:', (e as Error).message)
    return []
  }
}

export function clearAllCache(): void {
  // Ultra-robust clear cache that also perfectly fixes corruption
  const dataDir = getDataDir()
  const dbPath = path.join(dataDir, 'foro-downloader.db')
  
  try {
    closeDatabase()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal')
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm')
  } catch (e) {
    console.warn('clearAllCache: failed to delete file', e)
  }
  
  // Reinitialize fresh
  initDatabase()
}
