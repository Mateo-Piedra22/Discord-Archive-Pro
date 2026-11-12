import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isInside, isInsideReal } from './path-guard'

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
