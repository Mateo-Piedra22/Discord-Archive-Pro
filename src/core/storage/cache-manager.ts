// ============================================================
// Gestor de caché — huellas SHA-256 de contenido y metadatos para
// decidir si un hilo necesita reexportarse.
// ============================================================

import crypto from 'crypto'
import type { DiscordThread, DiscordMessage, CachedPostRecord } from '../discord/types'
import {
  getCachedPost,
  upsertCachedPost,
  upsertCachedMessage,
  upsertCachedUser,
  runInTransaction
} from './database'

export class CacheManager {
  // ----------- Huellas -----------

  static computeContentHash(messages: DiscordMessage[]): string {
    const hash = crypto.createHash('sha256')
    for (const msg of messages) {
      hash.update(msg.id)
      hash.update(msg.content || '')
      hash.update(msg.edited_timestamp || '')
      for (const att of msg.attachments) {
        hash.update(att.id)
        hash.update(att.filename)
        hash.update(att.size.toString())
      }
      for (const embed of msg.embeds) {
        hash.update(JSON.stringify(embed))
      }
      if (msg.reactions?.length) {
        hash.update('reactions:')
        hash.update(JSON.stringify(msg.reactions))
      }
      if (msg.sticker_items?.length) {
        hash.update('stickers:')
        hash.update(JSON.stringify(msg.sticker_items))
      }
    }
    return hash.digest('hex')
  }

  static computeMessageHash(message: DiscordMessage): string {
    const hash = crypto.createHash('sha256')
    hash.update(message.content || '')
    hash.update(message.edited_timestamp || '')
    if (message.embeds?.length) hash.update(JSON.stringify(message.embeds))
    if (message.reactions?.length) {
      hash.update('reactions:')
      hash.update(JSON.stringify(message.reactions))
    }
    if (message.sticker_items?.length) {
      hash.update('stickers:')
      hash.update(JSON.stringify(message.sticker_items))
    }
    return hash.digest('hex')
  }

  static computeAttachmentHash(message: DiscordMessage): string | null {
    if (message.attachments.length === 0) return null
    const hash = crypto.createHash('sha256')
    for (const att of message.attachments) {
      hash.update(att.id)
      hash.update(att.filename)
      hash.update(att.size.toString())
    }
    return hash.digest('hex')
  }

  static computeMetadataHash(thread: DiscordThread): string {
    const hash = crypto.createHash('sha256')
    hash.update(thread.name || '')
    hash.update(JSON.stringify(thread.applied_tags || []))
    hash.update(thread.thread_metadata?.locked ? '1' : '0')
    hash.update(thread.thread_metadata?.archived ? '1' : '0')
    return hash.digest('hex')
  }

  // ----------- Estado -----------

  /**
   * ¿El hilo está ya archivado y sin cambios?
   * Compara el último mensaje y el conteo; si además el directorio de
   * salida existe, no hace falta volver a descargar ni reexportar.
   */
  static isUpToDate(
    threadId: string,
    lastMessageId: string | null,
    messageCount: number,
    outputExists: boolean
  ): boolean {
    const cached = getCachedPost(threadId)
    if (!cached || !cached.download_path || !outputExists) return false
    if (cached.sync_status !== 'synced') return false
    return (
      (cached.last_message_id || '') === (lastMessageId || '') &&
      cached.message_count === messageCount
    )
  }

  // ----------- Persistencia ----------

  static recordPostSync(
    thread: DiscordThread,
    messages: DiscordMessage[],
    downloadPath: string,
    totalSize: number
  ): void {
    const now = new Date().toISOString()

    let fileCount = 0
    for (const msg of messages) {
      fileCount += msg.attachments.length
      for (const embed of msg.embeds) {
        if (embed.image || embed.video || embed.thumbnail) fileCount++
      }
    }

    const contentHash = CacheManager.computeContentHash(messages)
    const metadataHash = CacheManager.computeMetadataHash(thread)

    runInTransaction(() => {
      const existing = getCachedPost(thread.id)

      upsertCachedPost({
        thread_id: thread.id,
        guild_id: thread.guild_id,
        channel_id: thread.parent_id,
        title: thread.name,
        author_id: thread.owner_id,
        created_at: thread.created_timestamp,
        last_message_id: thread.last_message_id || messages[messages.length - 1]?.id || '',
        message_count: messages.length,
        content_hash: contentHash,
        metadata_hash: metadataHash,
        first_synced: existing?.first_synced || now,
        last_synced: now,
        last_checked: now,
        sync_status: 'synced',
        download_path: downloadPath,
        file_count: fileCount,
        total_size: totalSize
      })

      for (const msg of messages) {
        if (msg.author) upsertCachedUser(msg.author)
        upsertCachedMessage({
          message_id: msg.id,
          thread_id: thread.id,
          author_id: msg.author?.id || '',
          content_hash: CacheManager.computeMessageHash(msg),
          attachment_hash: CacheManager.computeAttachmentHash(msg),
          edited_at: msg.edited_timestamp,
          created_at: msg.timestamp,
          last_synced: now,
          sync_status: 'synced'
        })
      }
    })
  }

  static getPostStatus(threadId: string): CachedPostRecord['sync_status'] | 'not_cached' {
    const cached = getCachedPost(threadId)
    return cached ? (cached.sync_status as CachedPostRecord['sync_status']) : 'not_cached'
  }
}
