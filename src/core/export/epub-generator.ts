// ============================================================
// Generador de EPUB — libro offline en XHTML válido y escapado.
// No incrusta imágenes remotas: un EPUB offline no debe
// depender de la CDN de Discord ni romperse sin red.
// ============================================================

import Epub from 'epub-gen-memory'
import { ENDPOINTS } from '../discord/endpoints'
import type {
  DiscordAttachment,
  DiscordEmbed,
  DiscordMessage,
  DiscordThread,
  StickerItem
} from '../discord/types'

const MESSAGES_PER_CHAPTER = 250
const YIELD_EVERY = 100
const REPLY_EXCERPT_LIMIT = 140

const EPUB_CSS = `
  body { font-family: serif; line-height: 1.5; color: #1f2328; }
  h1, h2, h3 { margin: 0.7em 0 0.35em 0; line-height: 1.25; }
  .thread-meta { color: #555; font-size: 0.9em; margin-bottom: 1em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.5em; }
  .msg { margin: 0 0 1.1em 0; padding-bottom: 0.65em; border-bottom: 1px solid #e6e6e6; }
  .meta { color: #555; font-size: 0.85em; margin: 0 0 0.3em 0; }
  .reply { border-left: 3px solid #8c959f; padding: 0.25em 0.65em; margin: 0 0 0.45em 0; color: #57606a; font-size: 0.88em; background: #f6f8fa; }
  .msg-body p { margin: 0.25em 0; }
  .att, .sticker { color: #57606a; font-size: 0.82em; font-style: italic; margin: 0.3em 0 0 0; }
  .react { color: #444; font-size: 0.85em; margin: 0.3em 0 0 0; }
  .embed { border-left: 3px solid #5865f2; padding: 0.4em 0.75em; margin: 0.45em 0 0 0; background: #f6f7fb; }
  .embed-author { font-size: 0.85em; font-weight: bold; color: #333; }
  .embed-title { font-weight: bold; margin: 0.15em 0; }
  .embed-desc { margin: 0.2em 0; }
  .embed-fields { margin: 0.25em 0; }
  .embed-field { margin: 0.25em 0; }
  .embed-field-name { font-weight: bold; font-size: 0.88em; }
  .embed-footer { font-size: 0.8em; color: #666; margin-top: 0.3em; }
  .spoiler { background: #eaeef2; color: #24292f; padding: 0.15em 0.4em; border-radius: 3px; }
  .mention { color: #3b49df; font-weight: bold; }
  .ts { background: #eef1f5; padding: 0 0.25em; border-radius: 2px; }
  .subtext { color: #6e7781; font-size: 0.85em; }
  blockquote { border-left: 3px solid #d0d7de; margin: 0.35em 0; padding: 0.15em 0.75em; color: #444; }
  pre { background: #f6f8fa; padding: 0.6em; border: 1px solid #d0d7de; white-space: pre-wrap; font-family: monospace; font-size: 0.85em; }
  code { background: #f0f2f4; padding: 0 0.2em; font-family: monospace; font-size: 0.9em; }
  pre code { background: transparent; padding: 0; }
`

/** Tokenizador en línea en una sola pasada para evitar interferencias entre reglas. */
const INLINE_TOKEN_RE = new RegExp(
  [
    '(```[^`\\n]+```)',
    '(`[^`\\n]+`)',
    '(\\|\\|[^|]+(?:\\|(?!\\|)[^|]*)*\\|\\|)',
    '(\\*\\*\\*[^\\n*]+(?:\\*(?!\\*\\*)[^\\n*]*)*\\*\\*\\*)',
    '(\\*\\*[^\\n*]+(?:\\*(?!\\*)[^\\n*]*)*\\*\\*)',
    '(__[^_\\n]+(?:_(?!_)[^_\\n]*)*__)',
    '(~~[^~\\n]+(?:~(?!~)[^~\\n]*)*~~)',
    '((?<![\\p{L}\\p{N}_])_[^_\\n]+_(?![\\p{L}\\p{N}_]))',
    '(\\*[^*\\n]+\\*)',
    '(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^)\\s]+\\))',
    '(<t:-?\\d+(?::[tTdDfFR])?>)',
    '(<a?:[A-Za-z0-9_~]+:\\d+>)',
    '(<@!?\\d+>)',
    '(<@&\\d+>)',
    '(<#\\d+>)',
    '(https?:\\/\\/[^\\s<>"\'()[\\]]+)'
  ].join('|'),
  'gu'
)

