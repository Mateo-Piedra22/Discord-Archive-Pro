import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { clearRealpathCache, isInside, isInsideReal, isInsideRealAsync } from './path-guard'

const ROOT = path.resolve('C:/archivo')

describe('isInside', () => {
  it('acepta un archivo dentro del directorio', () => {
    expect(isInside(ROOT, path.join(ROOT, 'post', 'post.md'))).toBe(true)
  })

  it('rechaza el propio directorio raíz', () => {
    expect(isInside(ROOT, ROOT)).toBe(false)
  })

  it('rechaza traversal con ..', () => {
    expect(isInside(ROOT, path.join(ROOT, '..', 'secreto.txt'))).toBe(false)
  })

  it('rechaza rutas absolutas ajenas', () => {
    expect(isInside(ROOT, 'C:/Windows/System32/config/SAM')).toBe(false)
  })

  it('rechaza prefijos engañosos', () => {
    // "C:/archivo-secreto" empieza por "C:/archivo" pero no está dentro.
    expect(isInside(ROOT, 'C:/archivo-secreto/x.md')).toBe(false)
  })

  it('rechaza cadena vacía', () => {
    expect(isInside('', path.join(ROOT, 'a.md'))).toBe(false)
  })
})

describe('isInsideReal', () => {
  it('acepta un archivo real dentro del directorio', () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-guard-'))
    const archivo = path.join(raiz, 'post.md')
    fs.writeFileSync(archivo, 'hola')
    expect(isInsideReal(raiz, archivo)).toBe(true)
    fs.rmSync(raiz, { recursive: true, force: true })
  })

  it('rechaza rutas que no existen (no se puede resolver el enlace real)', () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-guard-'))
    expect(isInsideReal(raiz, path.join(raiz, 'no-existe.md'))).toBe(false)
    fs.rmSync(raiz, { recursive: true, force: true })
  })
})

describe('isInsideRealAsync', () => {
  const tempDirs: string[] = []

  function crearRaizTemporal(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-guard-async-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    clearRealpathCache()
    vi.restoreAllMocks()
    vi.useRealTimers()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('acepta rutas válidas dentro del directorio', async () => {
    const raiz = crearRaizTemporal()
    const sub = path.join(raiz, 'sub')
    fs.mkdirSync(sub)
    const archivo = path.join(sub, 'post.md')
    fs.writeFileSync(archivo, 'hola')

    await expect(isInsideRealAsync(raiz, archivo)).resolves.toBe(true)
  })

  it('bloquea traversal con .. y rutas fuera del directorio', async () => {
    const raiz = crearRaizTemporal()
    const exterior = crearRaizTemporal()
    const archivoExterior = path.join(exterior, 'secreto.txt')
    fs.writeFileSync(archivoExterior, 'secreto')

    await expect(isInsideRealAsync(raiz, path.join(raiz, '..', path.basename(exterior), 'secreto.txt'))).resolves.toBe(false)
    await expect(isInsideRealAsync(raiz, archivoExterior)).resolves.toBe(false)
    await expect(isInsideRealAsync(raiz, raiz)).resolves.toBe(false)
  })

  it('rechaza rutas inexistentes', async () => {
    const raiz = crearRaizTemporal()
    await expect(isInsideRealAsync(raiz, path.join(raiz, 'no-existe.md'))).resolves.toBe(false)
    await expect(isInsideRealAsync(path.join(raiz, 'raiz-inexistente'), path.join(raiz, 'raiz-inexistente', 'a.md'))).resolves.toBe(false)
  })

  it('reutiliza la caché de raíz y clearRealpathCache() fuerza recalcular', async () => {
    const raiz = crearRaizTemporal()
    const archivoA = path.join(raiz, 'a.md')
    const archivoB = path.join(raiz, 'b.md')
    fs.writeFileSync(archivoA, 'a')
    fs.writeFileSync(archivoB, 'b')

    const spy = vi.spyOn(fs.promises, 'realpath')

    await expect(isInsideRealAsync(raiz, archivoA)).resolves.toBe(true)
    await expect(isInsideRealAsync(raiz, archivoB)).resolves.toBe(true)

    const llamadasRaizAntes = spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz))
    expect(llamadasRaizAntes).toHaveLength(1)

    clearRealpathCache()

    await expect(isInsideRealAsync(raiz, archivoA)).resolves.toBe(true)
    const llamadasRaizDespues = spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz))
    expect(llamadasRaizDespues).toHaveLength(2)
  })

  it('expira entradas de caché tras 10000 ms y acota el máximo a 64 raíces', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const base = crearRaizTemporal()
    const spy = vi.spyOn(fs.promises, 'realpath')

    const raiz0 = path.join(base, 'r0')
    fs.mkdirSync(raiz0)
    const file0 = path.join(raiz0, 'item.txt')
    fs.writeFileSync(file0, '0')

    await expect(isInsideRealAsync(raiz0, file0)).resolves.toBe(true)
    expect(spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz0))).toHaveLength(1)

    // Dentro del TTL sigue cacheado
    vi.advanceTimersByTime(5000)
    await expect(isInsideRealAsync(raiz0, file0)).resolves.toBe(true)
    expect(spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz0))).toHaveLength(1)

    // Al superar los 10000 ms expira y recalcula
    vi.advanceTimersByTime(5001)
    await expect(isInsideRealAsync(raiz0, file0)).resolves.toBe(true)
    expect(spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz0))).toHaveLength(2)

    // Llenar 64 entradas adicionales fuerza limpieza al superar el límite de 64
    for (let i = 1; i <= 64; i++) {
      const r = path.join(base, `r${i}`)
      fs.mkdirSync(r)
      const f = path.join(r, 'item.txt')
      fs.writeFileSync(f, String(i))
      await expect(isInsideRealAsync(r, f)).resolves.toBe(true)
    }

    await expect(isInsideRealAsync(raiz0, file0)).resolves.toBe(true)
    expect(spy.mock.calls.filter(([p]) => path.resolve(String(p)) === path.resolve(raiz0))).toHaveLength(3)
  })
})
