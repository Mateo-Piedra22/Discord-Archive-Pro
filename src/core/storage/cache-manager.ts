// ============================================================
// Ultra-Precise Cache Manager — SHA-256 fingerprinting at
// thread, message, content, attachment, and metadata levels.
// Delta sync: only downloads what actually changed.
// ============================================================

import crypto from 'crypto'
import fs from 'fs'
import type {
  DiscordThread,
  DiscordMessage,
  CachedPostRecord,
  CachedMessageRecord
} from '../discord/types'
import {
  getCachedPost,
  getCachedMessages,
  getCachedMessage,
  upsertCachedPost,
  upsertCachedMessage,
  upsertCachedUser,
  updatePostSyncStatus,
  runInTransaction
} from './database'

export type SyncCheckResult = {
  needsSync: boolean
  reason: 'not_cached' | 'new_messages' | 'edited_messages' | 'metadata_changed' | 'up_to_date'
  details: {
    newMessageIds?: string[]
    editedMessageIds?: string[]
    deletedMessageIds?: string[]
    metadataChanged?: boolean
  }
}

export class CacheManager {
  // ----------- Hash Computation -----------

  static computeContentHash(messages: DiscordMessage[]): string {
    const hash = crypto.createHash('sha256')
    for (const msg of messages) {
      hash.update(msg.id)
      hash.update(msg.content || '')
      hash.update(msg.edited_timestamp || '')
      // Include attachment URLs in content hash
      for (const att of msg.attachments) {
        hash.update(att.id)
        hash.update(att.filename)
        hash.update(att.size.toString())
      }
      // Include embed data
      for (const embed of msg.embeds) {
        hash.update(JSON.stringify(embed))
      }
    }
    return hash.digest('hex')
  }

  static computeMessageHash(message: DiscordMessage): string {
    const hash = crypto.createHash('sha256')
    hash.update(message.content || '')
    hash.update(message.edited_timestamp || '')
    if (message.embeds) hash.update(JSON.stringify(message.embeds))
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

  static computeMetadataHash(thread: DiscordThread, reactions?: Record<string, number>): string {
    const hash = crypto.createHash('sha256')
    hash.update(thread.name || '')
    hash.update(JSON.stringify(thread.applied_tags || []))
    hash.update(thread.thread_metadata.locked ? '1' : '0')
    hash.update(thread.thread_metadata.archived ? '1' : '0')
    if (reactions) hash.update(JSON.stringify(reactions))
    return hash.digest('hex')
  }

  static computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  static computeBufferHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex')
  }

  // ----------- Sync Checks -----------

  static quickCheck(threadId: string, currentLastMessageId: string | null, currentMessageCount: number): SyncCheckResult {
    const cached = getCachedPost(threadId)
    if (!cached) {
      return {
        needsSync: true,
        reason: 'not_cached',
        details: {}
      }
    }

    // Check if there are new messages
    if (cached.last_message_id !== currentLastMessageId || cached.message_count !== currentMessageCount) {
      return {
        needsSync: true,
        reason: 'new_messages',
        details: {}
      }
    }

    return {
      needsSync: false,
      reason: 'up_to_date',
      details: {}
    }
  }

  static deepCheck(
    threadId: string,
    currentThread: DiscordThread,
    currentMessages: DiscordMessage[]
  ): SyncCheckResult {
    const cached = getCachedPost(threadId)
    if (!cached) {
      return {
        needsSync: true,
        reason: 'not_cached',
        details: {}
      }
    }

    const cachedMessages = getCachedMessages(threadId)
    const cachedMessageMap = new Map(cachedMessages.map(m => [m.message_id, m]))

    const newMessageIds: string[] = []
    const editedMessageIds: string[] = []
    const currentMessageIds = new Set(currentMessages.map(m => m.id))

    // Find new and edited messages
    for (const msg of currentMessages) {
      const cachedMsg = cachedMessageMap.get(msg.id)
      if (!cachedMsg) {
        newMessageIds.push(msg.id)
      } else {
        const newHash = CacheManager.computeMessageHash(msg)
        if (newHash !== cachedMsg.content_hash) {
          editedMessageIds.push(msg.id)
        }
        // Also check attachment changes
        const newAttHash = CacheManager.computeAttachmentHash(msg)
        if ((newAttHash || '') !== (cachedMsg.attachment_hash || '')) {
          if (!editedMessageIds.includes(msg.id)) {
            editedMessageIds.push(msg.id)
          }
        }
      }
    }

    // Find deleted messages
    const deletedMessageIds = cachedMessages
      .filter(m => !currentMessageIds.has(m.message_id))
      .map(m => m.message_id)

    // Check metadata
    const currentMetaHash = CacheManager.computeMetadataHash(currentThread)
    const metadataChanged = currentMetaHash !== cached.metadata_hash

    if (newMessageIds.length > 0 || editedMessageIds.length > 0 || deletedMessageIds.length > 0 || metadataChanged) {
      let reason: SyncCheckResult['reason'] = 'up_to_date'
      if (newMessageIds.length > 0) reason = 'new_messages'
      else if (editedMessageIds.length > 0) reason = 'edited_messages'
      else if (metadataChanged) reason = 'metadata_changed'

      return {
        needsSync: true,
        reason,
        details: {
          newMessageIds,
          editedMessageIds,
          deletedMessageIds,
          metadataChanged
        }
      }
    }

    return {
      needsSync: false,
      reason: 'up_to_date',
      details: {}
    }
  }

  // ----------- Cache Updates -----------

  static recordPostSync(
    thread: DiscordThread,
    messages: DiscordMessage[],
    downloadPath: string,
    totalSize: number
  ): void {
    const now = new Date().toISOString()
    const contentHash = CacheManager.computeContentHash(messages)
    const metadataHash = CacheManager.computeMetadataHash(thread)

    // Count all files (attachments + embeds with media)
    let fileCount = 0
    for (const msg of messages) {
      fileCount += msg.attachments.length
      for (const embed of msg.embeds) {
        if (embed.image || embed.video || embed.thumbnail) fileCount++
      }
    }

    const existing = getCachedPost(thread.id)
    upsertCachedPost({
      thread_id: thread.id,
      guild_id: thread.guild_id,
      channel_id: thread.parent_id,
      title: thread.name,
      author_id: thread.owner_id,
      created_at: thread.created_timestamp,
      last_message_id: thread.last_message_id || '',
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

    // Record individual messages and users in a transaction
    runInTransaction(() => {
      for (const msg of messages) {
        // Cache the user object so we have the username/avatar for indexing and display
        if (msg.author) {
          upsertCachedUser(msg.author);
        }

        upsertCachedMessage({
          message_id: msg.id,
          thread_id: thread.id,
          author_id: msg.author.id,
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

  static markOutdated(threadId: string): void {
    updatePostSyncStatus(threadId, 'outdated')
  }

  static markDeleted(threadId: string): void {
    updatePostSyncStatus(threadId, 'deleted')
  }

  // ----------- File Integrity Check -----------

  static verifyLocalFile(filePath: string, expectedHash: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false
      const actualHash = CacheManager.computeFileHash(filePath)
      return actualHash === expectedHash
    } catch {
      return false
    }
  }

  static isPostCached(threadId: string): boolean {
    return getCachedPost(threadId) !== null
  }

  static getPostStatus(threadId: string): CachedPostRecord['sync_status'] | 'not_cached' {
    const cached = getCachedPost(threadId)
    return cached ? cached.sync_status as CachedPostRecord['sync_status'] : 'not_cached'
  }
}
