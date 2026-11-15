// ============================================================
// Base de datos SQLite — configuración, helpers y CRUD.
// better-sqlite3 síncrono, WAL, ruta portable junto al ejecutable.
// ============================================================

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations'
import { getDataDir } from './paths'
import type {
  CachedPostRecord,
  CachedMessageRecord,
  CachedFileRecord,
  DiscordUser,
  PersistedQueueItem
} from '../discord/types'

let db: Database.Database | null = null
let currentDbPath: string | null = null

function getFileSizeSafe(filePath: string | null): number {
  if (!filePath) return 0
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

function applyPragmas(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('foreign_keys = ON')
  database.pragma('cache_size = -32000') // 32 MB (equilibrio RAM/rendimiento)
  database.pragma('temp_store = MEMORY')
  database.pragma('journal_size_limit = 67108864') // tope WAL 64 MB
  database.pragma('busy_timeout = 10000')
}

export function initDatabase(): Database.Database {
  if (db) return db

  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  const dbPath = path.join(dataDir, 'estrato.db')
  currentDbPath = dbPath

  // Migración de marca: la versión anterior guardaba `foro-downloader.db`.
  // Se renombra una sola vez para no perder la caché existente.
  const legacyPath = path.join(dataDir, 'foro-downloader.db')
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
    try {
      fs.renameSync(legacyPath, dbPath)
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(legacyPath + suffix)) {
          fs.renameSync(legacyPath + suffix, dbPath + suffix)
        }
      }
    } catch {
      // Si falla el renombrado se arranca con una base nueva.
    }
  }

  try {
    db = new Database(dbPath)
    applyPragmas(db)

    const quickCheck = db.pragma('quick_check') as { quick_check: string }[]
    if (quickCheck[0]?.quick_check !== 'ok') {
      throw new Error('database disk image is malformed')
    }

    runMigrations(db)
  } catch (error) {
    const message = (error as Error).message || ''
    const corrupted = /malformed|corrupt|not a database/i.test(message)
    if (!corrupted) throw error

    console.warn('[DB] Base de datos corrupta, recreando:', message)
    try { db?.close() } catch { /* ignorar */ }
    db = null

    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix) } catch { /* ignorar */ }
    }

    db = new Database(dbPath)
    applyPragmas(db)
    runMigrations(db)
  }

  return db
}

export function runInTransaction<T>(cb: () => T): T {
  return getDatabase().transaction(cb)()
}

function runMigrations(database: Database.Database): void {
  let current = getCurrentSchemaVersion(database)

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    // Cada migración es atómica: si falla, no queda un esquema a medias.
    const apply = database.transaction(() => {
      database.exec(migration.sql)
    })
    apply()
    current = migration.version
    console.log(`[DB] Migración v${migration.version} aplicada`)
  }

  if (current < LATEST_SCHEMA_VERSION) {
    throw new Error(`Esquema incompleto: v${current} < v${LATEST_SCHEMA_VERSION}`)
  }
}

function getCurrentSchemaVersion(database: Database.Database): number {
  try {
    const row = database
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined
    return row ? parseInt(row.value, 10) || 0 : 0
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
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignorar */ }
    db.close()
    db = null
    currentDbPath = null
  }
}

export function optimizeMemory(): { walSizeBytes: number; dbSizeBytes: number } {
  const d = getDatabase()
  try {
    d.pragma('wal_checkpoint(PASSIVE)')
  } catch {
    /* ignorar */
  }
  try {
    d.pragma('shrink_memory')
  } catch {
    /* ignorar */
  }
  return {
    walSizeBytes: getFileSizeSafe(currentDbPath ? `${currentDbPath}-wal` : null),
    dbSizeBytes: getFileSizeSafe(currentDbPath)
  }
}

// ==================== Posts en caché ====================

export function getCachedPost(threadId: string): CachedPostRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_posts WHERE thread_id = ?')
    .get(threadId) as CachedPostRecord | undefined
  return row || null
}

