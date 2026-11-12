// ============================================================
// Exportador JSON — Exportación JSON estructurada en crudo con
// todos los datos de Discord para uso programático y copia/restauración.
// ============================================================

import fs from 'fs'
import path from 'path'
import type { DiscordThread, DiscordMessage } from '../discord/types'

export class JsonExporter {
  exportThread(
    thread: DiscordThread,
    messages: DiscordMessage[],
    outputDir: string
  ): string {
    const data = {
      _export: {
        tool: 'Estrato',
        version: '1.0.0',
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
      messages: messages.map(msg => ({
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
        attachments: msg.attachments.map(att => ({
          id: att.id,
          filename: att.filename,
          content_type: att.content_type,
          size: att.size,
          url: att.url,
          width: att.width,
          height: att.height
        })),
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
      })),
      statistics: {
        total_messages: messages.length,
        total_attachments: messages.reduce((sum, m) => sum + m.attachments.length, 0),
        total_embeds: messages.reduce((sum, m) => sum + m.embeds.length, 0),
        total_reactions: messages.reduce((sum, m) => sum + (m.reactions?.length || 0), 0),
        unique_authors: new Set(messages.map(m => m.author.id)).size,
        date_range: {
          first: messages[0]?.timestamp,
          last: messages[messages.length - 1]?.timestamp
        }
      }
    }

    const filePath = path.join(outputDir, 'post.json')
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return filePath
  }
}
