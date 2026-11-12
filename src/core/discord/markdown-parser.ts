// ============================================================
// Parser de Markdown de Discord — Convierte el markdown propio de
// Discord a markdown estándar resolviendo las menciones.
// ============================================================

import type { DiscordUser, DiscordRole, DiscordEmbed, DiscordReaction, StickerItem } from './types'
import { ENDPOINTS } from './endpoints'

interface ParserContext {
  users: Map<string, DiscordUser>
  roles: Map<string, DiscordRole>
  channels: Map<string, string> // id -> nombre
  resolveUser?: (userId: string) => Promise<DiscordUser | null>
}

export class DiscordMarkdownParser {
  private context: ParserContext

  constructor(context?: Partial<ParserContext>) {
    this.context = {
      users: context?.users || new Map(),
      roles: context?.roles || new Map(),
      channels: context?.channels || new Map(),
      resolveUser: context?.resolveUser
    }
  }

  updateContext(ctx: Partial<ParserContext>): void {
    if (ctx.users) this.context.users = ctx.users
    if (ctx.roles) this.context.roles = ctx.roles
    if (ctx.channels) this.context.channels = ctx.channels
    if (ctx.resolveUser) this.context.resolveUser = ctx.resolveUser
  }

  async parse(content: string, assetMap?: Map<string, string>): Promise<string> {
    if (!content) return ''

    let result = content

    // Resolver menciones de usuario: <@userId> o <@!userId>
    result = await this.resolveMentions(result)

    // Resolver menciones de rol: <@&roleId>
    result = this.resolveRoleMentions(result)

    // Resolver menciones de canal: <#channelId>
    result = this.resolveChannelMentions(result)

    // Resolver marcas de tiempo: <t:timestamp:format>
    result = this.resolveTimestamps(result)

    // Resolver emojis personalizados: <:name:id> o <a:name:id>
    result = this.resolveCustomEmojis(result, assetMap)

    // Conservar el formato específico de Discord
    result = this.convertSpoilers(result)

    return result
  }

  private async resolveMentions(text: string): Promise<string> {
    const mentionRegex = /<@!?(\d+)>/g
    const matches = [...text.matchAll(mentionRegex)]

    for (const match of matches) {
      const userId = match[1]
      let username = `@unknown-user`

      const cached = this.context.users.get(userId)
      if (cached) {
        username = `@${cached.global_name || cached.username}`
      } else if (this.context.resolveUser) {
        try {
          const user = await this.context.resolveUser(userId)
          if (user) {
            this.context.users.set(userId, user)
            username = `@${user.global_name || user.username}`
          }
        } catch {
          // Se deja la mención sin procesar
        }
      }

      text = text.replace(match[0], `**${username}**`)
    }

    return text
  }

  private resolveRoleMentions(text: string): string {
    return text.replace(/<@&(\d+)>/g, (_match, roleId: string) => {
      const role = this.context.roles.get(roleId)
      return role ? `**@${role.name}**` : `**@unknown-role**`
    })
  }

