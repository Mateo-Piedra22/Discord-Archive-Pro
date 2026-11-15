import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderizarMarkdown } from './discordMarkdown'

type ElemShape = {
  type: unknown
  props: Record<string, unknown> & { children?: ReactNode }
}

function walkElements(node: ReactNode, visitor: (el: ElemShape) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visitor)
    return
  }
  if (isValidElement(node)) {
    const el = node as unknown as ElemShape
    visitor(el)
    walkElements(el.props.children, visitor)
  }
}

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (isValidElement(node)) return collectText((node as unknown as ElemShape).props.children)
  return ''
}

describe('renderizarMarkdown (Discord live viewer)', () => {
  it('devuelve null para cadena vacía y conserva saltos de línea con <br>', () => {
    expect(renderizarMarkdown('')).toBeNull()
    const nodos = renderizarMarkdown('primera línea\nsegunda línea') as ReactNode[]
    expect(collectText(nodos)).toBe('primera líneasegunda línea')
    const tipos = nodos.map((n) => (isValidElement(n) ? n.type : typeof n))
    expect(tipos).toContain('br')
  })

  it('resuelve formato en línea, spoilers, menciones y recorte de puntuación en URLs', () => {
    const menciones = new Map([['101', 'Lucía'], ['202', 'general']])
    const tree = renderizarMarkdown(
      '**negrita** _cursiva_ ||secreto|| <@!101> <#202> ver https://discord.com/channels/1/2.',
      { menciones }
    )

    const spans: string[] = []
    const links: string[] = []
    let hasSpoiler = false

    walkElements(tree, (el) => {
      if (el.type === 'span' && el.props.className === 'mencion') {
        spans.push(collectText(el.props.children))
      }
      if (el.type === 'a' && typeof el.props.href === 'string') {
        links.push(el.props.href)
      }
      if (el.type === 'details' && el.props.className === 'spoiler') {
        hasSpoiler = true
      }
    })

    expect(spans).toEqual(['@Lucía', '#general'])
    expect(links).toEqual(['https://discord.com/channels/1/2'])
    expect(hasSpoiler).toBe(true)
    expect(collectText(tree)).toContain('secreto')
    expect(collectText(tree)).toContain('.')
  })

  it('soporta bloques de código multilínea con etiqueta de lenguaje', () => {
    const tree = renderizarMarkdown('Antes\n```ts\nconst x = 1\nconst y = 2\n```\nDespués')
    let preLang: unknown
    let codeLangLabel = ''
    let codeBody = ''

    walkElements(tree, (el) => {
      if (el.type === 'pre' && el.props.className === 'codigo') {
        preLang = el.props['data-lang']
      }
      if (el.type === 'span' && el.props.className === 'msg__codelang') {
        codeLangLabel = collectText(el.props.children)
      }
      if (el.type === 'code') {
        codeBody = collectText(el.props.children)
      }
    })

    expect(preLang).toBe('ts')
    expect(codeLangLabel).toBe('ts')
    expect(codeBody).toBe('const x = 1\nconst y = 2')
  })

  it('renderiza encabezados, subtexto (-#), citas (> y >>>) y timestamps <t:...>', () => {
    const tree = renderizarMarkdown(
      '# Título\n-# nota al pie\n> línea 1\n> línea 2\nMarca <t:1700000000:R>'
    )

    const clases: string[] = []
    let quoteText = ''
    let tsText = ''

    walkElements(tree, (el) => {
      if (typeof el.props.className === 'string') clases.push(el.props.className)
      if (el.type === 'blockquote') quoteText = collectText(el.props.children)
      if (el.props.className === 'msg__ts') tsText = collectText(el.props.children)
    })

    expect(clases).toContain('msg__h1')
    expect(clases).toContain('msg__subtexto')
    expect(clases).toContain('msg__quote')
    expect(clases).toContain('msg__ts')
    expect(quoteText).toContain('línea 1')
    expect(quoteText).toContain('línea 2')
    expect(tsText.length).toBeGreaterThan(3)
  })

  it('renderiza emojis animados/estáticos, h2/h3, tachado, código inline y cita >>>', () => {
    const tree = renderizarMarkdown(
      '## Subtítulo\n### Sección\n`inline` ~~tachado~~ <:ok:111> <a:spin:222>\n>>> cita A\ncita B'
    )

    const clases: string[] = []
    const emojis: string[] = []
    let tieneTachado = false
    let quoteMultilinea = ''

    walkElements(tree, (el) => {
      if (typeof el.props.className === 'string') clases.push(el.props.className)
      if (el.type === 'img' && typeof el.props.src === 'string') emojis.push(el.props.src)
      if (el.type === 's') tieneTachado = true
      if (el.type === 'blockquote') quoteMultilinea = collectText(el.props.children)
    })

    expect(clases).toContain('msg__h2')
    expect(clases).toContain('msg__h3')
    expect(clases).toContain('mono')
    expect(tieneTachado).toBe(true)
    expect(emojis).toEqual([
      'https://cdn.discordapp.com/emojis/111.png',
      'https://cdn.discordapp.com/emojis/222.gif'
    ])
    expect(quoteMultilinea).toContain('cita A')
    expect(quoteMultilinea).toContain('cita B')
  })
})
