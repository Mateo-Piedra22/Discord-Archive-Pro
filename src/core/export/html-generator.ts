// ============================================================
// Generador de HTML — Exportación HTML autocontenida con CSS inline.
// Modo oscuro/claro sin JavaScript (checkbox + label), responsive,
// sin dependencias externas.
// ============================================================

import fs from 'fs'
import path from 'path'
import { ENDPOINTS } from '../discord/endpoints'
import type {
  DiscordEmbed,
  DiscordMessage,
  DiscordReaction,
  DiscordThread,
  StickerItem
} from '../discord/types'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const REPLY_SNIPPET_LIMIT = 90

/** Variables de tema oscuro por defecto; el modo claro las sobreescribe. */
const BASE_CSS = `
    body {
      --bg: #1e1f22;
      --sidebar: #2b2d31;
      --chat: #313338;
      --card: #2b2d31;
      --input: #383a40;
      --text: #dbdee1;
      --text-muted: #949ba4;
      --text-dim: #6d6f78;
      --accent: #5865f2;
      --mention: rgba(88,101,242,0.15);
      --green: #23a559;
      --border: rgba(255,255,255,0.06);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'gg sans', 'Noto Sans', Whitney, 'Helvetica Neue', Helvetica, Roboto, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.375;
      font-size: 16px;
    }
    /* ---- Toggle de tema sin JS: #theme:checked ~ .layout ---- */
    .theme-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .theme-btn {
      position: fixed; bottom: 1rem; right: 1rem;
      background: var(--accent); color: #fff;
      border-radius: 50%; width: 44px; height: 44px;
      font-size: 1.1rem; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      user-select: none; z-index: 50;
    }
    .theme-btn .sun { display: none; }
    .theme-input:checked ~ .theme-btn .sun { display: inline; }
    .theme-input:checked ~ .theme-btn .moon { display: none; }
    .theme-input:focus-visible ~ .theme-btn { outline: 2px solid var(--text); outline-offset: 2px; }
    .layout {
      display: flex; min-height: 100vh; overflow: hidden; height: 100vh;
      background: var(--bg);
    }
    #theme:checked ~ .layout {
      --bg: #f2f3f5;
      --sidebar: #e3e5e8;
      --chat: #ffffff;
      --card: #f2f3f5;
      --input: #e3e5e8;
      --text: #2e3338;
      --text-muted: #4f5660;
      --text-dim: #747f8d;
      --border: rgba(0,0,0,0.1);
    }
    #theme:checked ~ .layout .spoiler { background: #c4c9ce; }
    #theme:checked ~ .layout .spoiler:hover, #theme:checked ~ .layout .spoiler:focus { background: rgba(0,0,0,0.08); }
    .sidebar {
      width: 260px;
      background: var(--sidebar);
      padding: 1rem 0;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .sidebar-header { padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
    .sidebar-title { font-size: 0.938rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
    .sidebar-divider { height: 1px; background: var(--border); margin: 0.5rem 1rem; }
    .sidebar-item { padding: 0.375rem 1rem; font-size: 0.875rem; color: var(--text-muted); cursor: pointer; border-radius: 4px; margin: 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-item:hover { background: rgba(255,255,255,0.04); color: var(--text); }
    .chat { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .chat-header {
      height: 48px;
      background: var(--chat);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 1rem;
      gap: 0.75rem;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .chat-header-icon { color: var(--text-muted); }
    .chat-header-name { font-size: 1rem; font-weight: 600; color: var(--text); }
    .chat-header-meta { font-size: 0.75rem; color: var(--text-muted); margin-left: auto; display: flex; gap: 1rem; }
    .messages {
      flex: 1;
      overflow-y: scroll;
      -webkit-overflow-scrolling: touch;
      padding: 1rem 0;
      background: var(--chat);
    }
    .message-group {
      display: flex;
      padding: 0.125rem 1rem;
      gap: 1rem;
      position: relative;
    }
    .message-group:hover { background: rgba(4,4,5,0.07); }
    .message-group.first-in-group { padding-top: 1rem; margin-top: 0.5rem; }
    .message-group.op .author-name { color: #f0b232; }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 600;
      color: white;
      background: var(--accent);
      overflow: hidden;
      align-self: flex-start;
      margin-top: 2px;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .avatar-spacer { width: 40px; flex-shrink: 0; }
    .message-body { flex: 1; min-width: 0; }
    .message-header-row { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem; }
    .author-name { font-size: 1rem; font-weight: 600; color: var(--text); cursor: pointer; }
    .author-name:hover { text-decoration: underline; }
    .timestamp-label { font-size: 0.75rem; color: var(--text-dim); }
    .message-content { font-size: 1rem; color: var(--text); word-break: break-word; line-height: 1.375; }
    .message-content a { color: var(--accent); text-decoration: none; }
    .message-content a:hover { text-decoration: underline; }
    .message-content code { background: rgba(0,0,0,0.25); padding: 0.2em 0.4em; border-radius: 3px; font-family: Consolas, monospace; font-size: 0.875em; }
    .message-content pre { background: rgba(0,0,0,0.25); padding: 0.75rem; border-radius: 4px; overflow-x: auto; margin: 0.5rem 0; border: 1px solid var(--border); }
    .message-content pre code { background: none; padding: 0; }
    .message-content strong { font-weight: 700; }
    .message-content em { font-style: italic; }
    .message-content del { text-decoration: line-through; }
    .message-content h1 { font-size: 1.375rem; margin: 0.5rem 0 0.25rem; }
    .message-content h2 { font-size: 1.125rem; margin: 0.5rem 0 0.25rem; }
    .message-content h3 { font-size: 1rem; margin: 0.5rem 0 0.25rem; }
    .message-content ul { margin: 0.25rem 0 0.25rem 1.25rem; }
    .message-content li { margin: 0.125rem 0; }
    .attachment-container { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
    .attachment-image { max-width: 400px; max-height: 300px; border-radius: 4px; cursor: pointer; display: block; }
    .attachment-video { max-width: 480px; max-height: 360px; border-radius: 6px; background: #000; display: block; }
    .attachment-audio { width: 100%; max-width: 400px; display: block; }
    .attachment-file {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      max-width: 400px;
    }
    .attachment-file:hover { background: rgba(255,255,255,0.02); text-decoration: none; border-color: var(--accent); }
    .attachment-file-icon { font-size: 1.5rem; flex-shrink: 0; }
    .attachment-file-info { flex: 1; min-width: 0; }
    .attachment-file-name { font-size: 0.875rem; font-weight: 500; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .attachment-file-size { font-size: 0.75rem; color: var(--text-muted); }
    .embed-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-top: 0.5rem;
      max-width: 520px;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .embed-body-row { display: flex; gap: 1rem; align-items: flex-start; }
    .embed-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.375rem; }
    .embed-author { font-size: 0.8125rem; font-weight: 600; color: var(--text); }
    .embed-author a { color: inherit; text-decoration: none; }
    .embed-author a:hover { text-decoration: underline; }
    .embed-title { font-size: 0.9375rem; font-weight: 600; color: var(--text); }
    .embed-title a { color: var(--accent); text-decoration: none; }
    .embed-title a:hover { text-decoration: underline; }
    .embed-description { font-size: 0.875rem; color: var(--text); line-height: 1.375; word-break: break-word; }
    .embed-description a { color: var(--accent); text-decoration: none; }
    .embed-description a:hover { text-decoration: underline; }
    .embed-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem 0.75rem; margin-top: 0.25rem; }
    .embed-field { grid-column: 1 / -1; min-width: 0; }
    .embed-field.embed-field-inline { grid-column: auto; }
    .embed-field-name { font-size: 0.8125rem; font-weight: 600; color: var(--text); margin-bottom: 0.125rem; }
    .embed-field-value { font-size: 0.8125rem; color: var(--text-muted); word-break: break-word; }
    .embed-thumbnail { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .embed-image { max-width: 100%; max-height: 300px; border-radius: 4px; margin-top: 0.25rem; display: block; }
    .embed-footer { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
    .sticker-container { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
    .sticker-image { width: 120px; height: 120px; object-fit: contain; display: block; }
    .sticker-badge {
      display: inline-flex; align-items: center; gap: 0.375rem;
      background: var(--card); border: 1px solid var(--border);
      border-radius: 6px; padding: 0.375rem 0.625rem;
      font-size: 0.8125rem; color: var(--text-muted);
    }
    .spoiler {
      background: rgba(0,0,0,0.45);
      color: transparent;
      border-radius: 3px;
      padding: 0 0.25rem;
      cursor: pointer;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .spoiler:hover, .spoiler:focus {
      color: inherit;
      background: rgba(255,255,255,0.1);
      outline: 1px solid var(--accent);
    }
    .discord-timestamp {
      background: rgba(255,255,255,0.08);
      padding: 0 0.25rem;
      border-radius: 3px;
      font-size: 0.9375em;
    }
    .reactions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.5rem; }
    .reaction { background: rgba(88,101,242,0.1); border: 1px solid rgba(88,101,242,0.3); border-radius: 8px; padding: 0.25rem 0.5rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.375rem; color: var(--text); cursor: default; }
    .reaction-count { color: var(--accent); font-weight: 600; font-size: 0.8125rem; }
    blockquote { border-left: 4px solid var(--border); padding: 0 0.75rem; margin: 0.25rem 0; color: var(--text-muted); }
    .reply-preview { background: transparent; border-left: 2px solid var(--text-dim); padding-left: 0.5rem; margin-bottom: 0.25rem; color: var(--text-muted); font-size: 0.875rem; display: flex; align-items: center; gap: 0.375rem; text-decoration: none; border-radius: 0 4px 4px 0; }
    .reply-preview:hover { color: var(--text); border-left-color: var(--accent); }
    .reply-preview-author { color: var(--text); font-weight: 600; font-size: 0.875rem; }
    .thread-header {
      padding: 1.5rem 1rem 1rem;
      background: var(--chat);
    }
    .thread-header-title { font-size: 1.5rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem; }
    .thread-header-meta { font-size: 0.875rem; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 1rem; }
    .thread-header-divider { height: 1px; background: var(--border); margin: 1rem 0; }
    .footer {
      padding: 0.75rem 1rem;
      background: var(--sidebar);
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--text-dim);
      text-align: center;
    }
    .footer a { color: var(--accent); text-decoration: none; }
    .sidebar-stat { padding: 0.25rem 1rem; font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between; }
    .sidebar-link { display: block; text-decoration: none; }
    @media (max-width: 720px) {
      .sidebar { display: none; }
    }
    @media print {
      .theme-btn, .sidebar { display: none !important; }
      body, .layout, .chat, .messages {
        background: #ffffff !important;
        color: #111827 !important;
        height: auto !important;
        overflow: visible !important;
      }
      .chat-header { position: static !important; border-color: #d1d5db !important; }
      .message-group { break-inside: avoid; page-break-inside: avoid; }
      .spoiler { color: #111827 !important; background: #e5e7eb !important; }
    }`

