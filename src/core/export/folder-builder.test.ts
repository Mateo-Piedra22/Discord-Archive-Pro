import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { FolderBuilder } from './folder-builder'
import type { ExportOptions } from '../discord/types'

function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    formats: ['markdown'],
    outputDir: '',
    folderStructure: 'by-server',
    namingPattern: '{num}_{date}_{title}',
    includeToc: true,
    threadMode: 'both',
    maxFilenameLength: 80,
    includeAvatars: false,
    includeStickers: true,
    includeCustomEmojis: true,
    maxFileSize: 0,
    preserveFilenames: true,
    dateFormat: 'YYYY-MM-DD',
    syncMode: 'quick',
    ...overrides
  }
}

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dap-folder-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('FolderBuilder', () => {
  it('numera por el prefijo máximo existente, no por el conteo', () => {
    const builder = new FolderBuilder(makeOptions({ outputDir: root }))
    const forum = builder.getForumDirectory('Servidor', 'foro')

    // Simula una carpeta 007 ya existente y un hueco en 001..006.
    fs.mkdirSync(path.join(forum, '007_existente'), { recursive: true })

    const created = builder.createPostDirectory('Servidor', 'foro', 'Nuevo post', '2026-01-02T03:04:05Z')
    expect(path.basename(created).startsWith('008_')).toBe(true)
  })

  it('usa el formato de fecha configurado', () => {
    const builder = new FolderBuilder(
      makeOptions({ outputDir: root, dateFormat: 'DD-MM-YYYY', namingPattern: '{date}_{title}' })
    )
    const iso = '2026-01-02T12:00:00Z'
    // La carpeta usa la fecha LOCAL del usuario, así que el esperado se
    // calcula con los mismos getters (el test no depende de la zona horaria).
    const d = new Date(iso)
    const expected = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}_Post`
    const created = builder.createPostDirectory('S', 'C', 'Post', iso)
    expect(path.basename(created)).toBe(expected)
  })

  it('aplana la estructura con folderStructure=flat', () => {
    const builder = new FolderBuilder(
      makeOptions({ outputDir: root, folderStructure: 'flat', namingPattern: '{title}' })
    )
    const created = builder.createPostDirectory('Servidor', 'foro', 'Post plano')
    expect(path.dirname(created)).toBe(root)
  })

  it('agrupa por mes con folderStructure=by-date', () => {
    const builder = new FolderBuilder(
      makeOptions({ outputDir: root, folderStructure: 'by-date', namingPattern: '{title}' })
    )
    const created = builder.createPostDirectory('Servidor', 'foro', 'Post', '2026-03-15T00:00:00Z')
    expect(path.dirname(created)).toBe(path.join(root, '2026-03'))
  })

  it('no repite nombre cuando la carpeta ya existe', () => {
    const builder = new FolderBuilder(makeOptions({ outputDir: root, namingPattern: '{title}' }))
    const first = builder.createPostDirectory('S', 'C', 'Mismo nombre')
    const second = builder.createPostDirectory('S', 'C', 'Mismo nombre')
    expect(second).not.toBe(first)
    expect(fs.existsSync(first)).toBe(true)
    expect(fs.existsSync(second)).toBe(true)
  })
})