export function getCachedPostsByChannel(channelId: string): CachedPostRecord[] {
  return getDatabase()
    .prepare(`
      SELECT p.*, u.username AS author_name
      FROM cached_posts p
      LEFT JOIN cached_users u ON p.author_id = u.user_id
      WHERE p.channel_id = ? AND p.download_path IS NOT NULL
      ORDER BY p.created_at ASC
    `)
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
      channel_id = @channel_id,
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

export function updatePostSyncStatus(threadId: string, status: string, lastChecked?: string): void {
  getDatabase()
    .prepare('UPDATE cached_posts SET sync_status = ?, last_checked = ? WHERE thread_id = ?')
    .run(status, lastChecked || new Date().toISOString(), threadId)
}

// ==================== Mensajes en caché ====================

export function getCachedMessages(threadId: string): CachedMessageRecord[] {
  return getDatabase()
    .prepare('SELECT * FROM cached_messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId) as CachedMessageRecord[]
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

// ==================== Archivos en caché ====================

export function getCachedFile(fileId: string): CachedFileRecord | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_files WHERE file_id = ?')
    .get(fileId) as CachedFileRecord | undefined
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

// ==================== Cola persistente ====================

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
  // Evita duplicar el mismo hilo mientras siga pendiente.
  const existing = getDatabase()
    .prepare(
      "SELECT id FROM download_queue WHERE thread_id = ? AND status IN ('queued','downloading','paused') LIMIT 1"
    )
    .get(task.thread_id) as { id: number } | undefined
  if (existing) return existing.id

  const result = getDatabase().prepare(`
    INSERT INTO download_queue (
      thread_id, guild_id, channel_id, guild_name, channel_name,
      thread_name, priority, status, created_at, retry_count, export_options
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)
  `).run(
    task.thread_id,
    task.guild_id,
    task.channel_id,
    task.guild_name || null,
    task.channel_name || null,
    task.thread_name || null,
    task.priority || 0,
    new Date().toISOString(),
    task.export_options || null
  )
  return Number(result.lastInsertRowid)
}

export function getQueueItems(statuses?: string[]): PersistedQueueItem[] {
  if (statuses && statuses.length > 0) {
    const placeholders = statuses.map(() => '?').join(',')
    return getDatabase()
      .prepare(
        `SELECT * FROM download_queue WHERE status IN (${placeholders}) ORDER BY priority DESC, created_at ASC`
      )
      .all(...statuses) as PersistedQueueItem[]
  }
  return getDatabase()
    .prepare('SELECT * FROM download_queue ORDER BY priority DESC, created_at ASC')
    .all() as PersistedQueueItem[]
}

export function updateQueueStatus(id: number, status: string, errorMessage?: string): void {
  const now = new Date().toISOString()
  if (status === 'downloading') {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ?, started_at = ? WHERE id = ?')
      .run(status, now, id)
  } else if (status === 'done' || status === 'error' || status === 'cancelled') {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ?, completed_at = ?, error_message = ? WHERE id = ?')
      .run(status, now, errorMessage || null, id)
  } else {
    getDatabase()
      .prepare('UPDATE download_queue SET status = ? WHERE id = ?')
      .run(status, id)
  }
}

export function deleteQueueItems(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  getDatabase().prepare(`DELETE FROM download_queue WHERE id IN (${placeholders})`).run(...ids)
}

export function resetStuckDownloads(): void {
  // Las descargas interrumpidas quedan reanudables, no perdidas.
  getDatabase().prepare("UPDATE download_queue SET status = 'paused' WHERE status = 'downloading'").run()
}

export function incrementRetryCount(id: number): void {
  getDatabase().prepare('UPDATE download_queue SET retry_count = retry_count + 1 WHERE id = ?').run(id)
}

// ==================== Usuarios en caché ====================

export function getCachedUser(userId: string): DiscordUser | null {
  const row = getDatabase()
    .prepare('SELECT * FROM cached_users WHERE user_id = ?')
    .get(userId) as
    | { user_id: string; username: string; global_name: string | null; discriminator: string; avatar: string | null }
    | undefined
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
  `).run(
    user.id,
    user.username,
    user.global_name,
    user.discriminator,
    user.avatar,
    new Date().toISOString()
  )
}

// ==================== Estadísticas ====================

export function getDbStats(): {
  totalPosts: number
  totalMessages: number
  totalFiles: number
  totalSize: number
  queuePending: number
  walSizeBytes: number
  dbSizeBytes: number
} {
  const d = getDatabase()
  const posts = (d.prepare('SELECT COUNT(*) AS c FROM cached_posts').get() as { c: number }).c
  const messages = (d.prepare('SELECT COUNT(*) AS c FROM cached_messages').get() as { c: number }).c
  const files = (d.prepare('SELECT COUNT(*) AS c FROM cached_files').get() as { c: number }).c
  const size = (d.prepare('SELECT COALESCE(SUM(file_size), 0) AS s FROM cached_files').get() as { s: number }).s
  const pending = (
    d
      .prepare("SELECT COUNT(*) AS c FROM download_queue WHERE status NOT IN ('done','cancelled','error')")
      .get() as { c: number }
  ).c

  return {
    totalPosts: posts,
    totalMessages: messages,
    totalFiles: files,
    totalSize: size,
    queuePending: pending,
    walSizeBytes: getFileSizeSafe(currentDbPath ? `${currentDbPath}-wal` : null),
    dbSizeBytes: getFileSizeSafe(currentDbPath)
  }
}

// ==================== Historial ====================

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
    `).run({
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
    })
  } catch (e) {
    console.warn('[DB] recordDownloadHistory failed:', (e as Error).message)
  }
}