export class HtmlGenerator {
  private assetMap: Map<string, string>

  constructor(assetMap: Map<string, string>) {
    this.assetMap = assetMap
  }

  async generatePostHtml(
    thread: DiscordThread,
    messages: DiscordMessage[],
    guildName: string,
    channelName: string,
    outputDir: string
  ): Promise<string> {
    const firstMessage = messages[0]
    if (!firstMessage) return ''

    const authorName = firstMessage.author.global_name || firstMessage.author.username
    const dateStr = new Date(firstMessage.timestamp).toLocaleString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    const parts: string[] = []
    const uniqueAuthors = new Set<string>()
    let totalAttachments = 0
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const prev = i > 0 ? messages[i - 1] : null
      const prevTime = prev ? Date.parse(prev.timestamp) : NaN
      const currTime = Date.parse(m.timestamp)
      const withinWindow =
        !Number.isNaN(prevTime) &&
        !Number.isNaN(currTime) &&
        currTime >= prevTime &&
        currTime - prevTime <= GROUP_WINDOW_MS
      const isGrouped =
        prev !== null &&
        prev.author.id === m.author.id &&
        withinWindow &&
        !m.referenced_message

      uniqueAuthors.add(m.author.id)
      totalAttachments += m.attachments.length
      parts.push(this.messageToHtml(m, i === 0, !isGrouped))
      if (i > 0 && i % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const messagesHtml = parts.join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(thread.name)} — Estrato</title>
  <style>${BASE_CSS}
  </style>
</head>
<body>
  <input type="checkbox" id="theme" class="theme-input">
  <label for="theme" class="theme-btn" title="Cambiar tema"><span class="moon">&#9790;</span><span class="sun">&#9728;</span></label>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">${this.escapeHtml(guildName)}</div>
        <div class="sidebar-sub"># ${this.escapeHtml(channelName)}</div>
      </div>
      <div class="sidebar-divider"></div>
      <a class="sidebar-item sidebar-link" href="#top">${this.escapeHtml(thread.name)}</a>
      <a class="sidebar-item sidebar-link" href="#end">Ir al final del hilo</a>
      <div class="sidebar-divider"></div>
      <div class="sidebar-stat"><span>Mensajes</span><strong>${messages.length}</strong></div>
      <div class="sidebar-stat"><span>Participantes</span><strong>${uniqueAuthors.size}</strong></div>
      <div class="sidebar-stat"><span>Adjuntos</span><strong>${totalAttachments}</strong></div>
    </aside>
    <section class="chat">
      <div class="chat-header">
        <span class="chat-header-icon">#</span>
        <span class="chat-header-name">${this.escapeHtml(thread.name)}</span>
        <div class="chat-header-meta">
          <span>${this.escapeHtml(authorName)}</span>
          <span>${dateStr}</span>
          <span>${messages.length} mensajes</span>
        </div>
      </div>
      <div class="messages" id="top">
        <div class="thread-header">
          <div class="thread-header-title">${this.escapeHtml(thread.name)}</div>
          <div class="thread-header-meta">
            <span>Autor: <strong>${this.escapeHtml(authorName)}</strong></span>
            <span>${dateStr}</span>
            <span>Servidor: ${this.escapeHtml(guildName)}</span>
            <span>Canal: ${this.escapeHtml(channelName)}</span>
          </div>
          <div class="thread-header-divider"></div>
        </div>
        ${messagesHtml}
        <div id="end"></div>
      </div>
      <div class="footer">Archivado con <strong>Estrato</strong> &mdash; ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </section>
  </div>
</body>
</html>`

    const filePath = path.join(outputDir, 'post.html')
    await fs.promises.writeFile(filePath, html, 'utf-8')
    return filePath
  }

  private messageToHtml(msg: DiscordMessage, isOP: boolean, isFirstInGroup = true): string {
    const authorName = msg.author.global_name || msg.author.username
    const dateStr = new Date(msg.timestamp).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    const contentHtml = this.renderMarkdown(msg.content || '')
    const replyHtml = this.renderReplyPreviewHtml(msg)
    const attachmentsHtml = this.renderAttachmentsHtml(msg)
    const embedsHtml = (msg.embeds || []).map((embed) => this.renderEmbedHtml(embed)).join('')
    const stickersHtml = this.renderStickersHtml(msg.sticker_items)

    // Reacciones
    let reactionsHtml = ''
    if (msg.reactions && msg.reactions.length > 0) {
      reactionsHtml = '<div class="reactions">'
      for (const r of msg.reactions) {
        reactionsHtml += `<div class="reaction">${this.reactionEmojiHtml(r)} <span class="reaction-count">${r.count}</span></div>`
      }
      reactionsHtml += '</div>'
    }

    const editedBadge = msg.edited_timestamp ? '<span class="timestamp-label">(editado)</span>' : ''
    const groupClasses = ['message-group']
    if (isFirstInGroup) groupClasses.push('first-in-group')
    if (isOP) groupClasses.push('op')

    const avatarOrSpacer = isFirstInGroup ? this.avatarHtml(msg) : '<div class="avatar-spacer"></div>'
    const headerHtml = isFirstInGroup
      ? `<div class="message-header-row">
          <span class="author-name">${this.escapeHtml(authorName)}</span>
          <span class="timestamp-label">${dateStr}</span>
          ${editedBadge}
          ${isOP ? '<span class="timestamp-label" style="color:#f0b232">OP</span>' : ''}
        </div>`
      : ''
    const inlineEdited = !isFirstInGroup && editedBadge
      ? `${contentHtml ? ' ' : ''}${editedBadge}`
      : ''

    return `
    <div class="${groupClasses.join(' ')}" id="msg-${this.escapeHtml(msg.id)}">
      ${avatarOrSpacer}
      <div class="message-body">
        ${replyHtml}
        ${headerHtml}
        <div class="message-content">${contentHtml}${inlineEdited}</div>
        ${attachmentsHtml}
        ${embedsHtml}
        ${stickersHtml}
        ${reactionsHtml}
      </div>
    </div>`
  }

  private renderReplyPreviewHtml(msg: DiscordMessage): string {
    const ref = msg.referenced_message
    if (!ref) return ''

    const refAuthor = ref.author?.global_name || ref.author?.username || 'Usuario'
    const compact = (ref.content || '').replace(/\s+/g, ' ').trim()
    let refSnippet = compact
    if (!refSnippet) {
      refSnippet = ref.attachments?.length ? `[${ref.attachments.length} adjunto(s)]` : '(mensaje sin texto)'
    } else if (refSnippet.length > REPLY_SNIPPET_LIMIT) {
      refSnippet = `${refSnippet.slice(0, REPLY_SNIPPET_LIMIT - 3)}...`
    }

    return `<a class="reply-preview" href="#msg-${this.escapeHtml(ref.id)}"><span class="reply-preview-author">↳ @${this.escapeHtml(refAuthor)}</span> <span>${this.escapeHtml(refSnippet)}</span></a>`
  }

  private renderAttachmentsHtml(msg: DiscordMessage): string {
    if (!msg.attachments || msg.attachments.length === 0) return ''

    const items: string[] = []
    for (const att of msg.attachments) {
      const safePath = this.resolveAssetUrl(att.url, att.proxy_url)
      const ct = (att.content_type || '').toLowerCase()
      const cleanName = (att.filename || '').split('?')[0].toLowerCase()
      const ext = path.extname(cleanName)

      if (ct.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'].includes(ext)) {
        items.push(`<img class="attachment-image" src="${this.escapeHtml(safePath)}" alt="${this.escapeHtml(att.filename)}" loading="lazy">`)
      } else if (ct.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) {
        items.push(`<video class="attachment-video" src="${this.escapeHtml(safePath)}" controls preload="metadata"></video>`)
      } else if (ct.startsWith('audio/') || ['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.opus'].includes(ext)) {
        items.push(`<audio class="attachment-audio" src="${this.escapeHtml(safePath)}" controls preload="metadata"></audio>`)
      } else {
        const sizeStr = att.size ? this.formatSize(att.size) : ''
        const icon = this.getFileIcon(att.filename)
        items.push(`<a class="attachment-file" href="${this.escapeHtml(safePath)}" download="${this.escapeHtml(att.filename)}">
          <span class="attachment-file-icon">${icon}</span>
          <div class="attachment-file-info">
            <div class="attachment-file-name">${this.escapeHtml(att.filename)}</div>
            ${sizeStr ? `<div class="attachment-file-size">${sizeStr}</div>` : ''}
          </div>
        </a>`)
      }
    }

    return `<div class="attachment-container">${items.join('')}</div>`
  }

  private renderEmbedHtml(embed: DiscordEmbed): string {
    const mainParts: string[] = []

    if (embed.author?.name) {
      const authorUrl = this.isSafeHttpUrl(embed.author.url) ? embed.author.url.trim() : null
      const authorContent = authorUrl
        ? `<a href="${this.escapeHtml(authorUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(embed.author.name)}</a>`
        : this.escapeHtml(embed.author.name)
      mainParts.push(`<div class="embed-author">${authorContent}</div>`)
    }

