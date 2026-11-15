import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDataDirMock } = vi.hoisted(() => ({
  getDataDirMock: vi.fn<() => string>()
}))

vi.mock('./paths', () => ({
  getDataDir: getDataDirMock
}))

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('module')
  const require = createRequire(import.meta.url)

  // Usa better-sqlite3 real si coincide la ABI; en Node estándar frente a binario Electron usa node:sqlite.
  try {
    const RealDatabase = require('better-sqlite3')
    const probe = new RealDatabase(':memory:')
    probe.close()
    return { default: RealDatabase }
  } catch {
    const { DatabaseSync } = await import('node:sqlite')

    function normalizeNamedObject(obj: Record<string, unknown>): Record<string, unknown> {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(obj)) {
        if (val === undefined) out[key] = null
        else if (typeof val === 'boolean') out[key] = val ? 1 : 0
        else out[key] = val
      }
      return out
    }

    function normalizeArgs(args: unknown[]): unknown[] {
      if (
        args.length === 1 &&
        args[0] !== null &&
        typeof args[0] === 'object' &&
        !ArrayBuffer.isView(args[0]) &&
        !(args[0] instanceof Date)
      ) {
        return [normalizeNamedObject(args[0] as Record<string, unknown>)]
      }
      return args.map((val) => {
        if (val === undefined) return null
        if (typeof val === 'boolean') return val ? 1 : 0
        return val
      })
    }

    function toPlainRow<T>(row: T): T {
      return row && typeof row === 'object' ? ({ ...(row as object) } as T) : row
    }

    class NodeSqliteDatabase {
      private raw: InstanceType<typeof DatabaseSync>
      private txDepth = 0

      constructor(filename: string) {
        this.raw = new DatabaseSync(filename)
      }

      pragma(cmd: string): unknown {
        const trimmed = cmd.trim()
        if (
          trimmed.includes('=') ||
          /^wal_checkpoint\b/i.test(trimmed) ||
          /^shrink_memory\b/i.test(trimmed)
        ) {
          this.raw.exec(`PRAGMA ${trimmed}`)
          return []
        }
        return this.raw.prepare(`PRAGMA ${trimmed}`).all().map(toPlainRow)
      }

      prepare(sql: string) {
        const stmt = this.raw.prepare(sql)
        stmt.setAllowBareNamedParameters(true)
        stmt.setAllowUnknownNamedParameters(true)
        return {
          get: (...args: unknown[]) => {
            const norm = normalizeArgs(args) as Parameters<typeof stmt.get>
            const row = stmt.get(...norm)
            return row === undefined ? undefined : toPlainRow(row)
          },
          all: (...args: unknown[]) => {
            const norm = normalizeArgs(args) as Parameters<typeof stmt.all>
            return stmt.all(...norm).map(toPlainRow)
          },
          run: (...args: unknown[]) => {
            const norm = normalizeArgs(args) as Parameters<typeof stmt.run>
            const res = stmt.run(...norm)
            return {
              changes: Number(res.changes),
              lastInsertRowid: Number(res.lastInsertRowid)
            }
          }
        }
      }

      transaction<T extends (...args: unknown[]) => unknown>(fn: T) {
        return (...args: Parameters<T>): ReturnType<T> => {
          const depth = this.txDepth++
          const begin = depth === 0 ? 'BEGIN' : `SAVEPOINT sp_${depth}`
          const commit = depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT sp_${depth}`
          const rollback = depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT sp_${depth}`
          this.raw.exec(begin)
          try {
            const result = fn(...args) as ReturnType<T>
            this.raw.exec(commit)
            return result
          } catch (error) {
            try {
              this.raw.exec(rollback)
            } catch {
              /* ignorar */
            }
            throw error
          } finally {
            this.txDepth--
          }
        }
      }

      exec(sql: string): this {
        this.raw.exec(sql)
        return this
      }

      close(): this {
        this.raw.close()
        return this
      }
    }

    return { default: NodeSqliteDatabase }
  }
})

import {
  addToQueue,
  closeDatabase,
  getCachedFile,
  getCachedPost,
  getQueueItems,
  initDatabase,
  optimizeMemory,
  updateQueueStatus,
  upsertCachedFile,
  upsertCachedPost,
  verifyAndRepairCache
} from './database'
import { LATEST_SCHEMA_VERSION } from './migrations'
import type { CachedFileRecord, CachedPostRecord } from '../discord/types'

function makePost(overrides: Partial<CachedPostRecord> = {}): CachedPostRecord {
  const now = '2026-11-14T12:00:00.000Z'
  return {
    thread_id: 'thread-1',
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    title: 'Post de prueba',
    author_id: 'user-1',
    created_at: now,
    last_message_id: 'msg-1',
    message_count: 1,
    content_hash: 'hash-c',
    metadata_hash: 'hash-m',
    first_synced: now,
    last_synced: now,
    last_checked: now,
    sync_status: 'synced',
    download_path: null,
    file_count: 0,
    total_size: 0,
    ...overrides
  }
}

