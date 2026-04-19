// ============================================================
// Markdown Generator — Creates perfectly formatted .md files
// with YAML frontmatter, resolved mentions, and relative
// asset paths. Generates post.md and thread.md.
// ============================================================

import fs from 'fs'
import path from 'path'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
import type { DiscordThread, DiscordMessage, DiscordReaction } from '../discord/types'

export class MarkdownGenerator {
  private parser: DiscordMarkdownParser
  private assetMap: Map<string, string> // url -> relative path

  constructor(parser: DiscordMarkdownParser, assetMap: Map<string, string>) {
    this.parser = parser
    this.assetMap = assetMap
  }

  async generatePostMarkdown(
    thread: DiscordThread,
    messages: DiscordMessage[],
    guildName: string,
    channelName: string,
    outputDir: string
  ): Promise<string> {
    const firstMessage = messages[0]
    if (!firstMessage) return ''

    const lines: string[] = []

    // YAML frontmatter
    lines.push('---')
    lines.push(`title: "${this.escapeYaml(thread.name)}"`)
    lines.push(`author: "${this.escapeYaml(firstMessage.author.global_name || firstMessage.author.username)}"`)
    lines.push(`author_id: "${firstMessage.author.id}"`)
    lines.push(`created_at: "${firstMessage.timestamp}"`)
    lines.push(`forum: "${this.escapeYaml(channelName)}"`)
    lines.push(`server: "${this.escapeYaml(guildName)}"`)
    lines.push(`tags: [${(thread.applied_tags || []).map(t => `"${t}"`).join(', ')}]`)

    if (firstMessage.reactions && firstMessage.reactions.length > 0) {
      const reactObj = this.reactionsToObj(firstMessage.reactions)
      lines.push(`reactions: ${JSON.stringify(reactObj)}`)
    }

    lines.push(`reply_count: ${messages.length - 1}`)
    lines.push(`pinned: ${firstMessage.pinned}`)
    lines.push(`locked: ${thread.thread_metadata?.locked || false}`)
    lines.push(`archived: ${thread.thread_metadata?.archived || false}`)
    lines.push(`last_synced: "${new Date().toISOString()}"`)
    lines.push('---')
    lines.push('')

    // Title
    lines.push(`# ${thread.name}`)
    lines.push('')

    // Author info block
    const authorName = firstMessage.author.global_name || firstMessage.author.username
    const dateStr = this.formatDate(firstMessage.timestamp)
    lines.push(`> **Autor:** ${authorName} · **Fecha:** ${dateStr}  `)

    if (thread.applied_tags && thread.applied_tags.length > 0) {
      lines.push(`> **Tags:** ${thread.applied_tags.map(t => `\`${t}\``).join(' · ')}  `)
    }

    if (firstMessage.reactions && firstMessage.reactions.length > 0) {
      const reactStr = this.parser.reactionsToMarkdown(firstMessage.reactions)
      lines.push(`> **Reacciones:** ${reactStr}`)
    }

    lines.push('')
    lines.push('---')
    lines.push('')

    // Post content
    const content = await this.processMessageContent(firstMessage)
    lines.push(content)
    lines.push('')

    // Attachments inline
    for (const att of firstMessage.attachments) {
      const localPath = this.assetMap.get(att.url) || att.url
      if (content.includes(att.url) || content.includes(localPath)) continue

      if (att.content_type?.startsWith('image/')) {
        lines.push(`![${att.filename}](${localPath})`)
      } else {
        lines.push(`[Adjunto: ${att.filename}](${localPath}) (${this.formatSize(att.size)})`)
      }
      lines.push('')
    }

    // Attachments table
    if (firstMessage.attachments.length > 0) {
      lines.push('## Archivos Adjuntos')
      lines.push('')
      lines.push('| Archivo | Tipo | Tamaño |')
      lines.push('|---------|------|--------|')

      for (const att of firstMessage.attachments) {
        const localPath = this.assetMap.get(att.url) || att.url
        const type = this.getFileType(att.content_type || '', att.filename)
        const size = this.formatSize(att.size)
        const icon = this.getFileEmoji(att.filename)
        lines.push(`| ${icon} [${att.filename}](${localPath}) | ${type} | ${size} |`)
      }

      lines.push('')
    }

    // Embeds
    for (const embed of firstMessage.embeds) {
      lines.push(this.parser.embedToMarkdown(embed))
      lines.push('')
    }

    // Footer
    lines.push('---')
    lines.push('')
    lines.push(`*Archivado con Discord Archive Pro — ${this.formatDate(new Date().toISOString())}*`)

    const markdown = lines.join('\n')
    const filePath = path.join(outputDir, 'post.md')
    fs.writeFileSync(filePath, markdown, 'utf-8')
    return filePath
  }

  async generateThreadMarkdown(
    thread: DiscordThread,
    messages: DiscordMessage[],
    guildName: string,
    channelName: string,
    outputDir: string
  ): Promise<string> {
    const lines: string[] = []

    // YAML frontmatter
    lines.push('---')
    lines.push(`title: "${this.escapeYaml(thread.name)}"`)
    lines.push(`type: "full_thread"`)
    lines.push(`total_messages: ${messages.length}`)
    lines.push(`server: "${this.escapeYaml(guildName)}"`)
    lines.push(`forum: "${this.escapeYaml(channelName)}"`)
    lines.push(`last_synced: "${new Date().toISOString()}"`)
    lines.push('---')
    lines.push('')

    lines.push(`# ${thread.name} — Hilo Completo`)
    lines.push('')
    lines.push(`> ${messages.length} mensajes en total`)
    lines.push('')
    lines.push('---')
    lines.push('')

    // All messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const isOP = i === 0

      const authorName = msg.author.global_name || msg.author.username
      const dateStr = this.formatDate(msg.timestamp)
      const editedStr = msg.edited_timestamp ? ` *(editado: ${this.formatDate(msg.edited_timestamp)})*` : ''

      if (isOP) {
        lines.push(`## Post Original — ${authorName}`)
      } else {
        lines.push(`## Respuesta #${i} — ${authorName}`)
      }

      lines.push(`> ${dateStr}${editedStr}`)
      lines.push('')

      const content = await this.processMessageContent(msg)
      lines.push(content)
      lines.push('')

      // Attachments inline
      for (const att of msg.attachments) {
        const localPath = this.assetMap.get(att.url) || att.url
        
        // Skip if this attachment's URL or localPath is already presented in the content
        if (content.includes(att.url) || content.includes(localPath)) {
          continue
        }

        if (att.content_type?.startsWith('image/')) {
          lines.push(`![${att.filename}](${localPath})`)
        } else {
          lines.push(`[Adjunto: ${att.filename}](${localPath}) (${this.formatSize(att.size)})`)
        }
        lines.push('')
      }

      // Embeds
      for (const embed of msg.embeds) {
        lines.push(this.parser.embedToMarkdown(embed))
        lines.push('')
      }

      // Reactions
      if (msg.reactions && msg.reactions.length > 0) {
        lines.push(`> ${this.parser.reactionsToMarkdown(msg.reactions)}`)
        lines.push('')
      }

      // Stickers
      if (msg.sticker_items) {
        for (const sticker of msg.sticker_items) {
          lines.push(this.parser.stickerToMarkdown(sticker))
          lines.push('')
        }
      }

      lines.push('---')
      lines.push('')
    }