export interface EpubChapter {
  title: string
  content: string
}

/** Elimina caracteres de control no válidos en XML 1.0 y sustitutos UTF-16 huérfanos. */
function sanitizeXmlText(value: string): string {
  if (!value) return ''
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

function escapeHtml(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeHttpUrl(url?: string): url is string {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim())
}

function formatDateTimeEs(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString('es-ES')
  } catch {
    return iso
  }
}

function formatRelativeEs(date: Date): string {
  const diffMs = date.getTime() - Date.now()
  const absSec = Math.round(Math.abs(diffMs) / 1000)
  const future = diffMs > 0
  const wrap = (n: number, unit: string): string => (future ? `en ${n} ${unit}` : `hace ${n} ${unit}`)

  if (absSec < 60) return future ? 'en unos segundos' : 'hace unos segundos'
  const mins = Math.floor(absSec / 60)
  if (mins < 60) return wrap(mins, mins === 1 ? 'minuto' : 'minutos')
  const hours = Math.floor(mins / 60)
  if (hours < 24) return wrap(hours, hours === 1 ? 'hora' : 'horas')
  const days = Math.floor(hours / 24)
  if (days < 30) return wrap(days, days === 1 ? 'día' : 'días')
  const months = Math.floor(days / 30)
  if (months < 12) return wrap(months, months === 1 ? 'mes' : 'meses')
  const years = Math.floor(days / 365)
  return wrap(years, years === 1 ? 'año' : 'años')
}

/** Formatea una marca `<t:unix(:style)?>` de Discord en español legible. */
export function formatDiscordTimestamp(unixSeconds: string, style?: string): string {
  const numeric = Number(unixSeconds)
  const date = new Date(numeric * 1000)
  if (!Number.isFinite(numeric) || Number.isNaN(date.getTime())) {
    return `<t:${unixSeconds}${style ? `:${style}` : ''}>`
  }

  const effectiveStyle = style || 'f'
  if (effectiveStyle === 'R') {
    return formatRelativeEs(date)
  }

  const optionsMap: Record<string, Intl.DateTimeFormatOptions> = {
    t: { hour: '2-digit', minute: '2-digit' },
    T: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    d: { day: '2-digit', month: '2-digit', year: 'numeric' },
    D: { day: 'numeric', month: 'long', year: 'numeric' },
    f: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    F: {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }
  }

  const opts = optionsMap[effectiveStyle] ?? optionsMap.f
  try {
    return new Intl.DateTimeFormat('es-ES', opts).format(date)
  } catch {
    return date.toISOString()
  }
}

function buildMentionLookup(messages: DiscordMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  const register = (user?: { id?: string; username?: string; global_name?: string | null } | null): void => {
    if (!user?.id) return
    const display = user.global_name || user.username
    if (display) map.set(user.id, display)
  }

  for (const msg of messages) {
    register(msg.author)
    if (msg.referenced_message?.author) register(msg.referenced_message.author)
    for (const u of msg.mentions || []) register(u)
  }
  return map
}

