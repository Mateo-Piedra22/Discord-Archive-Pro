// ============================================================
// Generador de EPUB — libro de solo texto, XHTML escapado.
// No incrusta imágenes remotas: un EPUB "offline" no debe
// depender de la CDN de Discord ni romperse sin red.
// ============================================================

import Epub from 'epub-gen-memory'
import type { DiscordThread, DiscordMessage } from '../discord/types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Markdown mínimo → HTML, siempre sobre texto ya escapado. */
function inlineMarkdown(value: string): string {
  return value
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
}

function messageToHtml(msg: DiscordMessage): string {
  const author = escapeHtml(msg.author.global_name || msg.author.username)
  const when = new Date(msg.timestamp).toLocaleString('es-ES')
  const body = inlineMarkdown(escapeHtml(msg.content || '')).replace(/\n/g, '<br/>')

  const attachments = msg.attachments
    .map((att) => `<p class="att">Adjunto: ${escapeHtml(att.filename)}</p>`)
    .join('')

  const reactions = (msg.reactions || [])
    .map((r) => `${escapeHtml(r.emoji.name || '?')} ${r.count}`)
    .join(' · ')

  return [
    '<div class="msg">',
    `<p class="meta"><strong>${author}</strong> · ${escapeHtml(when)}</p>`,
    body ? `<p>${body}</p>` : '',
    attachments,
    reactions ? `<p class="react">${escapeHtml(reactions)}</p>` : '',
    '</div>'
  ].join('')
}

export async function buildEpub(
  thread: DiscordThread,
  messages: DiscordMessage[],
  _assetMap: Map<string, string>
): Promise<Buffer> {
  const html = `<style>
    .msg { margin: 0 0 1.1em 0; padding-bottom: .6em; border-bottom: 1px solid #e6e6e6; }
    .meta { color: #555; font-size: .85em; margin: 0 0 .25em 0; }
    .att { color: #666; font-size: .8em; font-style: italic; margin: .3em 0 0 0; }
    .react { color: #444; font-size: .85em; margin: .3em 0 0 0; }
    code { background: #f2f2f2; padding: 0 .2em; }
  </style>
  <h1>${escapeHtml(thread.name || 'Hilo')}</h1>
  ${messages.map(messageToHtml).join('')}`

  const buffer = await Epub(
    {
      title: thread.name || 'Hilo de Discord',
      author: messages[0]?.author?.global_name || messages[0]?.author?.username || 'Discord'
    },
    [{ title: 'Conversación', content: html }]
  )

  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as unknown as Uint8Array)
}