    // Footer
    lines.push(`*Hilo completo archivado con Discord Archive Pro — ${this.formatDate(new Date().toISOString())}*`)

    const markdown = lines.join('\n')
    const filePath = path.join(outputDir, 'thread.md')
    fs.writeFileSync(filePath, markdown, 'utf-8')

    // Also generate individual reply files if threadMode is 'separate' or 'both'
    if (messages.length > 1) {
      const repliesDir = path.join(outputDir, 'replies')
      if (!fs.existsSync(repliesDir)) fs.mkdirSync(repliesDir, { recursive: true })

      for (let i = 1; i < messages.length; i++) {
        const msg = messages[i]
        const num = i.toString().padStart(3, '0')
        const authorSafe = (msg.author.username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
        const replyContent = await this.generateReplyMarkdown(msg, i)
        const replyPath = path.join(repliesDir, `${num}_${authorSafe}.md`)
        fs.writeFileSync(replyPath, replyContent, 'utf-8')
      }
    }

    return filePath
  }

  private async generateReplyMarkdown(msg: DiscordMessage, index: number): Promise<string> {
    const lines: string[] = []
    const authorName = msg.author.global_name || msg.author.username

    lines.push('---')
    lines.push(`author: "${this.escapeYaml(authorName)}"`)
    lines.push(`created_at: "${msg.timestamp}"`)
    lines.push(`reply_index: ${index}`)
    lines.push('---')
    lines.push('')
    lines.push(`# Respuesta #${index} — ${authorName}`)
    lines.push('')
    lines.push(`> ${this.formatDate(msg.timestamp)}`)
    lines.push('')

    const content = await this.processMessageContent(msg, true) // true = depth is 1 (replies)
    lines.push(content)

    for (const att of msg.attachments) {
      let localPath = this.assetMap.get(att.url) || att.url
      if (localPath.startsWith('assets/')) {
        localPath = '../' + localPath // Fix for replies subdir
      }

      if (content.includes(att.url) || (this.assetMap.get(att.url) && content.includes(this.assetMap.get(att.url)!))) {
        continue
      }
      if (att.content_type?.startsWith('image/')) {
        lines.push('')
        lines.push(`![${att.filename}](${localPath})`)
      } else {
        lines.push('')
        lines.push(`[Adjunto: ${att.filename}](${localPath}) (${this.formatSize(att.size)})`)
      }
    }

    return lines.join('\n')
  }