    if (embed.title) {
      const titleUrl = this.isSafeHttpUrl(embed.url) ? embed.url.trim() : null
      const titleContent = titleUrl
        ? `<a href="${this.escapeHtml(titleUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(embed.title)}</a>`
        : this.escapeHtml(embed.title)
      mainParts.push(`<div class="embed-title">${titleContent}</div>`)
    } else if (this.isSafeHttpUrl(embed.url)) {
      const safeUrl = this.escapeHtml(embed.url.trim())
      mainParts.push(`<div class="embed-title"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></div>`)
    }

    if (embed.description) {
      mainParts.push(`<div class="embed-description">${this.renderMarkdown(embed.description)}</div>`)
    }

    if (embed.fields && embed.fields.length > 0) {
      const fieldsHtml = embed.fields
        .map((field) => {
          const cls = field.inline ? 'embed-field embed-field-inline' : 'embed-field'
          return `<div class="${cls}"><div class="embed-field-name">${this.escapeHtml(field.name)}</div><div class="embed-field-value">${this.renderMarkdown(field.value || '')}</div></div>`
        })
        .join('')
      mainParts.push(`<div class="embed-fields">${fieldsHtml}</div>`)
    }

    const thumbSrc = embed.thumbnail?.url
      ? this.resolveAssetUrl(embed.thumbnail.url, embed.thumbnail.proxy_url)
      : ''
    const imgSrc = embed.image?.url
      ? this.resolveAssetUrl(embed.image.url, embed.image.proxy_url)
      : ''

