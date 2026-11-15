// ============================================================
// Utilidades de error, filtrado y transcripción para las vistas
// de lectura en vivo (canal de texto e hilo).
// ============================================================

import type { DiscordEmbed, DiscordMessage, DiscordReaction } from '../../../core/discord/types'

export type ContextoLecturaDiscord = 'canal' | 'hilo'

export interface OpcionesFiltroEnVivo {
  consulta: string
  soloAdjuntos: boolean
  soloEnlaces: boolean
  soloFijados?: boolean
}

export interface EstadisticasChat {
  total: number
  autores: number
  adjuntos: number
  enlaces: number
  fijados: number
}

const REGEX_LIMITE = /rate limited|429/i
const REGEX_URL = /https?:\/\//i

function extraerMensajeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return String(err)
}

/** true si el error corresponde a un límite de peticiones (429 / rate limited). */
export function esErrorLimiteDiscord(err: unknown): boolean {
  return REGEX_LIMITE.test(extraerMensajeError(err))
}

/**
 * Traduce el error del IPC a un mensaje accionable según el contexto.
 * El proceso principal envuelve `DiscordApiError` en el texto del error.
 */
export function mensajeDeErrorDiscord(err: unknown, contexto: ContextoLecturaDiscord): string {
  const texto = extraerMensajeError(err)
  if (REGEX_LIMITE.test(texto)) {
    return 'Discord limitó las peticiones. Espera unos segundos y reinténtalo.'
  }
  if (/403|access denied/i.test(texto)) {
    return `Esta cuenta no tiene permiso para leer este ${contexto}.`
  }
  if (/401|unauthorized/i.test(texto)) {
    return 'La sesión ya no es válida. Vuelve a conectar tu cuenta en Ajustes.'
  }
  if (/404|unknown (channel|message)/i.test(texto)) {
    return `Este ${contexto} ya no existe o fue borrado.`
  }
  return `No se pudo cargar el ${contexto}. Revisa la conexión e inténtalo de nuevo.`
}

/** Minúsculas y sin diacríticos para búsquedas insensibles a tildes. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function embedContieneUrl(embed: DiscordEmbed): boolean {
  const candidatos = [
    embed.url,
    embed.title,
    embed.description,
    embed.author?.url,
    embed.provider?.url,
    embed.image?.url,
    embed.thumbnail?.url,
    embed.video?.url
  ]
  if (candidatos.some((valor) => typeof valor === 'string' && REGEX_URL.test(valor))) {
    return true
  }
  return (embed.fields ?? []).some(
    (campo) => REGEX_URL.test(campo.value) || REGEX_URL.test(campo.name)
  )
}

function mensajeContieneEnlace(mensaje: DiscordMessage): boolean {
  if (mensaje.content && REGEX_URL.test(mensaje.content)) return true
  return (mensaje.embeds ?? []).some(embedContieneUrl)
}

interface ConsultaParseada {
  autores: string[]
  requiereEmbed: boolean
  requiereFijado: boolean
  textoLibre: string
}

const REGEX_OPERADOR_FILTRO =
  /(?:^|\s)(?:(?:from|de):(?:"([^"]*)"|'([^']*)'|([^\s"']\S*))|(has:embed|has:pinned|pinned:true))(?=\s|$)/g

function parsearConsultaEnVivo(consulta: string): ConsultaParseada {
  const normalizada = normalizarTexto(consulta)
  const autores: string[] = []
  let requiereEmbed = false
  let requiereFijado = false

  const restante = normalizada.replace(
    REGEX_OPERADOR_FILTRO,
    (_match, comillasDobles, comillasSimples, simple, flag) => {
      if (flag === 'has:embed') {
        requiereEmbed = true
      } else if (flag === 'has:pinned' || flag === 'pinned:true') {
        requiereFijado = true
      } else {
        const autor = (comillasDobles ?? comillasSimples ?? simple ?? '').trim()
        if (autor) autores.push(autor)
      }
      return ' '
    }
  )

  return {
    autores,
    requiereEmbed,
    requiereFijado,
    textoLibre: restante.replace(/\s+/g, ' ').trim()
  }
}

function autorCoincide(mensaje: DiscordMessage, agujaAutor: string): boolean {
  return (
    normalizarTexto(mensaje.author?.global_name ?? '').includes(agujaAutor) ||
    normalizarTexto(mensaje.author?.username ?? '').includes(agujaAutor)
  )
}

/**
 * Filtra mensajes en vivo de forma insensible a tildes y mayúsculas por
 * contenido, `author.global_name`/`username`, `attachments[].filename`,
 * operadores (`from:`/`de:`, `has:embed`, `has:pinned`, `pinned:true`)
 * y los toggles `soloAdjuntos`, `soloEnlaces` y `soloFijados`.
 */
