// ============================================================
// Markdown mínimo de Discord para el visor de mensajes.
// Devuelve nodos de React: nunca inyecta HTML crudo del mensaje.
// ============================================================

import { createElement as h } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

/** Opciones de renderizado. */
export interface OpcionesMarkdown {
  /** Mapa id → nombre visible para resolver menciones y roles. */
  menciones?: Map<string, string>
}

/**
 * Alternativas en orden de prioridad: el bloque de código gana a todo y la
 * URL suelta va al final para no comerse el destino de un enlace `[texto](url)`.
 * El flag `u` es necesario para `\p{L}` y el lookbehind evita que `_` dentro
 * de una palabra (`snake_case`) se interprete como cursiva.
 */
const PATRON_ENLINEA = [
  '(```[\\s\\S]*?```)',
  '(`[^`\\n]+`)',
  '(\\|\\|[\\s\\S]+?\\|\\|)',
  '(\\*\\*\\*[^*\\n]+\\*\\*\\*)',
  '(\\*\\*[\\s\\S]+?\\*\\*)',
  '(__[\\s\\S]+?__)',
  '(?<![\\p{L}\\p{N}_])(_[^_\\n]+_)(?![\\p{L}\\p{N}_])',
  '(\\*[^*\\n]+\\*)',
  '(~~[\\s\\S]+?~~)',
  '(\\[[^\\]\\n]*\\]\\([^)\\s]+\\))',
  '(<a?:[A-Za-z0-9_~]+:\\d+>)',
  '(<@!?\\d+>)',
  '(<@&\\d+>)',
  '(<#\\d+>)',
  '(https?:\\/\\/[^\\s<>()]+)'
].join('|')

type TipoToken =
  | 'bloque'
  | 'codigo'
  | 'spoiler'
  | 'negrita-cursiva'
  | 'negrita'
  | 'cursiva'
  | 'tachado'
  | 'enlace'
  | 'emoji'
  | 'usuario'
  | 'rol'
  | 'canal'
  | 'url'

/** Abre un enlace fuera de la app; el proceso principal valida el dominio. */
export function abrirEnlaceExterno(url: string): void {
  void window.api.app.openExternal(url)
}

/** Intercepta el clic para no navegar nunca dentro del renderer. */
export function manejarEnlaceExterno(evento: ReactMouseEvent<HTMLAnchorElement>): void {
  evento.preventDefault()
  const destino = evento.currentTarget.getAttribute('href')
  if (destino) abrirEnlaceExterno(destino)
}

/** Clasifica el token ya recortado por su prefijo. */
function tipoDeToken(token: string): TipoToken {
  if (token.startsWith('```')) return 'bloque'
  if (token.startsWith('`')) return 'codigo'
  if (token.startsWith('||')) return 'spoiler'
  if (token.startsWith('***')) return 'negrita-cursiva'
  if (token.startsWith('**') || token.startsWith('__')) return 'negrita'
  if (token.startsWith('~~')) return 'tachado'
  if (token.startsWith('_') || token.startsWith('*')) return 'cursiva'
  if (token.startsWith('[')) return 'enlace'
  if (token.startsWith('<a:') || token.startsWith('<:')) return 'emoji'
  if (token.startsWith('<@&')) return 'rol'
  if (token.startsWith('<@')) return 'usuario'
  if (token.startsWith('<#')) return 'canal'
  return 'url'
}

/** Solo los dígitos de una mención: `<@!123>` → `123`. */
function idDeMencion(token: string): string {
  return token.replace(/\D/g, '')
}

/** `<a:nombre:123>` → emoji animado en gif; `<:nombre:123>` → png. */
function renderizarEmoji(token: string, clave: string): ReactNode {
  const partes = token.slice(1, -1).split(':')
  const id = partes[partes.length - 1]
  const nombre = partes[partes.length - 2] ?? 'emoji'
  const animado = partes[0] === 'a'

  return h('img', {
    key: clave,
    className: 'emoji',
    src: `https://cdn.discordapp.com/emojis/${id}.${animado ? 'gif' : 'png'}`,
    alt: `:${nombre}:`,
    title: `:${nombre}:`,
    width: 18,
    height: 18,
    loading: 'lazy'
  })
}

