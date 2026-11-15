// ============================================================
// Exportador JSON — Exportación JSON estructurada en crudo con
// todos los datos de Discord para uso programático y copia/restauración.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { DiscordThread, DiscordMessage } from '../discord/types'

/**
 * Neutraliza fórmulas CSV/DDE para evitar ejecución en hojas de cálculo.
 * Prefija `'` si la celda comienza con `=`, `+`, `@`, `\t`, o `-` no seguido de dígito.
 */
export function sanitizeCsvFormula(val: string): string {
  if (!val) return val
  return /^(?:[=+@\t]|-(?!\d))/.test(val) ? `'${val}` : val
}

export class JsonExporter {
  async exportThread(
    thread: DiscordThread,
    messages: DiscordMessage[],
    outputDir: string,
    assetMap?: Map<string, string>
  ): Promise<string> {
    const mappedMessages: unknown[] = []
    let totalAttachments = 0
    let totalEmbeds = 0
    let totalReactions = 0
    const authors = new Set<string>()

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      totalAttachments += msg.attachments.length
      totalEmbeds += msg.embeds.length
      totalReactions += msg.reactions?.length || 0
      authors.add(msg.author.id)

      mappedMessages.push({
        id: msg.id,
        author: {
          id: msg.author.id,
          username: msg.author.username,
          global_name: msg.author.global_name,
          avatar: msg.author.avatar
        },
        content: msg.content,
        timestamp: msg.timestamp,
        edited_timestamp: msg.edited_timestamp,
        pinned: msg.pinned,
        type: msg.type,
        attachments: msg.attachments.map(att => {
          const localPath =
            assetMap?.get(att.url) ?? (att.proxy_url ? assetMap?.get(att.proxy_url) : undefined)
          return {
            id: att.id,
            filename: att.filename,
            content_type: att.content_type,
            size: att.size,
            url: att.url,
            ...(localPath ? { local_path: localPath } : {}),
            width: att.width,
            height: att.height
          }
        }),
        embeds: msg.embeds,
        reactions: msg.reactions?.map(r => ({
          emoji: {
            name: r.emoji.name,
            id: r.emoji.id,
            animated: r.emoji.animated
          },
          count: r.count
        })) || [],
        sticker_items: msg.sticker_items || [],
        referenced_message_id: msg.referenced_message?.id || null,
        mentions: (msg.mentions ?? []).map(u => ({
          id: u.id,
          username: u.username
        }))
      })

      if (i > 0 && i % 250 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    const data = {
      _export: {
        tool: 'Estrato',
        version: '2.2.0',
        exported_at: new Date().toISOString(),
        format_version: 1
      },
      thread: {
        id: thread.id,
        guild_id: thread.guild_id,
        channel_id: thread.parent_id,
        name: thread.name,
        owner_id: thread.owner_id,
        created_at: thread.created_timestamp,
        message_count: thread.message_count,
        applied_tags: thread.applied_tags,
        metadata: {
          archived: thread.thread_metadata?.archived || false,
          locked: thread.thread_metadata?.locked || false,
          auto_archive_duration: thread.thread_metadata?.auto_archive_duration
        }
      },
      messages: mappedMessages,
      statistics: {
        total_messages: messages.length,
        total_attachments: totalAttachments,
        total_embeds: totalEmbeds,
        total_reactions: totalReactions,
        unique_authors: authors.size,
        date_range: {
          first: messages[0]?.timestamp,
          last: messages[messages.length - 1]?.timestamp
        }
      }
    }

    const filePath = path.join(outputDir, 'post.json')
    let serialized: string
    try {
      serialized = JSON.stringify(data, null, 2)
    } catch {
      // Fallback compacto si un hilo gigante supera el límite con indentación.
      serialized = JSON.stringify(data)
    }
    await fs.promises.writeFile(filePath, serialized, 'utf-8')
    return filePath
  }

  async exportCsv(
    thread: DiscordThread,
    messages: DiscordMessage[],
    outputDir: string
  ): Promise<string> {
    const csvCell = (val: string | number | boolean | null | undefined): string => {
      const s = val === null || val === undefined ? '' : String(val)
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const rows: string[] = [
      'message_id,thread_id,timestamp,author_id,author_name,content,attachments,reactions'
    ]
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const author = msg.author.global_name || msg.author.username
      const attCount = msg.attachments.length
      const reactCount = msg.reactions?.reduce((sum, r) => sum + r.count, 0) || 0
      rows.push([
        csvCell(msg.id),
        csvCell(thread.id),
        csvCell(msg.timestamp),
        csvCell(msg.author.id),
        csvCell(sanitizeCsvFormula(author)),
        csvCell(sanitizeCsvFormula(msg.content || '')),
        csvCell(attCount),
        csvCell(reactCount)
      ].join(','))

      if (i > 0 && i % 250 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }

    const csvContent = '\uFEFF' + rows.join('\r\n')
    const filePath = path.join(outputDir, 'messages.csv')
    await fs.promises.writeFile(filePath, csvContent, 'utf-8')
    await fs.promises.writeFile(path.join(outputDir, 'post.csv'), csvContent, 'utf-8')
    return filePath
  }
}