function renderInline(
  text: string,
  mentionMap: Map<string, string>,
  assetMap: Map<string, string>
): string {
  if (!text) return ''
  const re = new RegExp(INLINE_TOKEN_RE.source, 'gu')
  const out: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(escapeHtml(text.slice(lastIndex, match.index)))
    }

    const token = match[0]
    if (token.startsWith('```')) {
      out.push(`<code>${escapeHtml(token.slice(3, -3))}</code>`)
    } else if (token.startsWith('`')) {
      out.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`)
    } else if (token.startsWith('||')) {
      const inner = renderInline(token.slice(2, -2), mentionMap, assetMap)
      out.push(`<span class="spoiler">[Spoiler: ${inner}]</span>`)
    } else if (token.startsWith('***')) {
      out.push(`<strong><em>${renderInline(token.slice(3, -3), mentionMap, assetMap)}</em></strong>`)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(`<strong>${renderInline(token.slice(2, -2), mentionMap, assetMap)}</strong>`)
    } else if (token.startsWith('~~')) {
      out.push(`<del>${renderInline(token.slice(2, -2), mentionMap, assetMap)}</del>`)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      out.push(`<em>${renderInline(token.slice(1, -1), mentionMap, assetMap)}</em>`)
    } else if (token.startsWith('[')) {
      const sep = token.indexOf('](')
      const label = token.slice(1, sep)
      const url = token.slice(sep + 2, -1)
      out.push(`<a href="${escapeHtml(url)}">${renderInline(label, mentionMap, assetMap)}</a>`)
    } else if (token.startsWith('<t:')) {
      const parsed = /^<t:(-?\d+)(?::([tTdDfFR]))?>$/.exec(token)
      const formatted = parsed ? formatDiscordTimestamp(parsed[1], parsed[2]) : token
      out.push(`<span class="ts">${escapeHtml(formatted)}</span>`)
    } else if (token.startsWith('<:') || token.startsWith('<a:')) {
      const parts = token.slice(1, -1).split(':')
      const animated = parts[0] === 'a'
      const id = parts[parts.length - 1]
      const name = parts[parts.length - 2] || 'emoji'
      const localPath = assetMap.get(ENDPOINTS.CUSTOM_EMOJI(id, animated))
      const suffix = localPath ? ` (${escapeHtml(localPath)})` : ''
      out.push(`[Emoji: :${escapeHtml(name)}:${suffix}]`)
    } else if (token.startsWith('<@&')) {
      const id = token.slice(3, -1)
      out.push(`<span class="mention">@rol-${escapeHtml(id)}</span>`)
    } else if (token.startsWith('<@')) {
      const id = token.replace(/\D/g, '')
      const name = mentionMap.get(id)
      out.push(`<span class="mention">@${escapeHtml(name || id)}</span>`)
    } else if (token.startsWith('<#')) {
      const id = token.slice(2, -1)
      out.push(`<span class="mention">#canal-${escapeHtml(id)}</span>`)
    } else {
      const clean = token.replace(/[.,;:!?]+$/, '')
      const trailing = token.slice(clean.length)
      out.push(`<a href="${escapeHtml(clean)}">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    out.push(escapeHtml(text.slice(lastIndex)))
  }
  return out.join('')
}

/** Convierte Markdown de Discord en bloques XHTML válidos y escapados (sin HTML crudo). */
function renderMessageBody(
  raw: string,
  mentionMap: Map<string, string>,
  assetMap: Map<string, string>
): string {
  const normalized = sanitizeXmlText(raw).replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return ''

  const lines = normalized.split('\n')
  const blocks: string[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return
    blocks.push(`<p>${paragraphLines.join('<br/>')}</p>`)
    paragraphLines = []
  }

  const flushList = (): void => {
    if (listItems.length === 0) return
    blocks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join('')}</ul>`)
    listItems = []
  }

  const flushText = (): void => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedStart = line.trimStart()
    const trimmed = line.trim()

    // 1. Bloque de código multilínea ```lang\n...\n``` sin interpretar Markdown interno
    if (trimmedStart.startsWith('```') && trimmedStart.indexOf('```', 3) === -1) {
      let closeIndex = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().startsWith('```')) {
          closeIndex = j
          break
        }
      }
      if (closeIndex !== -1) {
        flushText()
        const lang = trimmedStart.slice(3).trim()
        const code = lines.slice(i + 1, closeIndex).join('\n')
        const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
        blocks.push(`<pre><code${langAttr}>${escapeHtml(code)}</code></pre>`)
        i = closeIndex
        continue
      }
    }

    // 2. Cita multilínea >>> hasta el final del mensaje
    if (/^>>>(?:\s|$)/.test(trimmedStart)) {
      flushText()
      const firstLine = trimmedStart.replace(/^>>>\s?/, '')
      const quoteLines = [firstLine, ...lines.slice(i + 1)].map((ln) =>
        renderInline(ln, mentionMap, assetMap)
      )
      blocks.push(`<blockquote><p>${quoteLines.join('<br/>')}</p></blockquote>`)
      break
    }

    // 3. Citas de bloque >
    if (/^>(?:\s|$)/.test(trimmedStart)) {
      flushText()
      const quoteLines: string[] = []
      let j = i
      while (j < lines.length && /^>(?:\s|$)/.test(lines[j].trimStart())) {
        quoteLines.push(renderInline(lines[j].trimStart().replace(/^>\s?/, ''), mentionMap, assetMap))
        j++
      }
      blocks.push(`<blockquote><p>${quoteLines.join('<br/>')}</p></blockquote>`)
      i = j - 1
      continue
    }

    // 4. Encabezados #, ##, ### y subtexto -#
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmedStart)
    if (heading) {
      flushText()
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2], mentionMap, assetMap)}</h${level}>`)
      continue
    }

    const subtext = /^-#\s+(.+)$/.exec(trimmedStart)
    if (subtext) {
      flushText()
      blocks.push(`<p class="subtext">${renderInline(subtext[1], mentionMap, assetMap)}</p>`)
      continue
    }

    // 5. Spoiler en bloque completo (una línea o multilínea ||...||)
    const singleSpoiler = /^\|\|([^|]+(?:\|(?!\|)[^|]*)*)\|\|$/.exec(trimmed)
    if (singleSpoiler) {
      flushText()
      blocks.push(`<div class="spoiler">[Spoiler: ${renderInline(singleSpoiler[1], mentionMap, assetMap)}]</div>`)
      continue
    }

    if (trimmed.startsWith('||') && !trimmed.slice(2).includes('||')) {
      let closeIndex = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trimEnd().endsWith('||')) {
          closeIndex = j
          break
        }
      }
      if (closeIndex !== -1) {
        flushText()
        const spoilerLines = lines.slice(i, closeIndex + 1)
        spoilerLines[0] = spoilerLines[0].trimStart().slice(2)
        const lastIdx = spoilerLines.length - 1
        spoilerLines[lastIdx] = spoilerLines[lastIdx].trimEnd().slice(0, -2)
        const rendered = spoilerLines
          .map((ln) => renderInline(ln, mentionMap, assetMap))
          .join('<br/>')
        blocks.push(`<div class="spoiler">[Spoiler: ${rendered}]</div>`)
        i = closeIndex
        continue
      }
    }

    // 6. Listas simples
    const listItem = /^[-*]\s+(.+)$/.exec(trimmedStart)
    if (listItem) {
      flushParagraph()
      listItems.push(renderInline(listItem[1], mentionMap, assetMap))
      continue
    }

    // 7. Líneas vacías y párrafos
    if (trimmed === '') {
      flushText()
      continue
    }

    flushList()
    paragraphLines.push(renderInline(line, mentionMap, assetMap))
  }

  flushText()
  return blocks.join('')
}

function renderReplyBlock(msg: DiscordMessage): string {
  const ref = msg.referenced_message
  if (!ref) return ''

  const refAuthor = ref.author?.global_name || ref.author?.username || 'autor'
  const compact = sanitizeXmlText(ref.content || '').replace(/\s+/g, ' ').trim()
  let excerpt = compact
  if (!excerpt) {
    excerpt = ref.attachments?.length ? `[${ref.attachments.length} adjunto(s)]` : '(mensaje sin texto)'
  } else if (excerpt.length > REPLY_EXCERPT_LIMIT) {
    excerpt = `${excerpt.slice(0, REPLY_EXCERPT_LIMIT)}...`
  }

  return `<div class="reply">En respuesta a <strong>@${escapeHtml(refAuthor)}</strong>: ${escapeHtml(excerpt)}</div>`
}

function renderEmbedHtml(
  embed: DiscordEmbed,
  mentionMap: Map<string, string>,
  assetMap: Map<string, string>
): string {
  const parts: string[] = []

  if (embed.author?.name) {
    const authorText = isSafeHttpUrl(embed.author.url)
      ? `<a href="${escapeHtml(embed.author.url.trim())}">${escapeHtml(embed.author.name)}</a>`
      : escapeHtml(embed.author.name)
    parts.push(`<div class="embed-author">${authorText}</div>`)
  }

  if (embed.title) {
    const titleHtml = isSafeHttpUrl(embed.url)
      ? `<a href="${escapeHtml(embed.url.trim())}">${escapeHtml(embed.title)}</a>`
      : escapeHtml(embed.title)
    parts.push(`<div class="embed-title">${titleHtml}</div>`)
  } else if (isSafeHttpUrl(embed.url)) {
    const safeUrl = escapeHtml(embed.url.trim())
    parts.push(`<div class="embed-title"><a href="${safeUrl}">${safeUrl}</a></div>`)
  }

  if (embed.description) {
    const descHtml = renderMessageBody(embed.description, mentionMap, assetMap)
    if (descHtml) parts.push(`<div class="embed-desc">${descHtml}</div>`)
  }

  if (embed.fields && embed.fields.length > 0) {
    const fieldsHtml = embed.fields
      .map((field) => {
        const valHtml = renderMessageBody(field.value || '', mentionMap, assetMap) || '<p></p>'
        return `<div class="embed-field"><div class="embed-field-name">${escapeHtml(field.name)}</div><div class="embed-field-val">${valHtml}</div></div>`
      })
      .join('')
    parts.push(`<div class="embed-fields">${fieldsHtml}</div>`)
  }

  for (const mediaUrl of [embed.image?.url, embed.thumbnail?.url]) {
    if (!mediaUrl) continue
    const localPath = assetMap.get(mediaUrl)
    if (localPath) {
      parts.push(`<p class="att">Recurso embebido (local: <code>${escapeHtml(localPath)}</code>)</p>`)
    }
  }

  const footerItems: string[] = []
  if (embed.footer?.text) footerItems.push(embed.footer.text)
  if (embed.timestamp) footerItems.push(formatDateTimeEs(embed.timestamp))
  if (footerItems.length > 0) {
    parts.push(`<div class="embed-footer">${escapeHtml(footerItems.join(' · '))}</div>`)
  }

  if (parts.length === 0) return ''
  return `<div class="embed">${parts.join('')}</div>`
}

function resolveAttachmentLocalPath(att: DiscordAttachment, assetMap: Map<string, string>): string | undefined {
  return assetMap.get(att.url) || (att.proxy_url ? assetMap.get(att.proxy_url) : undefined)
}

function resolveStickerLocalPath(sticker: StickerItem, assetMap: Map<string, string>): string | undefined {
  const primaryExt: 'png' | 'gif' | 'json' =
    sticker.format_type === 4 ? 'gif' : sticker.format_type === 3 ? 'json' : 'png'
  const candidates = [
    ENDPOINTS.STICKER(sticker.id, primaryExt),
    ENDPOINTS.STICKER(sticker.id, 'png'),
    ENDPOINTS.STICKER(sticker.id, 'gif'),
    `https://cdn.discordapp.com/stickers/${sticker.id}.${primaryExt}`,
    `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
    sticker.id,
    `sticker:${sticker.id}`
  ]
  for (const key of candidates) {
    const hit = assetMap.get(key)
    if (hit) return hit
  }
  return undefined
}

function messageToHtml(
  msg: DiscordMessage,
  mentionMap: Map<string, string>,
  assetMap: Map<string, string>
): string {
  const author = escapeHtml(msg.author?.global_name || msg.author?.username || 'Usuario')
  const when = escapeHtml(formatDateTimeEs(msg.timestamp))
  const edited = msg.edited_timestamp ? ' <em>(editado)</em>' : ''

  const replyHtml = renderReplyBlock(msg)
  const bodyHtml = renderMessageBody(msg.content || '', mentionMap, assetMap)
  const embedsHtml = (msg.embeds || [])
    .map((embed) => renderEmbedHtml(embed, mentionMap, assetMap))
    .join('')

  const attachmentsHtml = (msg.attachments || [])
    .map((att) => {
      const localPath = resolveAttachmentLocalPath(att, assetMap)
      const localSuffix = localPath ? ` (local: <code>${escapeHtml(localPath)}</code>)` : ''
      return `<p class="att">Adjunto: ${escapeHtml(att.filename)}${localSuffix}</p>`
    })
    .join('')

  const stickersHtml = (msg.sticker_items || [])
    .map((sticker) => {
      const localPath = resolveStickerLocalPath(sticker, assetMap)
      const localSuffix = localPath ? ` (local: <code>${escapeHtml(localPath)}</code>)` : ''
      return `<p class="sticker">Sticker: ${escapeHtml(sticker.name)}${localSuffix}</p>`
    })
    .join('')

  const reactions = (msg.reactions || [])
    .map((r) => `${r.emoji.name || '?'} ${r.count}`)
    .join(' · ')

  return [
    '<div class="msg">',
    `<p class="meta"><strong>${author}</strong> · ${when}${edited}</p>`,
    replyHtml,
    bodyHtml ? `<div class="msg-body">${bodyHtml}</div>` : '',
    embedsHtml,
    attachmentsHtml,
    stickersHtml,
    reactions ? `<p class="react">${escapeHtml(reactions)}</p>` : '',
    '</div>'
  ].join('')
}

/** Construye los capítulos XHTML del EPUB, partiendo hilos de >250 mensajes y cediendo cada 100. */
export async function buildEpubChapters(
  thread: DiscordThread,
  messages: DiscordMessage[],
  assetMap: Map<string, string> = new Map()
): Promise<EpubChapter[]> {
  const mentionMap = buildMentionLookup(messages)
  const threadTitle = escapeHtml(thread.name || 'Hilo')
  const threadHeader = `<div class="thread-meta"><p><strong>${threadTitle}</strong> · ${messages.length} mensajes</p></div>`

  if (messages.length === 0) {
    return [
      {
        title: 'Conversación',
        content: `${threadHeader}<p><em>Este hilo no contiene mensajes.</em></p>`
      }
    ]
  }

  const totalParts = Math.ceil(messages.length / MESSAGES_PER_CHAPTER)
  const chapters: EpubChapter[] = []
  let processed = 0

  for (let part = 0; part < totalParts; part++) {
    const start = part * MESSAGES_PER_CHAPTER
    const slice = messages.slice(start, start + MESSAGES_PER_CHAPTER)
    const partsHtml: string[] = []

    if (part === 0) {
      partsHtml.push(threadHeader)
    }

    for (const msg of slice) {
      partsHtml.push(messageToHtml(msg, mentionMap, assetMap))
      processed++
      if (processed % YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    chapters.push({
      title: totalParts > 1 ? `Parte ${part + 1}` : 'Conversación',
      content: partsHtml.join('')
    })
  }

  return chapters
}

/** Genera un libro EPUB en memoria compatible con lectura offline. */
export async function buildEpub(
  thread: DiscordThread,
  messages: DiscordMessage[],
  assetMap: Map<string, string> = new Map()
): Promise<Buffer> {
  const chapters = await buildEpubChapters(thread, messages, assetMap)

  const buffer = await Epub(
    {
      title: sanitizeXmlText(thread.name || 'Hilo de Discord'),
      author: sanitizeXmlText(
        messages[0]?.author?.global_name || messages[0]?.author?.username || 'Discord'
      ),
      lang: 'es',
      tocTitle: 'Contenido',
      css: EPUB_CSS
    },
    chapters
  )

  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as unknown as Uint8Array)
}