/** Convierte una mención cruda en texto legible usando el mapa si lo conoce. */
function textoDeMencion(
  token: string,
  tipo: 'usuario' | 'rol' | 'canal',
  menciones?: Map<string, string>
): string {
  const nombre = menciones?.get(idDeMencion(token))
  if (tipo === 'canal') return `#${nombre ?? 'canal'}`
  if (tipo === 'rol') return `@${nombre ?? 'rol'}`
  return `@${nombre ?? 'usuario'}`
}

/** Recorre una línea y devuelve los nodos ya resueltos. */
function analizar(linea: string, clave: string, menciones?: Map<string, string>): ReactNode[] {
  const nodos: ReactNode[] = []
  const patron = new RegExp(PATRON_ENLINEA, 'gu')
  let ultimo = 0
  let indice = 0
  let coincidencia: RegExpExecArray | null = patron.exec(linea)

  while (coincidencia !== null) {
    if (coincidencia.index > ultimo) nodos.push(linea.slice(ultimo, coincidencia.index))

    const token = coincidencia[0]
    const claveToken = `${clave}-${indice++}`
    const tipo = tipoDeToken(token)

    switch (tipo) {
      case 'bloque': {
        // ```lenguaje\ncódigo``` → el lenguaje se descarta.
        const interior = token.slice(3, -3)
        const salto = interior.indexOf('\n')
        const codigo = salto >= 0 ? interior.slice(salto + 1) : interior
        nodos.push(
          h('pre', { key: claveToken, className: 'codigo' }, h('code', null, codigo.replace(/\n$/, '')))
        )
        break
      }
      case 'codigo':
        nodos.push(h('code', { key: claveToken, className: 'mono' }, token.slice(1, -1)))
        break
      case 'spoiler':
        nodos.push(
          h(
            'details',
            { key: claveToken, className: 'spoiler' },
            h('summary', null, 'spoiler'),
            ...analizar(token.slice(2, -2), claveToken, menciones)
          )
        )
        break
      case 'negrita-cursiva':
        nodos.push(
          h('strong', { key: claveToken }, h('em', null, ...analizar(token.slice(3, -3), claveToken, menciones)))
        )
        break
      case 'negrita':
        nodos.push(h('strong', { key: claveToken }, ...analizar(token.slice(2, -2), claveToken, menciones)))
        break
      case 'cursiva':
        nodos.push(h('em', { key: claveToken }, ...analizar(token.slice(1, -1), claveToken, menciones)))
        break
      case 'tachado':
        nodos.push(h('s', { key: claveToken }, ...analizar(token.slice(2, -2), claveToken, menciones)))
        break
      case 'enlace': {
        const corte = token.indexOf('](')
        const etiqueta = token.slice(1, corte)
        const destino = token.slice(corte + 2, -1)
        nodos.push(
          h(
            'a',
            { key: claveToken, href: destino, rel: 'noreferrer', onClick: manejarEnlaceExterno },
            ...analizar(etiqueta, claveToken, menciones)
          )
        )
        break
      }
      case 'emoji':
        nodos.push(renderizarEmoji(token, claveToken))
        break
      case 'usuario':
      case 'rol':
      case 'canal':
        nodos.push(
          h('span', { key: claveToken, className: 'mencion' }, textoDeMencion(token, tipo, menciones))
        )
        break
      case 'url': {
        // La puntuación final no forma parte del enlace.
        const limpia = token.replace(/[.,;:!?]+$/, '')
        nodos.push(
          h(
            'a',
            { key: claveToken, href: limpia, rel: 'noreferrer', onClick: manejarEnlaceExterno },
            limpia
          )
        )
        if (limpia !== token) nodos.push(token.slice(limpia.length))
        break
      }
    }

    ultimo = coincidencia.index + token.length
    coincidencia = patron.exec(linea)
  }

  if (ultimo < linea.length) nodos.push(linea.slice(ultimo))
  return nodos
}

/**
 * Renderiza el markdown de un mensaje. Los saltos de línea se convierten en
 * `<br>` para que el resultado se vea igual con o sin `white-space: pre-wrap`.
 */
export function renderizarMarkdown(texto: string, opciones: OpcionesMarkdown = {}): ReactNode {
  if (!texto) return null

  const lineas = texto.split('\n')
  const nodos: ReactNode[] = []

  lineas.forEach((linea, i) => {
    if (i > 0) nodos.push(h('br', { key: `salto-${i}` }))
    nodos.push(...analizar(linea, `l${i}`, opciones.menciones))
  })

  return nodos
}