    const footerItems: string[] = []
    if (embed.footer?.text) footerItems.push(embed.footer.text)
    if (embed.timestamp) {
      const d = new Date(embed.timestamp)
      if (!Number.isNaN(d.getTime())) {
        footerItems.push(d.toLocaleString('es-ES', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }))
      }
    }
    const footerHtml = footerItems.length > 0
      ? `<div class="embed-footer">${this.escapeHtml(footerItems.join(' · '))}</div>`
      : ''

    const hasThumb = Boolean(thumbSrc && thumbSrc !== '#')
    const hasImg = Boolean(imgSrc && imgSrc !== '#')
    if (mainParts.length === 0 && !hasThumb && !hasImg && !footerHtml) return ''

    const borderStyle = typeof embed.color === 'number' && embed.color > 0
      ? ` style="border-left-color:#${embed.color.toString(16).padStart(6, '0')}"`
      : ''

    const bodyRow = hasThumb
      ? `<div class="embed-body-row"><div class="embed-main">${mainParts.join('')}</div><img class="embed-thumbnail" src="${this.escapeHtml(thumbSrc)}" alt="" loading="lazy"></div>`
      : mainParts.join('')

    const imageHtml = hasImg
      ? `<img class="embed-image" src="${this.escapeHtml(imgSrc)}" alt="" loading="lazy">`
      : ''

    return `<div class="embed-card"${borderStyle}>${bodyRow}${imageHtml}${footerHtml}</div>`
  }

  private renderStickersHtml(stickers?: StickerItem[]): string {
    if (!stickers || stickers.length === 0) return ''

    const items = stickers.map((sticker) => {
      const localPath = this.resolveStickerLocalPath(sticker)
      if (localPath && sticker.format_type !== 3) {
        const safeSrc = this.sanitizeUrl(localPath)
        if (safeSrc !== '#') {
          return `<img class="sticker-image" src="${this.escapeHtml(safeSrc)}" alt="${this.escapeHtml(sticker.name)}" title="${this.escapeHtml(sticker.name)}" loading="lazy">`
        }
      }
      return `<span class="sticker-badge">Sticker: ${this.escapeHtml(sticker.name)}</span>`
    })

    return `<div class="sticker-container">${items.join('')}</div>`
  }

  private resolveStickerLocalPath(sticker: StickerItem): string | undefined {
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
      const hit = this.assetMap.get(key)
      if (hit) return hit
    }
    return undefined
  }

  private resolveAssetUrl(url?: string, proxyUrl?: string): string {
    const resolved =
      (url ? this.assetMap.get(url) : undefined)
      || (proxyUrl ? this.assetMap.get(proxyUrl) : undefined)
      || url
      || ''
    return this.sanitizeUrl(resolved)
  }

  private isSafeHttpUrl(url?: string): url is string {
    return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim())
  }

  private sanitizeUrl(url: string): string {
    const trimmed = (url || '').trim()
    if (!trimmed) return '#'
    const compact = trimmed.replace(/[\u0000-\u0020]+/g, '')
    if (/^(?:javascript|vbscript|data):/i.test(compact)) return '#'
    return trimmed
  }

  /** Emoji de reacción: local si fue descargado, si no el CDN de Discord. */
  private reactionEmojiHtml(reaction: DiscordReaction): string {
    if (!reaction.emoji.id) return this.escapeHtml(reaction.emoji.name || '')

    const ext = reaction.emoji.animated ? 'gif' : 'png'
    const url = `https://cdn.discordapp.com/emojis/${reaction.emoji.id}.${ext}`
    const src = this.assetMap.get(url) || url
    return `<img src="${this.escapeHtml(this.sanitizeUrl(src))}" alt="" style="width:1.25em;height:1.25em;vertical-align:middle">`
  }

  /** Avatar local si fue descargado; si no, se mantiene la URL del CDN. */
  private avatarHtml(msg: DiscordMessage): string {
    const authorName = msg.author.global_name || msg.author.username
    if (!msg.author.avatar) {
      return `<div class="avatar" style="background:${this.hashColor(msg.author.id)}">${this.escapeHtml(authorName.charAt(0).toUpperCase())}</div>`
    }

    const base = `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png`
    const local = this.assetMap.get(base)
      || this.assetMap.get(`${base}?size=80`)
      || this.assetMap.get(`${base}?size=128`)
    const src = local || `${base}?size=80`

    return `<div class="avatar"><img src="${this.escapeHtml(this.sanitizeUrl(src))}" alt="" loading="lazy"></div>`
  }

  /**
   * Markdown → HTML sobre texto ya escapado. Usa marcadores de posición para que las
   * pasadas no interfieran entre sí (código, enlaces, timestamps) y luego los restaura.
   */
  private renderMarkdown(raw: string): string {
    const store: string[] = []
    const hold = (html: string): string => `\u0000${store.push(html) - 1}\u0000`

    const formatStyles = (segment: string): string => segment
      .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/__([^_\n]+(?:_(?!_)[^_\n]*)*)__/g, '<u>$1</u>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')

    // Énfasis, spoilers, timestamps y enlaces: línea a línea, sobre texto ya escapado
    const inline = (line: string): string => {
      const held = line
        .replace(/&lt;t:(-?\d+)(?::([tTdDfFR]))?&gt;/g, (_m, unix: string, style?: string) =>
          hold(`<span class="discord-timestamp">${this.escapeHtml(this.formatDiscordTimestamp(unix, style))}</span>`))
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) =>
          hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${formatStyles(label)}</a>`))
        .replace(/(^|[\s(|])(https?:\/\/[^\s<)|\u0000]+)/g, (_m, prefix: string, url: string) =>
          `${prefix}${hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`)
      return formatStyles(held)
    }

    let text = this.escapeHtml((raw || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n'))

    // 1. Bloques de código cercados
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) =>
      hold(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`))
    // 2. Código inline
    text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`<code>${code}</code>`))

    // 3. Bloques: encabezados, listas y citas (sin <br> entre etiquetas de bloque)
    const out: string[] = []
    let inList = false
    let inQuote = false
    let quoteLines: string[] = []
    let plainRun = false

    const block = (html: string): void => { plainRun = false; out.push(html) }
    const plain = (html: string): void => {
      if (plainRun) out.push('<br>')
      out.push(html)
      plainRun = true
    }
    const closeList = (): void => { if (inList) { out.push('</ul>'); inList = false } }
    const closeQuote = (): void => {
      if (!inQuote) return
      out.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`)
      quoteLines = []
      inQuote = false
    }

    for (const line of text.split('\n')) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line)
      const item = /^[-*]\s+(.+)$/.exec(line)
      const quote = /^&gt;\s?(.*)$/.exec(line)

      if (heading) {
        closeList(); closeQuote()
        const level = heading[1].length
        block(`<h${level}>${inline(heading[2])}</h${level}>`)
      } else if (item) {
        closeQuote()
        if (!inList) { out.push('<ul>'); inList = true; plainRun = false }
        out.push(`<li>${inline(item[1])}</li>`)
      } else if (quote) {
        closeList()
        inQuote = true
        quoteLines.push(inline(quote[1]))
      } else if (line.trim() === '') {
        // Línea vacía: separa párrafos (dos saltos) sin cerrar el run
        closeList(); closeQuote()
        if (plainRun) out.push('<br>')
      } else {
        closeList(); closeQuote()
        plain(inline(line))
      }
    }
    closeList(); closeQuote()
    text = out.join('')

    // 4. Restaurar marcadores de posición (incluyendo anidados)
    while (/\u0000\d+\u0000/.test(text)) {
      text = text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => store[Number(index)] ?? '')
    }
    return text
  }

  private formatDiscordTimestamp(unixSeconds: string, style?: string): string {
    const numeric = Number(unixSeconds)
    const date = new Date(numeric * 1000)
    if (!Number.isFinite(numeric) || Number.isNaN(date.getTime())) {
      return `<t:${unixSeconds}${style ? `:${style}` : ''}>`
    }

    const effectiveStyle = style || 'f'
    if (effectiveStyle === 'R') {
      return this.formatRelativeEs(date)
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
      return date.toLocaleString('es-ES', opts)
    } catch {
      return date.toISOString()
    }
  }

  private formatRelativeEs(date: Date): string {
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

  private hashColor(id: string): string {
    const colors = ['#5865f2','#eb459e','#3ba55c','#faa61a','#ed4245','#a3b3ce']
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i)
    return colors[Math.abs(hash) % colors.length]
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  private getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return '📦'
    if (['doc', 'docx', 'pdf', 'txt', 'rtf', 'xml'].includes(ext)) return '📄'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
    if (['ppt', 'pptx'].includes(ext)) return '📉'
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return '🎵'
    if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return '🎬'
    if (['exe', 'msi', 'bat', 'sh', 'py', 'js', 'ts', 'cpp', 'c', 'h'].includes(ext)) return '⚙️'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return '🖼️'
    return '📎'
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
