import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCachedFile } = vi.hoisted(() => ({
  mockGetCachedFile: vi.fn()
}))

vi.mock('../storage/database', () => ({
  getCachedFile: mockGetCachedFile
}))

import { Deduplicator, MAX_SESSION_ENTRIES } from './deduplicator'

describe('Deduplicator', () => {
  let tempRoot: string
  let postDir: string
  let otroPostDir: string

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-dedup-'))
    postDir = path.join(tempRoot, 'post-1')
    otroPostDir = path.join(tempRoot, 'post-2')
    fs.mkdirSync(path.join(postDir, 'assets'), { recursive: true })
    fs.mkdirSync(path.join(otroPostDir, 'assets'), { recursive: true })
    mockGetCachedFile.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('devuelve null cuando no existe caché o fue invalidado', () => {
    const dedup = new Deduplicator()
    mockGetCachedFile.mockReturnValue(undefined)
    expect(dedup.check('f1', postDir)).toBeNull()

    const archivo = path.join(postDir, 'assets', 'foto.png')
    fs.writeFileSync(archivo, 'ok')
    mockGetCachedFile.mockReturnValue({ local_path: archivo, still_valid: false })
    expect(dedup.check('f2', postDir)).toBeNull()
  })

  it('reutiliza un archivo válido dentro del mismo postDir en formato POSIX', () => {
    const dedup = new Deduplicator()
    const archivo = path.join(postDir, 'assets', 'foto.png')
    fs.writeFileSync(archivo, 'pngdata')
    mockGetCachedFile.mockReturnValue({ local_path: archivo, still_valid: true })

    expect(dedup.check('f3', postDir)).toBe('assets/foto.png')
  })

  it('rechaza reutilizar archivos de otro post fuera de postDir', () => {
    const dedup = new Deduplicator()
    const archivoAjeno = path.join(otroPostDir, 'assets', 'ajeno.png')
    fs.writeFileSync(archivoAjeno, 'pngdata')
    mockGetCachedFile.mockReturnValue({ local_path: archivoAjeno, still_valid: true })

    expect(dedup.check('f4', postDir)).toBeNull()
  })

  it('usa record() en sesión y clear() borra la caché en memoria', () => {
    const dedup = new Deduplicator()
    const archivo = path.join(postDir, 'assets', 'clip.mp4')
    fs.writeFileSync(archivo, 'video')
    mockGetCachedFile.mockReturnValue(undefined)

    dedup.record('f5', 'assets/clip.mp4')
    expect(dedup.check('f5', postDir)).toBe('assets/clip.mp4')

    dedup.clear()
    expect(dedup.check('f5', postDir)).toBeNull()
  })

  it('checkAsync verifica existencia mediante fs.promises.access sin usar fs.existsSync', async () => {
    const dedup = new Deduplicator()
    const archivo = path.join(postDir, 'assets', 'async.png')
    fs.writeFileSync(archivo, 'pngdata')
    const archivoAjeno = path.join(otroPostDir, 'assets', 'ajeno.png')
    fs.writeFileSync(archivoAjeno, 'pngdata')

    const accessSpy = vi.spyOn(fs.promises, 'access')
    const existsSpy = vi.spyOn(fs, 'existsSync')

    mockGetCachedFile.mockReturnValue(undefined)
    expect(await dedup.checkAsync('a-missing', postDir)).toBeNull()

    mockGetCachedFile.mockReturnValue({ local_path: archivo, still_valid: false })
    expect(await dedup.checkAsync('a-invalid', postDir)).toBeNull()

    mockGetCachedFile.mockReturnValue({
      local_path: path.join(postDir, 'assets', 'no-existe.png'),
      still_valid: true
    })
    expect(await dedup.checkAsync('a-nofile', postDir)).toBeNull()

    mockGetCachedFile.mockReturnValue({ local_path: archivoAjeno, still_valid: true })
    expect(await dedup.checkAsync('a-foreign', postDir)).toBeNull()

    mockGetCachedFile.mockReturnValue({ local_path: archivo, still_valid: true })
    expect(await dedup.checkAsync('a-ok', postDir)).toBe('assets/async.png')

    // Segunda consulta debe resolverse desde sesión sin volver a consultar BD
    mockGetCachedFile.mockReturnValue(undefined)
    expect(await dedup.checkAsync('a-ok', postDir)).toBe('assets/async.png')

    // Si desaparece del disco, checkAsync devuelve null
    fs.unlinkSync(archivo)
    expect(await dedup.checkAsync('a-ok', postDir)).toBeNull()

    expect(accessSpy).toHaveBeenCalled()
    expect(existsSpy).not.toHaveBeenCalled()
  })

  it('acota la caché de sesión a MAX_SESSION_ENTRIES eliminando la clave más antigua', async () => {
    expect(MAX_SESSION_ENTRIES).toBe(5000)
    expect(Deduplicator.MAX_SESSION_ENTRIES).toBe(5000)

    const dedup = new Deduplicator()
    const archivo = path.join(postDir, 'assets', 'shared.png')
    fs.writeFileSync(archivo, 'shared')
    mockGetCachedFile.mockReturnValue(undefined)

    const overflow = 5
    for (let i = 0; i < MAX_SESSION_ENTRIES + overflow; i++) {
      dedup.record(`file-${i}`, 'assets/shared.png')
    }

    // Las primeras `overflow` claves debieron ser expulsadas
    for (let i = 0; i < overflow; i++) {
      expect(dedup.check(`file-${i}`, postDir)).toBeNull()
    }

    // La más antigua sobreviviente y la última registrada permanecen disponibles
    expect(dedup.check(`file-${overflow}`, postDir)).toBe('assets/shared.png')
    expect(await dedup.checkAsync(`file-${MAX_SESSION_ENTRIES + overflow - 1}`, postDir)).toBe(
      'assets/shared.png'
    )

    // Re-registrar una clave existente mantiene el tamaño dentro del tope sin expulsar válidas
    dedup.record(`file-${overflow}`, 'assets/shared.png')
    expect(dedup.check(`file-${overflow + 1}`, postDir)).toBe('assets/shared.png')
  })
})
