// ============================================================
// HTML Generator — Self-contained HTML export with inline CSS.
// Dark/light mode, responsive, zero external dependencies.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { DiscordThread, DiscordMessage } from '../discord/types'

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
    const dateStr = new Date(firstMessage.timestamp).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    let messagesHtml = ''
    for (let i = 0; i < messages.length; i++) {
      messagesHtml += this.messageToHtml(messages[i], i === 0)
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(thread.name)} — Discord Archive Pro</title>
  <style>
    :root {
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
    .layout { display: flex; min-height: 100vh; overflow: hidden; height: 100vh; }
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
      overflow-y: scroll; /* Force scroll visibility or availability */
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
    .message-content { font-size: 1rem; color: var(--text); white-space: pre-wrap; word-break: break-word; line-height: 1.375; }
    .message-content a { color: var(--accent); text-decoration: none; }
    .message-content a:hover { text-decoration: underline; }
    .message-content code { background: #1e1f22; padding: 0.2em 0.4em; border-radius: 3px; font-family: Consolas, monospace; font-size: 0.875em; }
    .message-content pre { background: #1e1f22; padding: 0.75rem; border-radius: 4px; overflow-x: auto; margin: 0.5rem 0; border: 1px solid var(--border); }
    .message-content pre code { background: none; padding: 0; }
    .message-content strong { font-weight: 700; }
    .message-content em { font-style: italic; }
    .message-content del { text-decoration: line-through; }
    .attachment-container { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
    .attachment-image { max-width: 400px; max-height: 300px; border-radius: 4px; cursor: pointer; display: block; }
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
    .reactions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.5rem; }
    .reaction { background: rgba(88,101,242,0.1); border: 1px solid rgba(88,101,242,0.3); border-radius: 8px; padding: 0.25rem 0.5rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.375rem; color: var(--text); cursor: default; }
    .reaction-count { color: var(--accent); font-weight: 600; font-size: 0.8125rem; }
    blockquote { border-left: 4px solid var(--border); padding: 0 0.75rem; margin: 0.25rem 0; color: var(--text-muted); }
    .reply-preview { background: transparent; border-left: 2px solid var(--text-dim); padding-left: 0.5rem; margin-bottom: 0.25rem; color: var(--text-muted); font-size: 0.875rem; display: flex; align-items: center; gap: 0.375rem; }
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
    .theme-btn { position: fixed; bottom: 1rem; right: 1rem; background: var(--accent); color: white; border: none; border-radius: 50%; width: 44px; height: 44px; font-size: 1.2rem; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
    [data-light] body, body.light { filter: none; }
    @media (prefers-color-scheme: light) { :root { --bg: #f2f3f5; --sidebar: #e3e5e8; --chat: #ffffff; --card: #f2f3f5; --input: #e3e5e8; --text: #2e3338; --text-muted: #4f5660; --text-dim: #747f8d; --border: rgba(0,0,0,0.1); } }
  </style>
</head>
<body>
  <button class="theme-btn" onclick="this.closest('body').classList.toggle('light')" title="Toggle theme">&#9790;</button>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">${this.escapeHtml(guildName)}</div>
        <div class="sidebar-sub"># ${this.escapeHtml(channelName)}</div>
      </div>
      <div class="sidebar-divider"></div>
      <div class="sidebar-item">${this.escapeHtml(thread.name)}</div>
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
      <div class="messages">
        ${messagesHtml}
      </div>
      <div class="footer">Archivado con <strong>Discord Archive Pro</strong> &mdash; ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </section>
  </div>
</body>
</html>`

    const filePath = path.join(outputDir, 'post.html')
    fs.writeFileSync(filePath, html, 'utf-8')
    return filePath
  }

  private messageToHtml(msg: DiscordMessage, isOP: boolean): string {
    const authorName = msg.author.global_name || msg.author.username
    const avatarInitial = authorName.charAt(0).toUpperCase()
    const dateStr = new Date(msg.timestamp).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    const avatarHtml = msg.author.avatar
      ? `<div class="avatar"><img src="https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png?size=80" alt="" loading="lazy"></div>`
      : `<div class="avatar" style="background:${this.hashColor(msg.author.id)}">${avatarInitial}</div>`

    let contentHtml = this.escapeHtml(msg.content || '')
    contentHtml = contentHtml
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')

    // Images inline
    let attachmentsHtml = '<div class="attachment-container">'
    let hasAttachments = false
    for (const att of msg.attachments) {
      const localPath = this.assetMap.get(att.url) || att.url
      if (att.content_type?.startsWith('image/')) {
        attachmentsHtml += `<img class="attachment-image" src="${this.escapeHtml(localPath)}" alt="${this.escapeHtml(att.filename)}" loading="lazy">`
        hasAttachments = true
      } else {
        const sizeStr = att.size ? this.formatSize(att.size) : ''
        const icon = this.getFileIcon(att.filename)
        attachmentsHtml += `<a class="attachment-file" href="${this.escapeHtml(localPath)}" download="${this.escapeHtml(att.filename)}">
          <span class="attachment-file-icon">${icon}</span>
          <div class="attachment-file-info">
            <div class="attachment-file-name">${this.escapeHtml(att.filename)}</div>
            ${sizeStr ? `<div class="attachment-file-size">${sizeStr}</div>` : ''}
          </div>
        </a>`
        hasAttachments = true
      }
    }
    attachmentsHtml += '</div>'
    if (!hasAttachments) attachmentsHtml = ''

    // Reactions
    let reactionsHtml = ''
    if (msg.reactions && msg.reactions.length > 0) {
      reactionsHtml = '<div class="reactions">'
      for (const r of msg.reactions) {
        const emoji = r.emoji.name || ''
        reactionsHtml += `<div class="reaction">${this.escapeHtml(emoji)} <span class="reaction-count">${r.count}</span></div>`
      }
      reactionsHtml += '</div>'
    }

    return `
    <div class="message-group first-in-group${isOP ? ' op' : ''}">
      ${avatarHtml}
      <div class="message-body">
        <div class="message-header-row">
          <span class="author-name">${this.escapeHtml(authorName)}</span>
          <span class="timestamp-label">${dateStr}</span>
          ${isOP ? '<span class="timestamp-label" style="color:#f0b232">OP</span>' : ''}
        </div>
        <div class="message-content">${contentHtml}</div>
        ${attachmentsHtml}
        ${reactionsHtml}
      </div>
    </div>`
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
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
