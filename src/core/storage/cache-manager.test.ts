import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CachedMessageRecord,
  CachedPostRecord,
  DiscordMessage,
  DiscordThread,
  DiscordUser
} from '../discord/types'

const {
  dbState,
  mockGetCachedPost,
  mockUpsertCachedPost,
  mockUpsertCachedMessage,
  mockUpsertCachedUser,
  mockRunInTransaction
} = vi.hoisted(() => {
  const posts = new Map<string, CachedPostRecord>()
  const messages = new Map<string, CachedMessageRecord>()
  const users = new Map<string, DiscordUser>()

  const state = {
    posts,
    messages,
    users,
    txDepth: 0,
    postUpsertedInTx: [] as boolean[],
    messageUpsertedInTx: [] as boolean[],
    failMessageId: null as string | null
  }

  const mockGetCachedPost = vi.fn((threadId: string) => state.posts.get(threadId) ?? null)

  const mockUpsertCachedPost = vi.fn((post: CachedPostRecord) => {
    state.postUpsertedInTx.push(state.txDepth > 0)
    state.posts.set(post.thread_id, { ...post })
  })

  const mockUpsertCachedMessage = vi.fn((msg: CachedMessageRecord) => {
    state.messageUpsertedInTx.push(state.txDepth > 0)
    if (state.failMessageId && msg.message_id === state.failMessageId) {
      throw new Error(`Simulated DB failure on message ${msg.message_id}`)
    }
    state.messages.set(msg.message_id, { ...msg })
  })

  const mockUpsertCachedUser = vi.fn((user: DiscordUser) => {
    state.users.set(user.id, { ...user })
  })

  const mockRunInTransaction = vi.fn(<T>(cb: () => T): T => {
    const snapPosts = new Map(state.posts)
    const snapMessages = new Map(state.messages)
    const snapUsers = new Map(state.users)
    state.txDepth++
    try {
      return cb()
    } catch (error) {
      state.posts = snapPosts
      state.messages = snapMessages
      state.users = snapUsers
      throw error
    } finally {
      state.txDepth--
    }
  })

  return {
    dbState: state,
    mockGetCachedPost,
    mockUpsertCachedPost,
    mockUpsertCachedMessage,
    mockUpsertCachedUser,
    mockRunInTransaction
  }
})

vi.mock('./database', () => ({
  getCachedPost: mockGetCachedPost,
  upsertCachedPost: mockUpsertCachedPost,
  upsertCachedMessage: mockUpsertCachedMessage,
  upsertCachedUser: mockUpsertCachedUser,
  runInTransaction: mockRunInTransaction
}))

import { CacheManager } from './cache-manager'

function makeUser(id = 'u-1', username = 'alice'): DiscordUser {
  return {
    id,
    username,
    discriminator: '0',
    global_name: 'Alice',
    avatar: null
  }
}

function makeMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: 'm-1',
    channel_id: 'th-1',
    author: makeUser(),
    content: 'Hola mundo',
    timestamp: '2026-11-14T10:00:00.000Z',
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    ...overrides
  }
}

function makeThread(overrides: Partial<DiscordThread> = {}): DiscordThread {
  return {
    id: 'th-1',
    guild_id: 'g-1',
    parent_id: 'c-1',
    owner_id: 'u-1',
    name: 'Hilo de prueba',
    type: 11,
    last_message_id: 'm-1',
    message_count: 1,
    member_count: 2,
    total_message_sent: 1,
    applied_tags: ['tag-1'],
    thread_metadata: {
      archived: false,
      auto_archive_duration: 1440,
      archive_timestamp: '2026-11-14T10:00:00.000Z',
      locked: false
    },
    created_timestamp: '2026-11-14T10:00:00.000Z',
    ...overrides
  }
}