  private resolveChannelMentions(text: string): string {
    return text.replace(/<#(\d+)>/g, (_match, channelId: string) => {
      const name = this.context.channels.get(channelId)
      return name ? `**#${name}**` : `**#unknown-channel**`
    })
  }

  private resolveTimestamps(text: string): string {
    return text.replace(/<t:(\d+)(?::([tTdDfFR]))?>/g, (_match, timestamp: string, format: string) => {
      const date = new Date(parseInt(timestamp) * 1000)
      return this.formatTimestamp(date, format || 'f')
    })
  }

  private formatTimestamp(date: Date, format: string): string {
    const options: Intl.DateTimeFormatOptions = {}

    switch (format) {
      case 't': // Hora corta: 9:41 PM
        options.hour = 'numeric'
        options.minute = '2-digit'
        break
      case 'T': // Hora larga: 9:41:30 PM
        options.hour = 'numeric'
        options.minute = '2-digit'
        options.second = '2-digit'
        break
      case 'd': // Fecha corta: 30/06/2021
        options.day = '2-digit'
        options.month = '2-digit'
        options.year = 'numeric'
        break
      case 'D': // Fecha larga: June 30, 2021
        options.day = 'numeric'
        options.month = 'long'
        options.year = 'numeric'
        break
      case 'f': // Fecha/hora corta: June 30, 2021 9:41 PM
        options.day = 'numeric'
        options.month = 'long'
        options.year = 'numeric'
        options.hour = 'numeric'
        options.minute = '2-digit'
        break
      case 'F': // Fecha/hora larga: Wednesday, June 30, 2021 9:41 PM
        options.weekday = 'long'
        options.day = 'numeric'
        options.month = 'long'
        options.year = 'numeric'
        options.hour = 'numeric'
        options.minute = '2-digit'
        break
      case 'R': // Relativa
        return this.relativeTime(date)
    }

    try {
      return date.toLocaleDateString('es-ES', options)
    } catch {
      return date.toISOString()
    }
  }

  private relativeTime(date: Date): string {
    const now = Date.now()
    const diff = now - date.getTime()
    const absDiff = Math.abs(diff)
    const future = diff < 0

    if (absDiff < 60000) return future ? 'en unos segundos' : 'hace unos segundos'
    if (absDiff < 3600000) {
      const mins = Math.floor(absDiff / 60000)
      return future ? `en ${mins} minutos` : `hace ${mins} minutos`
    }
    if (absDiff < 86400000) {
      const hours = Math.floor(absDiff / 3600000)
      return future ? `en ${hours} horas` : `hace ${hours} horas`
    }
    const days = Math.floor(absDiff / 86400000)
    return future ? `en ${days} días` : `hace ${days} días`
  }

  private resolveCustomEmojis(text: string, assetMap?: Map<string, string>): string {
    // Emoji estático: <:name:id>
    // Emoji animado: <a:name:id>
    return text.replace(/<(a?):(\w+):(\d+)>/g, (_match, animated: string, name: string, id: string) => {
      const url = ENDPOINTS.CUSTOM_EMOJI(id, animated === 'a')
      return `![${name}](${this.resolveAsset(url, assetMap)})`
    })
  }

  private convertSpoilers(text: string): string {
    // Los spoilers de Discord ||texto|| → HTML details para markdown
    return text.replace(/\|\|(.+?)\|\|/gs, (_match, content: string) => {
      return `<details><summary>Spoiler</summary>\n\n${content.trim()}\n\n</details>`
    })
  }

  /** Devuelve la ruta relativa local si el recurso fue descargado; si no, la URL remota. */
  private resolveAsset(url: string, assetMap?: Map<string, string>): string {
    return assetMap?.get(url) || url
  }

  // ----------- Embed a Markdown -----------

  embedToMarkdown(embed: DiscordEmbed, assetMap?: Map<string, string>): string {
    const parts: string[] = []

    parts.push('> ---')

    if (embed.author) {
      const authorLine = embed.author.url
        ? `> **[${embed.author.name}](${embed.author.url})**`
        : `> **${embed.author.name}**`
      parts.push(authorLine)
    }

    if (embed.title) {
      const titleLine = embed.url
        ? `> ### [${embed.title}](${embed.url})`
        : `> ### ${embed.title}`
      parts.push(titleLine)
    }

    if (embed.description) {
      const lines = embed.description.split('\n').map(l => `> ${l}`)
      parts.push(lines.join('\n'))
    }

    if (embed.fields && embed.fields.length > 0) {
      parts.push('>')
      for (const field of embed.fields) {
        parts.push(`> **${field.name}**`)
        parts.push(`> ${field.value}`)
        parts.push('>')
      }
    }

    if (embed.image) {
      parts.push(`> ![embed image](${this.resolveAsset(embed.image.url, assetMap)})`)
    }

    if (embed.thumbnail) {
      parts.push(`> ![thumbnail](${this.resolveAsset(embed.thumbnail.url, assetMap)})`)
    }

    if (embed.footer) {
      const footerLine = embed.timestamp
        ? `> *${embed.footer.text} · ${new Date(embed.timestamp).toLocaleString('es-ES')}*`
        : `> *${embed.footer.text}*`
      parts.push(footerLine)
    } else if (embed.timestamp) {
      parts.push(`> *${new Date(embed.timestamp).toLocaleString('es-ES')}*`)
    }

    parts.push('> ---')

    return parts.join('\n')
  }

  // ----------- Reacciones a Markdown -----------

  reactionsToMarkdown(reactions: DiscordReaction[], assetMap?: Map<string, string>): string {
    if (!reactions || reactions.length === 0) return ''

    const parts = reactions.map(r => {
      const emoji = r.emoji.id
        ? `![${r.emoji.name}](${this.resolveAsset(ENDPOINTS.CUSTOM_EMOJI(r.emoji.id, r.emoji.animated || false), assetMap)})`
        : r.emoji.name || '❓'
      return `${emoji} ${r.count}`
    })

    return parts.join(' · ')
  }

  // ----------- Stickers a Markdown -----------

  stickerToMarkdown(sticker: StickerItem, assetMap?: Map<string, string>): string {
    let ext: 'png' | 'gif' = 'png'
    if (sticker.format_type === 2) ext = 'png' // APNG tratado como PNG
    if (sticker.format_type === 4) ext = 'gif'
    // Lottie (3) es JSON, se omite por ahora
    if (sticker.format_type === 3) {
      return `*[Sticker: ${sticker.name}]*`
    }

    const url = ENDPOINTS.STICKER(sticker.id, ext)
    return `![Sticker: ${sticker.name}](${this.resolveAsset(url, assetMap)})`
  }
}