  private async processMessageContent(msg: DiscordMessage, isReply: boolean = false): Promise<string> {
    let content = msg.content || ''

    // Parse Discord markdown to standard
    content = await this.parser.parse(content)

    // Replace attachment URLs with local paths
    for (const att of msg.attachments) {
      const originalPath = this.assetMap.get(att.url)
      if (originalPath) {
        const localPath = isReply ? '../' + originalPath : originalPath
        content = content.replace(att.url, localPath)
        content = content.replace(att.proxy_url, localPath)
      }
    }

    // If message is a reply, add reference
    if (msg.referenced_message) {
      const refAuthor = msg.referenced_message.author.global_name || msg.referenced_message.author.username
      const refPreview = (msg.referenced_message.content || '').substring(0, 100)
      content = `> Respondiendo a **${refAuthor}**: ${refPreview}...\n\n${content}`
    }

    return content
  }

  private reactionsToObj(reactions: DiscordReaction[]): Record<string, number> {
    const obj: Record<string, number> = {}
    for (const r of reactions) {
      const key = r.emoji.name || r.emoji.id || '❓'
      obj[key] = r.count
    }
    return obj
  }

  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ')
  }

  private formatDate(isoDate: string): string {
    try {
      const d = new Date(isoDate)
      return d.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return isoDate
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
  }

  private getFileType(mimeType: string, filename: string): string {
    if (mimeType.startsWith('image/')) return 'Imagen'
    if (mimeType.startsWith('video/')) return 'Video'
    if (mimeType.startsWith('audio/')) return 'Audio'
    if (mimeType.includes('pdf')) return 'PDF'
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return 'Archivo'
    if (mimeType.includes('word') || mimeType.includes('excel') || mimeType.includes('powerpoint')) return 'Documento'
    const ext = path.extname(filename).toLowerCase()
    return ext ? ext.substring(1).toUpperCase() : 'Archivo'
  }

  private getFileEmoji(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦'
    if (['doc', 'docx', 'pdf', 'txt', 'rtf'].includes(ext)) return '📄'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return '🎵'
    if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return '🎬'
    if (['exe', 'msi', 'bat', 'sh'].includes(ext)) return '⚙️'
    return '📎'
  }
}