describe('CacheManager', () => {
  beforeEach(() => {
    dbState.posts.clear()
    dbState.messages.clear()
    dbState.users.clear()
    dbState.txDepth = 0
    dbState.postUpsertedInTx = []
    dbState.messageUpsertedInTx = []
    dbState.failMessageId = null
    vi.clearAllMocks()
  })

  it('calcula computeContentHash y computeMessageHash incluyendo reactions y sticker_items', () => {
    const base = makeMessage()
    const emptyExtras = makeMessage({ reactions: [], sticker_items: [] })

    expect(CacheManager.computeMessageHash(base)).toBe(CacheManager.computeMessageHash(emptyExtras))
    expect(CacheManager.computeContentHash([base])).toBe(
      CacheManager.computeContentHash([emptyExtras])
    )

    const withReaction = makeMessage({
      reactions: [{ count: 2, emoji: { id: null, name: '🔥' } }]
    })
    const withMoreReactions = makeMessage({
      reactions: [{ count: 3, emoji: { id: null, name: '🔥' } }]
    })
    const withSticker = makeMessage({
      sticker_items: [{ id: 'st-1', name: 'saludo', format_type: 1 }]
    })
    const withOtherSticker = makeMessage({
      sticker_items: [{ id: 'st-2', name: 'despedida', format_type: 4 }]
    })

    const baseMsgHash = CacheManager.computeMessageHash(base)
    const reactMsgHash = CacheManager.computeMessageHash(withReaction)
    const reactMoreMsgHash = CacheManager.computeMessageHash(withMoreReactions)
    const stickerMsgHash = CacheManager.computeMessageHash(withSticker)
    const otherStickerMsgHash = CacheManager.computeMessageHash(withOtherSticker)

    expect(reactMsgHash).not.toBe(baseMsgHash)
    expect(reactMoreMsgHash).not.toBe(reactMsgHash)
    expect(stickerMsgHash).not.toBe(baseMsgHash)
    expect(otherStickerMsgHash).not.toBe(stickerMsgHash)
    expect(stickerMsgHash).not.toBe(reactMsgHash)

    const baseContentHash = CacheManager.computeContentHash([base])
    expect(CacheManager.computeContentHash([withReaction])).not.toBe(baseContentHash)
    expect(CacheManager.computeContentHash([withMoreReactions])).not.toBe(
      CacheManager.computeContentHash([withReaction])
    )
    expect(CacheManager.computeContentHash([withSticker])).not.toBe(baseContentHash)
    expect(CacheManager.computeContentHash([withOtherSticker])).not.toBe(
      CacheManager.computeContentHash([withSticker])
    )
  })

  it('calcula computeAttachmentHash y computeMetadataHash ante cambios', () => {
    const withoutAtt = makeMessage()
    expect(CacheManager.computeAttachmentHash(withoutAtt)).toBeNull()

    const withAtt = makeMessage({
      attachments: [
        {
          id: 'att-1',
          filename: 'doc.pdf',
          size: 512,
          url: 'https://cdn.example/doc.pdf',
          proxy_url: 'https://media.example/doc.pdf'
        }
      ]
    })
    const attHash = CacheManager.computeAttachmentHash(withAtt)
    expect(attHash).toMatch(/^[a-f0-9]{64}$/)

    const th1 = makeThread()
    const thRenamed = makeThread({ name: 'Otro título' })
    const thLocked = makeThread({
      thread_metadata: { ...th1.thread_metadata, locked: true }
    })
    expect(CacheManager.computeMetadataHash(th1)).not.toBe(CacheManager.computeMetadataHash(thRenamed))
    expect(CacheManager.computeMetadataHash(th1)).not.toBe(CacheManager.computeMetadataHash(thLocked))
  })

  it('evalúa isUpToDate considerando caché, estado, conteo, último mensaje y salida en disco', () => {
    expect(CacheManager.isUpToDate('th-1', 'm-1', 1, true)).toBe(false)

    dbState.posts.set('th-1', {
      thread_id: 'th-1',
      guild_id: 'g-1',
      channel_id: 'c-1',
      title: 'Hilo',
      author_id: 'u-1',
      created_at: '2026-11-14T10:00:00.000Z',
      last_message_id: 'm-10',
      message_count: 5,
      content_hash: 'h1',
      metadata_hash: 'h2',
      first_synced: '2026-11-14T10:00:00.000Z',
      last_synced: '2026-11-14T10:00:00.000Z',
      last_checked: '2026-11-14T10:00:00.000Z',
      sync_status: 'synced',
      download_path: '/tmp/post-1',
      file_count: 0,
      total_size: 100
    })

    expect(CacheManager.isUpToDate('th-1', 'm-10', 5, true)).toBe(true)
    expect(CacheManager.isUpToDate('th-1', 'm-10', 5, false)).toBe(false)
    expect(CacheManager.isUpToDate('th-1', 'm-11', 5, true)).toBe(false)
    expect(CacheManager.isUpToDate('th-1', 'm-10', 6, true)).toBe(false)

    dbState.posts.get('th-1')!.sync_status = 'outdated'
    expect(CacheManager.isUpToDate('th-1', 'm-10', 5, true)).toBe(false)
  })

  it('recordPostSync persiste post, usuarios y mensajes dentro de la misma transacción', () => {
    expect(CacheManager.getPostStatus('th-1')).toBe('not_cached')

    const thread = makeThread({ last_message_id: 'm-2', message_count: 2 })
    const messages = [
      makeMessage({
        id: 'm-1',
        author: makeUser('u-1', 'alice'),
        attachments: [
          {
            id: 'att-1',
            filename: 'foto.png',
            size: 120,
            url: 'https://cdn.example/foto.png',
            proxy_url: 'https://media.example/foto.png'
          }
        ]
      }),
      makeMessage({
        id: 'm-2',
        author: makeUser('u-2', 'bob'),
        embeds: [{ image: { url: 'https://cdn.example/embed.jpg' } }]
      })
    ]

    CacheManager.recordPostSync(thread, messages, '/export/post-1', 1024)

    expect(mockRunInTransaction).toHaveBeenCalledTimes(1)
    expect(dbState.postUpsertedInTx).toEqual([true])
    expect(dbState.messageUpsertedInTx).toEqual([true, true])

    const savedPost = dbState.posts.get('th-1')
    expect(savedPost).toBeDefined()
    expect(savedPost?.file_count).toBe(2)
    expect(savedPost?.total_size).toBe(1024)
    expect(savedPost?.sync_status).toBe('synced')
    expect(CacheManager.getPostStatus('th-1')).toBe('synced')
    expect(dbState.users.size).toBe(2)
    expect(dbState.messages.size).toBe(2)
  })

  it('recordPostSync revierte todo el lote si falla un mensaje dentro de la transacción', () => {
    const thread = makeThread({ last_message_id: 'm-2', message_count: 2 })
    const messages = [
      makeMessage({ id: 'm-1', author: makeUser('u-1', 'alice') }),
      makeMessage({ id: 'm-2', author: makeUser('u-2', 'bob') })
    ]

    dbState.failMessageId = 'm-2'

    expect(() => CacheManager.recordPostSync(thread, messages, '/export/post-1', 500)).toThrow(
      'Simulated DB failure on message m-2'
    )

    // Ningún cambio parcial debe sobrevivir tras el fallo de la transacción
    expect(dbState.posts.get('th-1')).toBeUndefined()
    expect(dbState.messages.size).toBe(0)
    expect(dbState.users.size).toBe(0)
    expect(CacheManager.getPostStatus('th-1')).toBe('not_cached')
  })
})
