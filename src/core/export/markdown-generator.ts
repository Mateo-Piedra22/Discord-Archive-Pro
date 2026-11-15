// ============================================================
// Generador de Markdown — Crea archivos .md perfectamente formateados
// con frontmatter YAML, menciones resueltas y rutas de recursos
// relativas. Genera post.md, thread.md y replies/.
// ============================================================

import fs from 'fs'
import path from 'path'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
import type {
  DiscordThread,
  DiscordMessage,
  DiscordReaction,
  ForumTag
} from '../discord/types'

export type ThreadMode = 'single' | 'separate' | 'both'

/** Qué partes del mensaje se escriben en el export. */
export interface ContentSelectionOptions {
  text: boolean
  embeds: boolean
  metadata: boolean
  stickers: boolean
}

const ALL_CONTENT: ContentSelectionOptions = {
  text: true,
  embeds: true,
  metadata: true,
  stickers: true
}

export class MarkdownGenerator {
  private parser: DiscordMarkdownParser
  private assetMap: Map<string, string> // url -> ruta relativa POSIX sin './'
  private threadMode: ThreadMode
  private includeToc: boolean

  constructor(
    parser: DiscordMarkdownParser,
    assetMap: Map<string, string>,
    threadMode: ThreadMode = 'both',
    includeToc: boolean = false
  ) {
    this.parser = parser
    this.assetMap = assetMap
    this.threadMode = threadMode
    this.includeToc = includeToc
  }

  async generatePostMarkdown(
    thread: DiscordThread,
    messages: DiscordMessage[],
    guildName: string,
    channelName: string,
    outputDir: string,
    tags: ForumTag[] = [],
    selection: ContentSelectionOptions = ALL_CONTENT
  ): Promise<string> {
    const firstMessage = messages[0]
    if (!firstMessage) return ''

    const lines: string[] = []
    const tagNames = this.tagNames(thread, tags)

    // Cabecera YAML (frontmatter)
    lines.push('---')
    lines.push(`title: "${this.escapeYaml(thread.name)}"`)
    lines.push(`author: "${this.escapeYaml(firstMessage.author.global_name || firstMessage.author.username)}"`)
    lines.push(`author_id: "${firstMessage.author.id}"`)
    lines.push(`created_at: "${firstMessage.timestamp}"`)
    lines.push(`forum: "${this.escapeYaml(channelName)}"`)
    lines.push(`server: "${this.escapeYaml(guildName)}"`)

    if (selection.metadata) {
      lines.push(`tags: [${tagNames.map(t => `"${this.escapeYaml(t)}"`).join(', ')}]`)

      if (firstMessage.reactions && firstMessage.reactions.length > 0) {
        const reactObj = this.reactionsToObj(firstMessage.reactions)
        lines.push(`reactions: ${JSON.stringify(reactObj)}`)
      }

      lines.push(`reply_count: ${messages.length - 1}`)
    }

    lines.push(`pinned: ${firstMessage.pinned}`)
    lines.push(`locked: ${thread.thread_metadata?.locked || false}`)
    lines.push(`archived: ${thread.thread_metadata?.archived || false}`)
    lines.push(`last_synced: "${new Date().toISOString()}"`)
    lines.push('---')
    lines.push('')

    // Título
    lines.push(`# ${thread.name}`)
    lines.push('')

    // Bloque de información del autor
    const authorName = firstMessage.author.global_name || firstMessage.author.username
    const dateStr = this.formatDate(firstMessage.timestamp)
    lines.push(`> **Autor:** ${authorName} · **Fecha:** ${dateStr}  `)

    if (selection.metadata && tagNames.length > 0) {
      lines.push(`> **Tags:** ${tagNames.map(t => `\`${t}\``).join(' · ')}  `)
    }

    if (selection.metadata && firstMessage.reactions && firstMessage.reactions.length > 0) {
      const reactStr = this.parser.reactionsToMarkdown(firstMessage.reactions, this.assetMap)
      lines.push(`> **Reacciones:** ${reactStr}`)
    }

    lines.push('')
    lines.push('---')
    lines.push('')

    // Contenido del post
    const content = await this.processMessageContent(firstMessage, selection)
    if (content) {
      lines.push(content)
      lines.push('')
    }

    // Adjuntos inline
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

    // Tabla de adjuntos
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
        const escapedFilename = att.filename.replace(/\|/g, '\\|')
        lines.push(`| ${icon} [${escapedFilename}](${localPath}) | ${type} | ${size} |`)
      }

      lines.push('')
    }

    // Embeds
    if (selection.embeds) {
      for (const embed of firstMessage.embeds) {
        lines.push(this.parser.embedToMarkdown(embed, this.assetMap))
        lines.push('')
      }
    }

    // Pie de página
    lines.push('---')
    lines.push('')
    lines.push(`*Archivado con Estrato — ${this.formatDate(new Date().toISOString())}*`)

    const markdown = lines.join('\n')
    const filePath = path.join(outputDir, 'post.md')
    await fs.promises.writeFile(filePath, markdown, 'utf-8')
    return filePath
  }

  async generateThreadMarkdown(
    thread: DiscordThread,
    messages: DiscordMessage[],
    guildName: string,
    channelName: string,
    outputDir: string,
    tags: ForumTag[] = [],
    selection: ContentSelectionOptions = ALL_CONTENT
  ): Promise<string> {
    const writesThread = this.threadMode !== 'separate'
    const writesReplies = this.threadMode !== 'single'

    let threadPath = ''

    if (writesThread) {
      const lines: string[] = []
      const tagNames = this.tagNames(thread, tags)

      // Cabecera YAML (frontmatter)
      lines.push('---')
      lines.push(`title: "${this.escapeYaml(thread.name)}"`)
      lines.push(`type: "full_thread"`)
      lines.push(`total_messages: ${messages.length}`)
      lines.push(`server: "${this.escapeYaml(guildName)}"`)
      lines.push(`forum: "${this.escapeYaml(channelName)}"`)
      if (selection.metadata) {
        lines.push(`tags: [${tagNames.map(t => `"${this.escapeYaml(t)}"`).join(', ')}]`)
      }
      lines.push(`last_synced: "${new Date().toISOString()}"`)
      lines.push('---')
      lines.push('')

      lines.push(`# ${thread.name} — Hilo Completo`)
      lines.push('')
      lines.push(`> ${messages.length} mensajes en total`)
      lines.push('')
      lines.push('---')
      lines.push('')

      if (this.includeToc && messages.length > 1) {
        lines.push('## Tabla de Contenidos')
        lines.push('')
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          const authorName = msg.author.global_name || msg.author.username
          if (i === 0) {
            lines.push(`- [Post Original — ${authorName}](#post-original)`)
          } else {
            lines.push(`- [Respuesta #${i} — ${authorName}](#respuesta-${i})`)
          }
        }
        lines.push('')
        lines.push('---')
        lines.push('')
      }

