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
  '(<t:\\d+(?::[tTdDfFR])?>)',
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
  | 'timestamp'
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
  if (token.startsWith('<t:')) return 'timestamp'
  if (token.startsWith('<@&')) return 'rol'
  if (token.startsWith('<@')) return 'usuario'
  if (token.startsWith('<#')) return 'canal'
  return 'url'
}

/** Formatea una marca `<t:unix(:estilo)?>` de Discord en español legible. */
function formatearTimestamp(token: string): { texto: string; titulo: string } {
  const m = /^<t:(\d+)(?::([tTdDfFR]))?>$/.exec(token)
  if (!m) return { texto: token, titulo: token }
  const fecha = new Date(Number(m[1]) * 1000)
  if (Number.isNaN(fecha.getTime())) return { texto: token, titulo: token }

  const estilo = m[2] || 'f'
  const titulo = fecha.toLocaleString('es')

  if (estilo === 'R') {
    const diffMs = fecha.getTime() - Date.now()
    const absSeg = Math.round(Math.abs(diffMs) / 1000)
    const futuro = diffMs > 0
    const envolver = (n: number, u: string) => (futuro ? `en ${n} ${u}` : `hace ${n} ${u}`)
    if (absSeg < 60) return { texto: futuro ? 'en unos segundos' : 'hace unos segundos', titulo }
    const mins = Math.round(absSeg / 60)
    if (mins < 60) return { texto: envolver(mins, mins === 1 ? 'minuto' : 'minutos'), titulo }
    const horas = Math.round(mins / 60)
    if (horas < 24) return { texto: envolver(horas, horas === 1 ? 'hora' : 'horas'), titulo }
    const dias = Math.round(horas / 24)
    return { texto: envolver(dias, dias === 1 ? 'día' : 'días'), titulo }
  }

  const opciones: Intl.DateTimeFormatOptions =
    estilo === 't'
      ? { hour: '2-digit', minute: '2-digit' }
      : estilo === 'T'
        ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
        : estilo === 'd'
          ? { day: '2-digit', month: '2-digit', year: 'numeric' }
          : estilo === 'D'
            ? { day: 'numeric', month: 'long', year: 'numeric' }
            : estilo === 'F'
              ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
              : { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }

  return { texto: fecha.toLocaleString('es', opciones), titulo }
}

/** Construye un nodo `<pre className="codigo">` conservando el lenguaje si existe. */
function renderizarBloqueCodigo(clave: string, lenguaje: string, codigo: string): ReactNode {
  const limpio = codigo.replace(/^\n+|\n+$/g, '')
  const lang = lenguaje.trim()
  return h(
    'pre',
    { key: clave, className: 'codigo', 'data-lang': lang || undefined },
    lang ? h('span', { className: 'msg__codelang' }, lang) : null,
    h('code', null, limpio)
  )
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
        const interior = token.slice(3, -3)
        const salto = interior.indexOf('\n')
        const lenguaje = salto >= 0 ? interior.slice(0, salto).trim() : ''
        const codigo = salto >= 0 ? interior.slice(salto + 1) : interior
        nodos.push(renderizarBloqueCodigo(claveToken, lenguaje, codigo))
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
      case 'timestamp': {
        const { texto, titulo } = formatearTimestamp(token)
        nodos.push(h('span', { key: claveToken, className: 'msg__ts', title: titulo }, texto))
        break
      }
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
 * Renderiza el markdown de un mensaje soportando bloques multilínea, encabezados,
 * subtexto (`-#`), citas (`>` / `>>>`), timestamps `<t:...>` y enlaces seguros.
 */
export function renderizarMarkdown(texto: string, opciones: OpcionesMarkdown = {}): ReactNode {
  if (!texto) return null

  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const nodos: ReactNode[] = []
  let previoFueBloque = true

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    const recorte = linea.trimStart()

    // Bloque de código multilínea ```lang\n...\n```
    if (recorte.startsWith('```') && recorte.indexOf('```', 3) === -1) {
      const lang = recorte.slice(3).trim()
      let cierre = -1
      for (let j = i + 1; j < lineas.length; j++) {
        if (lineas[j].trim().startsWith('```')) {
          cierre = j
          break
        }
      }
      if (cierre !== -1) {
        nodos.push(renderizarBloqueCodigo(`fenced-${i}`, lang, lineas.slice(i + 1, cierre).join('\n')))
        i = cierre
        previoFueBloque = true
        continue
      }
    }

    // Cita multilínea con >>> hasta el final del mensaje
    if (recorte.startsWith('>>>')) {
      const primera = recorte.replace(/^>>>\s?/, '')
      const resto = [primera, ...lineas.slice(i + 1)]
      const contenidoCita: ReactNode[] = []
      resto.forEach((ln, idx) => {
        if (idx > 0) contenidoCita.push(h('br', { key: `qb-${i}-${idx}` }))
        contenidoCita.push(...analizar(ln, `ql${i}-${idx}`, opciones.menciones))
      })
      nodos.push(h('blockquote', { key: `quote-all-${i}`, className: 'msg__quote' }, ...contenidoCita))
      previoFueBloque = true
      break
    }

    // Líneas consecutivas con >
    if (/^>(?:\s|$)/.test(recorte)) {
      const citaLineas: string[] = []
      let j = i
      while (j < lineas.length && /^>(?:\s|$)/.test(lineas[j].trimStart())) {
        citaLineas.push(lineas[j].trimStart().replace(/^>\s?/, ''))
        j++
      }
      const contenidoCita: ReactNode[] = []
      citaLineas.forEach((ln, idx) => {
        if (idx > 0) contenidoCita.push(h('br', { key: `qbr-${i}-${idx}` }))
        contenidoCita.push(...analizar(ln, `q${i}-${idx}`, opciones.menciones))
      })
      nodos.push(h('blockquote', { key: `quote-${i}`, className: 'msg__quote' }, ...contenidoCita))
      i = j - 1
      previoFueBloque = true
      continue
    }

    // Encabezados (#, ##, ###) y subtexto (-#) propios de Discord
    const matchEncabezado = /^(#{1,3})\s+(.+)$/.exec(linea)
    if (matchEncabezado) {
      const nivel = matchEncabezado[1].length
      nodos.push(
        h(
          'span',
          { key: `h-${i}`, className: `msg__h${nivel}` },
          ...analizar(matchEncabezado[2], `hl${i}`, opciones.menciones)
        )
      )
      previoFueBloque = true
      continue
    }

    const matchSubtexto = /^-#\s+(.+)$/.exec(linea)
    if (matchSubtexto) {
      nodos.push(
        h(
          'span',
          { key: `sub-${i}`, className: 'msg__subtexto' },
          ...analizar(matchSubtexto[1], `sl${i}`, opciones.menciones)
        )
      )
      previoFueBloque = true
      continue
    }

    if (!previoFueBloque) nodos.push(h('br', { key: `salto-${i}` }))
    nodos.push(...analizar(linea, `l${i}`, opciones.menciones))
    previoFueBloque = false
  }

  return nodos
}
