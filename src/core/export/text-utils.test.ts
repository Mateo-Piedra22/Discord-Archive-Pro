import { describe, expect, it } from 'vitest'
import { sanitizePdfText, stripMarkdown, wrapText } from './text-utils'

describe('sanitizePdfText', () => {
  it('conserva acentos cuando la fuente es Unicode', () => {
    expect(sanitizePdfText('Canción · año', true)).toBe('Canción · año')
  })

  it('reemplaza no-ASCII cuando la fuente es Helvetica', () => {
    expect(sanitizePdfText('Canción', false)).toBe('Canci?n')
  })

  it('elimina caracteres de control y pares sustitutos aislados', () => {
    expect(sanitizePdfText('a\u0000b', true)).toBe('ab')
    expect(sanitizePdfText('x\uD800y', true)).toBe('xy')
  })
})

describe('stripMarkdown', () => {
  it('quita énfasis, código y enlaces conservando el texto', () => {
    const input = '**Hola** _mundo_ `code` [link](https://x.y) ~~tachado~~'
    expect(stripMarkdown(input)).toBe('Hola mundo code link (https://x.y) tachado')
  })

  it('quita encabezados y citas', () => {
    expect(stripMarkdown('## Título\n> cita')).toBe('Título\ncita')
  })
})

describe('wrapText', () => {
  const measure = (text: string, size: number): number => text.length * size

  it('corta por palabras sin pasarse del ancho', () => {
    const lines = wrapText('uno dos tres cuatro cinco', 1, 10, measure)
    expect(lines.every((line) => line.length <= 10)).toBe(true)
    expect(lines.join(' ')).toBe('uno dos tres cuatro cinco')
  })

  it('parte palabras más largas que la línea', () => {
    const lines = wrapText('supercalifragilisticoespialidoso', 1, 8, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => line.length <= 8)).toBe(true)
  })

  it('devuelve una línea vacía para texto vacío', () => {
    expect(wrapText('', 10, 100, measure)).toEqual([''])
  })
})
