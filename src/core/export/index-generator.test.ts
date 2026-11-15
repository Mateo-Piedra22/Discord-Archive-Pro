import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IndexGenerator } from './index-generator'
import type { CachedPostRecord } from '../discord/types'

function makePost(
  threadId: string,
  title: string,
  overrides: Partial<CachedPostRecord> = {}
): CachedPostRecord {
  return {
    thread_id: threadId,
    guild_id: 'g1',
    channel_id: 'c1',
    title,
    author_id: 'u1',
    author_name: 'Alice',
    created_at: '2026-01-10T12:00:00.000Z',
    last_message_id: 'm1',
    message_count: 3,
    content_hash: 'h1',
    metadata_hash: 'mh1',
    first_synced: '2026-01-10T12:05:00.000Z',
    last_synced: '2026-01-10T12:05:00.000Z',
    last_checked: '2026-01-10T12:05:00.000Z',
    sync_status: 'synced',
    download_path: null,
    file_count: 1,
    total_size: 1024,
    ...overrides
  }
}

let tempDir = ''

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-index-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('IndexGenerator', () => {
  it('generateIndexAsync genera _INDEX.md con fecha completa sin usar fs.existsSync ni dejar .tmp', async () => {
    const forumDir = path.join(tempDir, 'foro-general')
    const postDir = path.join(forumDir, '001_primer-post')
    fs.mkdirSync(postDir, { recursive: true })
    fs.writeFileSync(path.join(postDir, 'post.html'), '<html></html>', 'utf-8')

    const posts = [
      makePost('t1', 'Primer Post', {
        download_path: postDir,
        file_count: 2,
        total_size: 2048
      })
    ]

    const existsSpy = vi.spyOn(fs, 'existsSync')
    const accessSpy = vi.spyOn(fs.promises, 'access')
    try {
      const indexPath = await IndexGenerator.generateIndexAsync(forumDir, 'foro-general', posts)
      expect(existsSpy).not.toHaveBeenCalled()
      expect(accessSpy).toHaveBeenCalled()
      expect(indexPath).toBe(path.join(forumDir, '_INDEX.md'))
      expect(fs.existsSync(`${indexPath}.tmp`)).toBe(false)

      const md = fs.readFileSync(indexPath, 'utf-8')
      expect(md).toContain('<b>Canal:</b> foro-general')
      expect(md).toMatch(/📅 \*\*Reporte:\*\* \d{1,2} de [a-záéíóú]+ de \d{4}/i)
      expect(md).toContain('| 001 | [Primer Post](001_primer-post/post.html) | **Alice** |')
    } finally {
      existsSpy.mockRestore()
      accessSpy.mockRestore()
    }
  })

  it('generateIndex genera _INDEX.md de forma síncrona manteniendo compatibilidad y orden cronológico', () => {
    const forumDir = path.join(tempDir, 'foro-sync')
    const p1Dir = path.join(forumDir, '002_segundo-creado')
    const p2Dir = path.join(forumDir, '001_primero-creado')
    fs.mkdirSync(p1Dir, { recursive: true })
    fs.mkdirSync(p2Dir, { recursive: true })
    fs.writeFileSync(path.join(p1Dir, 'post.md'), '# Post 2', 'utf-8')
    fs.writeFileSync(path.join(p2Dir, 'post.md'), '# Post 1', 'utf-8')

    const posts = [
      makePost('t2', 'Segundo [Post] | Prueba', {
        created_at: '2026-02-01T10:00:00.000Z',
        download_path: p1Dir,
        author_name: 'Bob'
      }),
      makePost('t1', 'Primer Post', {
        created_at: '2026-01-01T10:00:00.000Z',
        download_path: p2Dir,
        author_name: 'Alice'
      })
    ]

    const indexPath = IndexGenerator.generateIndex(forumDir, 'foro-sync', posts)
    expect(indexPath).toBe(path.join(forumDir, '_INDEX.md'))
    expect(fs.existsSync(indexPath)).toBe(true)
    expect(fs.existsSync(`${indexPath}.tmp`)).toBe(false)

    const md = fs.readFileSync(indexPath, 'utf-8')
    const firstIdx = md.indexOf('| 001 | [Primer Post]')
    const secondIdx = md.indexOf('| 002 | [Segundo Post \\| Prueba]')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(secondIdx).toBeGreaterThan(firstIdx)
  })

  it('resuelve enlaces con post.csv, post.html y otros formatos respetando preferencia de candidatos', async () => {
    const forumDir = path.join(tempDir, 'foro-enlaces')
    const dirHtml = path.join(forumDir, '001_solo-html')
    const dirCsv = path.join(forumDir, '002_solo csv')
    const dirBoth = path.join(forumDir, '003_html-y-csv')
    const dirEmpty = path.join(forumDir, '004_sin-archivo')

    for (const d of [dirHtml, dirCsv, dirBoth, dirEmpty]) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(path.join(dirHtml, 'post.html'), '<html></html>', 'utf-8')
    fs.writeFileSync(path.join(dirCsv, 'post.csv'), 'id,content\n', 'utf-8')
    fs.writeFileSync(path.join(dirBoth, 'post.html'), '<html></html>', 'utf-8')
    fs.writeFileSync(path.join(dirBoth, 'post.csv'), 'id,content\n', 'utf-8')

    const posts = [
      makePost('t1', 'Solo HTML', { created_at: '2026-01-01T00:00:00.000Z', download_path: dirHtml }),
      makePost('t2', 'Solo CSV', { created_at: '2026-01-02T00:00:00.000Z', download_path: dirCsv }),
      makePost('t3', 'Preferencia HTML sobre CSV', { created_at: '2026-01-03T00:00:00.000Z', download_path: dirBoth }),
      makePost('t4', 'Sin archivo', { created_at: '2026-01-04T00:00:00.000Z', download_path: dirEmpty })
    ]

    const asyncPath = await IndexGenerator.generateIndexAsync(forumDir, 'enlaces', posts)
    const asyncMd = fs.readFileSync(asyncPath, 'utf-8')

    expect(asyncMd).toContain('[Solo HTML](001_solo-html/post.html)')
    expect(asyncMd).toContain('[Solo CSV](002_solo%20csv/post.csv)')
    expect(asyncMd).toContain('[Preferencia HTML sobre CSV](003_html-y-csv/post.html)')
    expect(asyncMd).toContain('[Sin archivo](#)')

    const syncPath = IndexGenerator.generateIndex(forumDir, 'enlaces', posts)
    const syncMd = fs.readFileSync(syncPath, 'utf-8')
    expect(syncMd).toContain('[Solo CSV](002_solo%20csv/post.csv)')
    expect(syncMd).toContain('[Solo HTML](001_solo-html/post.html)')
  })

  it('cuenta correctamente synced, outdated y missing en Resumen Ejecutivo e iconos en la tabla', async () => {
    const forumDir = path.join(tempDir, 'foro-estados')
    const posts: CachedPostRecord[] = [
      makePost('t1', 'Post Synced 1', { sync_status: 'synced', file_count: 2, total_size: 1024 }),
      makePost('t2', 'Post Synced 2', { sync_status: 'synced', file_count: 1, total_size: 1024 }),
      makePost('t3', 'Post Outdated', { sync_status: 'outdated', file_count: 3, total_size: 2048 }),
      makePost('t4', 'Post Missing', {
        sync_status: 'missing' as CachedPostRecord['sync_status'],
        file_count: 0,
        total_size: 0
      }),
      makePost('t5', 'Post Error', { sync_status: 'error', file_count: 0, total_size: 0 }),
      makePost('t6', 'Post Deleted', { sync_status: 'deleted', file_count: 0, total_size: 0 })
    ]

    const indexPath = await IndexGenerator.generateIndexAsync(forumDir, 'estados', posts)
    const md = fs.readFileSync(indexPath, 'utf-8')

    expect(md).toMatch(/Posts Archivados:\s+6\b/)
    expect(md).toMatch(/Archivos Totales:\s+6\b/)
    expect(md).toMatch(/Tamaño en Disco:\s+4\.0 KB\b/)
    expect(md).toMatch(/✅ Sincronizados:\s+2\b/)
    expect(md).toMatch(/🔄 Desactualizados:\s+1\b/)
    expect(md).toMatch(/⚠️ Ausentes:\s+1\b/)

    expect(md).toContain('[Post Synced 1](#)')
    expect(md).toMatch(/Post Synced 1.*\| ✅ \|/)
    expect(md).toMatch(/Post Outdated.*\| 🔄 \|/)
    expect(md).toMatch(/Post Missing.*\| ⚠️ \|/)
    expect(md).toMatch(/Post Error.*\| ❌ \|/)
    expect(md).toMatch(/Post Deleted.*\| 🗑️ \|/)
  })

  it('generateIndexAsync cede al event loop con setImmediate cada 100 posts', async () => {
    const forumDir = path.join(tempDir, 'foro-masivo')
    const posts: CachedPostRecord[] = Array.from({ length: 205 }, (_, i) =>
      makePost(`t-${i + 1}`, `Post ${i + 1}`, {
        created_at: new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000).toISOString()
      })
    )

    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate')
    try {
      const indexPath = await IndexGenerator.generateIndexAsync(forumDir, 'masivo', posts)
      expect(fs.existsSync(indexPath)).toBe(true)
      expect(setImmediateSpy).toHaveBeenCalledTimes(2)
    } finally {
      setImmediateSpy.mockRestore()
    }
  })
})