      // Todos los mensajes
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const isOP = i === 0

        const authorName = msg.author.global_name || msg.author.username
        const dateStr = this.formatDate(msg.timestamp)
        const editedStr = msg.edited_timestamp
          ? ` *(editado: ${this.formatDate(msg.edited_timestamp)})*`
          : ''

        if (isOP) {
          lines.push(`## Post Original — ${authorName}`)
        } else {
          lines.push(`## Respuesta #${i} — ${authorName}`)
        }

        lines.push(`> ${dateStr}${editedStr}`)
        lines.push('')

        const content = await this.processMessageContent(msg, selection)
        if (content) {
          lines.push(content)
          lines.push('')
        }

        // Adjuntos inline
        for (const att of msg.attachments) {
          const localPath = this.assetMap.get(att.url) || att.url

          // Se omite si la URL de este adjunto o su localPath ya aparecen en el contenido
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
        if (selection.embeds) {
          for (const embed of msg.embeds) {
            lines.push(this.parser.embedToMarkdown(embed, this.assetMap))
            lines.push('')
          }
        }

        // Reacciones
        if (selection.metadata && msg.reactions && msg.reactions.length > 0) {
          lines.push(`> ${this.parser.reactionsToMarkdown(msg.reactions, this.assetMap)}`)
          lines.push('')
        }

        // Stickers
        if (selection.stickers && msg.sticker_items) {
          for (const sticker of msg.sticker_items) {
            lines.push(this.parser.stickerToMarkdown(sticker, this.assetMap))
            lines.push('')
          }
        }

        lines.push('---')
        lines.push('')

        if (i > 0 && i % 100 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
      }

      // Pie de página
      lines.push(`*Hilo completo archivado con Estrato — ${this.formatDate(new Date().toISOString())}*`)

      threadPath = path.join(outputDir, 'thread.md')
      await fs.promises.writeFile(threadPath, lines.join('\n'), 'utf-8')
    }