function makeFile(overrides: Partial<CachedFileRecord> = {}): CachedFileRecord {
  return {
    file_id: 'file-1',
    message_id: 'msg-1',
    original_url: 'https://cdn.discordapp.com/attachments/1/2/foto.png',
    local_path: '',
    file_hash: 'abc123',
    file_size: 128,
    mime_type: 'image/png',
    filename: 'foto.png',
    downloaded_at: '2026-11-14T12:00:00.000Z',
    still_valid: true,
    ...overrides
  }
}

describe('database', () => {
  let dataDir = ''

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-db-'))
    getDataDirMock.mockReturnValue(dataDir)
  })

  afterEach(() => {
    closeDatabase()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('initDatabase inicializa el esquema completo en el directorio de datos', () => {
    const d1 = initDatabase()
    const d2 = initDatabase()
    expect(d2).toBe(d1)
    expect(fs.existsSync(path.join(dataDir, 'estrato.db'))).toBe(true)

    const versionRow = d1
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined
    expect(Number(versionRow?.value)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('upsertCachedPost y upsertCachedFile insertan y actualizan registros en conflicto', () => {
    initDatabase()

    const postDir = path.join(dataDir, 'post-1')
    fs.mkdirSync(postDir, { recursive: true })
    upsertCachedPost(makePost({ download_path: postDir, message_count: 2 }))
    expect(getCachedPost('thread-1')?.message_count).toBe(2)

    upsertCachedPost(makePost({ title: 'Actualizado', download_path: postDir, message_count: 5 }))
    const updatedPost = getCachedPost('thread-1')
    expect(updatedPost?.title).toBe('Actualizado')
    expect(updatedPost?.message_count).toBe(5)

    const filePath = path.join(postDir, 'foto.png')
    fs.writeFileSync(filePath, 'ok')
    upsertCachedFile(makeFile({ local_path: filePath, still_valid: true }))
    expect(getCachedFile('file-1')?.local_path).toBe(filePath)

    upsertCachedFile(makeFile({ local_path: filePath, file_size: 256, still_valid: false }))
    const updatedFile = getCachedFile('file-1')
    expect(updatedFile?.file_size).toBe(256)
    expect(updatedFile?.still_valid as unknown).toBe(0)
  })

  it('addToQueue deduplica hilos mientras siguen en estado queued y permite reencolar tras done', () => {
    initDatabase()

    const firstId = addToQueue({
      thread_id: 'thread-q',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      thread_name: 'Hilo 1'
    })
    const duplicateId = addToQueue({
      thread_id: 'thread-q',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      thread_name: 'Hilo 1 duplicado'
    })

    expect(duplicateId).toBe(firstId)
    expect(getQueueItems()).toHaveLength(1)

    updateQueueStatus(firstId, 'done')
    const reQueuedId = addToQueue({
      thread_id: 'thread-q',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      thread_name: 'Hilo 1 reencolado'
    })
    expect(reQueuedId).not.toBe(firstId)
    expect(getQueueItems()).toHaveLength(2)
  })

  it('optimizeMemory ejecuta checkpoint WAL y devuelve métricas de tamaño', () => {
    initDatabase()
    upsertCachedPost(makePost())

    const stats = optimizeMemory()
    expect(stats.walSizeBytes).toBeGreaterThanOrEqual(0)
    expect(stats.dbSizeBytes).toBeGreaterThan(0)
  })

  it('verifyAndRepairCache invalida archivos eliminados y marca posts huérfanos como missing', () => {
    initDatabase()

    const validPostDir = path.join(dataDir, 'post-ok')
    const orphanPostDir = path.join(dataDir, 'post-orphan')
    fs.mkdirSync(validPostDir, { recursive: true })
    fs.mkdirSync(orphanPostDir, { recursive: true })

    const validFilePath = path.join(validPostDir, 'presente.png')
    const missingFilePath = path.join(validPostDir, 'eliminado.png')
    fs.writeFileSync(validFilePath, 'presente')
    fs.writeFileSync(missingFilePath, 'temporal')

    upsertCachedPost(makePost({ thread_id: 'thread-ok', download_path: validPostDir }))
    upsertCachedPost(makePost({ thread_id: 'thread-orphan', download_path: orphanPostDir }))
    upsertCachedFile(makeFile({ file_id: 'file-ok', local_path: validFilePath, still_valid: true }))
    upsertCachedFile(
      makeFile({ file_id: 'file-missing', local_path: missingFilePath, still_valid: true })
    )

    // Elimina un archivo y un directorio antes de verificar integridad.
    fs.unlinkSync(missingFilePath)
    fs.rmSync(orphanPostDir, { recursive: true, force: true })

    const res = verifyAndRepairCache()
    expect(res).toEqual({
      checkedFiles: 2,
      invalidatedFiles: 1,
      orphanPosts: 1,
      integrityOk: true
    })

    expect(getCachedFile('file-missing')?.still_valid as unknown).toBe(0)
    expect(getCachedFile('file-ok')?.still_valid as unknown).toBe(1)
    expect(getCachedPost('thread-orphan')?.sync_status as string).toBe('missing')
    expect(getCachedPost('thread-ok')?.sync_status).toBe('synced')

    // Segunda pasada: no quedan elementos pendientes por reparar.
    expect(verifyAndRepairCache()).toEqual({
      checkedFiles: 1,
      invalidatedFiles: 0,
      orphanPosts: 0,
      integrityOk: true
    })
  })
})