export function filtrarMensajesEnVivo(
  mensajes: DiscordMessage[],
  opciones: OpcionesFiltroEnVivo
): DiscordMessage[] {
  const parsed = parsearConsultaEnVivo(opciones.consulta)
  const exigirFijados = Boolean(opciones.soloFijados) || parsed.requiereFijado

  if (
    !opciones.soloAdjuntos &&
    !opciones.soloEnlaces &&
    !exigirFijados &&
    !parsed.requiereEmbed &&
    parsed.autores.length === 0 &&
    !parsed.textoLibre
  ) {
    return mensajes
  }

  return mensajes.filter((mensaje) => {
    const adjuntos = mensaje.attachments ?? []
    if (opciones.soloAdjuntos && adjuntos.length === 0) return false
    if (opciones.soloEnlaces && !mensajeContieneEnlace(mensaje)) return false
    if (exigirFijados && !mensaje.pinned) return false
    if (parsed.requiereEmbed && (mensaje.embeds ?? []).length === 0) return false
    if (
      parsed.autores.length > 0 &&
      !parsed.autores.every((autor) => autorCoincide(mensaje, autor))
    ) {
      return false
    }

    const aguja = parsed.textoLibre
    if (!aguja) return true

    if (normalizarTexto(mensaje.content ?? '').includes(aguja)) return true
    if (autorCoincide(mensaje, aguja)) return true
    return adjuntos.some((adjunto) => normalizarTexto(adjunto.filename ?? '').includes(aguja))
  })
}

/**
 * Calcula en una sola pasada el total de mensajes, autores únicos (`author.id`),
 * cantidad total de adjuntos, mensajes con enlaces y mensajes fijados.
 */
export function resumirEstadisticasChat(mensajes: DiscordMessage[]): EstadisticasChat {
  const autoresUnicos = new Set<string>()
  let adjuntos = 0
  let enlaces = 0
  let fijados = 0

  for (const mensaje of mensajes) {
    if (mensaje.author?.id) autoresUnicos.add(mensaje.author.id)
    adjuntos += (mensaje.attachments ?? []).length
    if (mensajeContieneEnlace(mensaje)) enlaces++
    if (mensaje.pinned === true) fijados++
  }

  return {
    total: mensajes.length,
    autores: autoresUnicos.size,
    adjuntos,
    enlaces,
    fijados
  }
}

function formatearFechaTranscripcion(timestamp: string): string {
  const fecha = new Date(timestamp)
  if (Number.isNaN(fecha.getTime())) return timestamp || 'Fecha desconocida'
  return `${fecha.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function formatearReferenciaCita(referencia: DiscordMessage): string {
  const refAutor =
    referencia.author?.global_name || referencia.author?.username || 'Desconocido'
  const contenidoLimpio = referencia.content?.trim().replace(/\s+/g, ' ')
  let refTexto: string
  if (contenidoLimpio) {
    refTexto =
      contenidoLimpio.length > 120 ? `${contenidoLimpio.slice(0, 120)}…` : contenidoLimpio
  } else if ((referencia.attachments ?? []).length > 0) {
    const count = referencia.attachments.length
    refTexto = `[${count} ${count === 1 ? 'adjunto' : 'adjuntos'}]`
  } else {
    refTexto = '_Sin contenido de texto_'
  }
  return `> ↳ Respondiendo a **${refAutor}**: ${refTexto}`
}

function formatearReaccionesMarkdown(reacciones: DiscordReaction[]): string {
  return reacciones
    .map((reaccion) => {
      const emoji = reaccion.emoji?.id
        ? `:${reaccion.emoji.name || 'emoji'}:`
        : reaccion.emoji?.name || '❓'
      return `${emoji} ${reaccion.count}`
    })
    .join(' · ')
}

/**
 * Genera una transcripción Markdown limpia y copiable con encabezado `# titulo`,
 * fecha ISO legible por mensaje, autor, indicador de fijado/edición, cita
 * al mensaje respondido, contenido, listado de adjuntos y reacciones.
 */
export function formatearTranscripcionMarkdown(
  titulo: string,
  mensajes: DiscordMessage[]
): string {
  const encabezado = `# ${titulo.trim() || 'Transcripción'}`
  if (mensajes.length === 0) {
    return `${encabezado}\n\n_Sin mensajes._`
  }

  const bloques: string[] = [encabezado]

  for (const mensaje of mensajes) {
    const autor = mensaje.author?.global_name || mensaje.author?.username || 'Desconocido'
    const fecha = formatearFechaTranscripcion(mensaje.timestamp)
    const prefijoFijado = mensaje.pinned ? '📌 ' : ''
    const sufijoEditado = mensaje.edited_timestamp ? ' *(editado)*' : ''
    const partes: string[] = [`### ${prefijoFijado}${autor} · ${fecha}${sufijoEditado}`]

    if (mensaje.referenced_message) {
      partes.push(formatearReferenciaCita(mensaje.referenced_message))
    }

    const texto = mensaje.content?.trim()
    if (texto) partes.push(texto)

    const adjuntos = mensaje.attachments ?? []
    if (adjuntos.length > 0) {
      const lista = adjuntos
        .map((adjunto) =>
          adjunto.url ? `- [${adjunto.filename}](${adjunto.url})` : `- ${adjunto.filename}`
        )
        .join('\n')
      partes.push(`Adjuntos:\n${lista}`)
    }

    if (!texto && adjuntos.length === 0) {
      partes.push('_Sin contenido de texto_')
    }

    const reacciones = mensaje.reactions ?? []
    if (reacciones.length > 0) {
      partes.push(`Reacciones: ${formatearReaccionesMarkdown(reacciones)}`)
    }

    bloques.push(partes.join('\n\n'))
  }

  return bloques.join('\n\n')
}