export function getDownloadHistory(limit = 50, offset = 0): unknown[] {
  try {
    return getDatabase()
      .prepare('SELECT * FROM download_history ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(limit, offset)
  } catch (e) {
    console.warn('[DB] getDownloadHistory failed:', (e as Error).message)
    return []
  }
}

/**
 * Purga la caché de metadatos SIN borrar el archivo SQLite.
 * Borrar el .db en caliente dejaba conexiones colgadas y corrompía
 * la cola si había descargas activas (el llamador ya lo impide).
 */
/**
 * Métricas agregadas del archivo local.
 * `outputDir` se usa para derivar el nombre del servidor a partir de la
 * ruta de cada publicación (primer segmento tras el directorio de salida).
 */
export function getArchiveStats(outputDir: string): {
  posts: number
  messages: number
  files: number
  bytes: number
  servers: { name: string; posts: number; bytes: number }[]
  recent: {
    threadName: string
    status: string
    completedAt: string | null
    bytes: number
    downloadPath: string | null
  }[]
} {
  const d = getDatabase()

  const posts = (d.prepare('SELECT COUNT(*) AS c FROM cached_posts').get() as { c: number }).c
  const messages = (d.prepare('SELECT COUNT(*) AS c FROM cached_messages').get() as { c: number }).c
  const fileRow = d
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(file_size), 0) AS s FROM cached_files')
    .get() as { c: number; s: number }

  const paths = d
    .prepare('SELECT download_path, total_size FROM cached_posts WHERE download_path IS NOT NULL')
    .all() as { download_path: string; total_size: number }[]

  const porServidor = new Map<string, { posts: number; bytes: number }>()
  for (const fila of paths) {
    const relativo = outputDir
      ? path.relative(outputDir, fila.download_path).split(path.sep)[0]
      : path.basename(path.dirname(fila.download_path))
    const nombre = relativo && relativo !== '..' ? relativo : 'Sin clasificar'
    const actual = porServidor.get(nombre) || { posts: 0, bytes: 0 }
    actual.posts += 1
    actual.bytes += fila.total_size || 0
    porServidor.set(nombre, actual)
  }

  const recent = d
    .prepare(`
      SELECT thread_name, status, completed_at, total_bytes, download_path
      FROM download_history
      ORDER BY id DESC
      LIMIT 12
    `)
    .all() as {
      thread_name: string | null
      status: string
      completed_at: string | null
      total_bytes: number
      download_path: string | null
    }[]

  return {
    posts,
    messages,
    files: fileRow.c,
    bytes: fileRow.s,
    servers: [...porServidor.entries()]
      .map(([name, datos]) => ({ name, ...datos }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
    recent: recent.map((fila) => ({
      threadName: fila.thread_name || 'Sin título',
      status: fila.status,
      completedAt: fila.completed_at,
      bytes: fila.total_bytes || 0,
      downloadPath: fila.download_path || null
    }))
  }
}

export function clearAllCache(): void {
  const d = getDatabase()
  const purge = d.transaction(() => {
    d.exec(`
      DELETE FROM cached_messages;
      DELETE FROM cached_files;
      DELETE FROM cached_posts;
      DELETE FROM cached_users;
      DELETE FROM download_queue WHERE status IN ('done','cancelled','error');
    `)
  })
  purge()
  d.pragma('wal_checkpoint(TRUNCATE)')
  d.exec('VACUUM')
}

/**
 * Comprueba la integridad de SQLite (`quick_check`) y concilia los registros
 * en caché contra el sistema de archivos dentro de una transacción.
 */
export function verifyAndRepairCache(): {
  checkedFiles: number
  invalidatedFiles: number
  orphanPosts: number
  integrityOk: boolean
} {
  const d = getDatabase()
  let integrityOk = false
  try {
    const quick = d.pragma('quick_check') as { quick_check: string }[]
    integrityOk = quick[0]?.quick_check === 'ok'
  } catch {
    integrityOk = false
  }

  const files = d
    .prepare('SELECT file_id, local_path FROM cached_files WHERE still_valid = 1')
    .all() as { file_id: string; local_path: string }[]

  const missingFiles: string[] = []
  for (const fila of files) {
    if (!fila.local_path || !fs.existsSync(fila.local_path)) {
      missingFiles.push(fila.file_id)
    }
  }

  const posts = d
    .prepare(
      "SELECT thread_id, download_path FROM cached_posts WHERE download_path IS NOT NULL AND (sync_status IS NULL OR sync_status != 'missing')"
    )
    .all() as { thread_id: string; download_path: string }[]

  const missingPosts: string[] = []
  for (const fila of posts) {
    if (!fs.existsSync(fila.download_path)) {
      missingPosts.push(fila.thread_id)
    }
  }

  if (missingFiles.length > 0 || missingPosts.length > 0) {
    const invalidateFile = d.prepare('UPDATE cached_files SET still_valid = 0 WHERE file_id = ?')
    const markPostMissing = d.prepare(
      "UPDATE cached_posts SET sync_status = 'missing' WHERE thread_id = ?"
    )
    const repair = d.transaction(() => {
      for (const fileId of missingFiles) {
        invalidateFile.run(fileId)
      }
      for (const threadId of missingPosts) {
        markPostMissing.run(threadId)
      }
    })
    repair()
  }

  return {
    checkedFiles: files.length,
    invalidatedFiles: missingFiles.length,
    orphanPosts: missingPosts.length,
    integrityOk
  }
}