    // Archivos de respuesta individuales
    if (writesReplies && messages.length > 1) {
      const repliesDir = path.join(outputDir, 'replies')
      await this.writeReplies(messages, repliesDir, selection)
    }

    if (threadPath) return threadPath
    if (writesReplies) return path.join(outputDir, 'replies')
    return ''
  }

  private async writeReplies(
    messages: DiscordMessage[],
    repliesDir: string,
    selection: ContentSelectionOptions
  ): Promise<void> {
    await fs.promises.mkdir(repliesDir, { recursive: true })

    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i]
      const num = i.toString().padStart(3, '0')
      const authorSafe = (msg.author.username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
      const replyContent = await this.generateReplyMarkdown(msg, i, selection)
      const replyPath = path.join(repliesDir, `${num}_${authorSafe}.md`)
      await fs.promises.writeFile(replyPath, replyContent, 'utf-8')

      if (i % 50 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  private async generateReplyMarkdown(
    msg: DiscordMessage,
    index: number,
    selection: ContentSelectionOptions
  ): Promise<string> {
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

    // Este archivo vive en replies/, así que todo asset sube un nivel
    const content = this.prefixRelative(await this.processMessageContent(msg, selection))
    if (content) lines.push(content)

    for (const att of msg.attachments) {
      const rel = this.assetMap.get(att.url)
      // Ya presente en el cuerpo (como URL original o como ruta relativa)?
      if (content.includes(att.url)) continue
      if (rel && (content.includes(rel) || content.includes(this.prefixRelativePath(rel)))) continue

      const localPath = rel ? this.prefixRelativePath(rel) : att.url

      lines.push('')
      if (att.content_type?.startsWith('image/')) {
        lines.push(`![${att.filename}](${localPath})`)
      } else {
        lines.push(`[Adjunto: ${att.filename}](${localPath}) (${this.formatSize(att.size)})`)
      }
    }

    // Embeds
    if (selection.embeds && msg.embeds) {
      for (const embed of msg.embeds) {
        lines.push('')
        lines.push(this.prefixRelative(this.parser.embedToMarkdown(embed, this.assetMap)))
      }
    }

    // Reacciones
    if (selection.metadata && msg.reactions && msg.reactions.length > 0) {
      lines.push('')
      lines.push(`> ${this.prefixRelative(this.parser.reactionsToMarkdown(msg.reactions, this.assetMap))}`)
    }

    // Stickers
    if (selection.stickers && msg.sticker_items) {
      for (const sticker of msg.sticker_items) {
        lines.push('')
        lines.push(this.prefixRelative(this.parser.stickerToMarkdown(sticker, this.assetMap)))
      }
    }

    return lines.join('\n')
  }

  private async processMessageContent(
    msg: DiscordMessage,
    selection: ContentSelectionOptions
  ): Promise<string> {
    if (!selection.text) return ''

    let content = msg.content || ''

    // Convierte el markdown de Discord a estándar
    content = await this.parser.parse(content, this.assetMap)

    // Sustituye las URLs de adjuntos por rutas locales
    for (const att of msg.attachments) {
      const localPath = this.assetMap.get(att.url)
      if (localPath) {
        content = content.split(att.url).join(localPath)
        content = content.split(att.proxy_url).join(localPath)
      }
    }

    // Si el mensaje es una respuesta, añade la referencia
    if (msg.referenced_message) {
      const refAuthor = msg.referenced_message.author.global_name || msg.referenced_message.author.username
      const refPreview = (msg.referenced_message.content || '').substring(0, 100)
      content = `> Respondiendo a **${refAuthor}**: ${refPreview}...\n\n${content}`
    }

    return content
  }

  /** Añade `../` a los enlaces relativos `assets/...` (archivos dentro de replies/). */
  private prefixRelative(markdown: string): string {
    return markdown.replace(/\]\(assets\//g, '](../assets/')
  }

  /** Ruta del recurso relativa a replies/: `assets/x` → `../assets/x`. */
  private prefixRelativePath(rel: string): string {
    return rel.startsWith('assets/') ? `../${rel}` : rel
  }

  private tagNames(thread: DiscordThread, tags: ForumTag[]): string[] {
    if (!tags || tags.length === 0) return []
    const byId = new Map(tags.map(t => [t.id, t.name]))
    return (thread.applied_tags || []).map(id => byId.get(id) || id)
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
    return (str || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .trim()
  }

  private formatDate(isoDate: string): string {
    try {
      const d = new Date(isoDate)
      if (Number.isNaN(d.getTime())) return isoDate
      return d.toLocaleString('es-ES', {
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
