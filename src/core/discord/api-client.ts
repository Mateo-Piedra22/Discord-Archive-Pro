// ============================================================
// Discord API Client — Real REST client using user token.
// Conservative rate limiting, auto-retry, full error handling.
// ============================================================

import { ENDPOINTS } from './endpoints'
import { RateLimiter } from './rate-limiter'
import type {
  DiscordUser,
  DiscordGuild,
  DiscordChannel,
  DiscordMessage,
  DiscordThread,
  DiscordRole,
  ChannelType,
  ThreadSearchResponse,
  ArchivedThreadsResponse,
  ForumTag,
  ForumPost
} from './types'

export class DiscordApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public retryable: boolean = false
  ) {
    super(message)
    this.name = 'DiscordApiError'
  }
}

export class DiscordClient {
  private token: string
  private rateLimiter: RateLimiter
  private userCache = new Map<string, DiscordUser>()
  private roleCache = new Map<string, DiscordRole[]>()
  private channelCache = new Map<string, DiscordChannel>()

  constructor(token: string) {
    this.token = token
    this.rateLimiter = new RateLimiter()
  }

  get limiter(): RateLimiter {
    return this.rateLimiter
  }

  // ----------- Auth & User -----------

  async validateToken(): Promise<DiscordUser> {
    const user = await this.request<DiscordUser>('GET', ENDPOINTS.CURRENT_USER, 'user:me')
    return user
  }

  async getUser(userId: string): Promise<DiscordUser> {
    const cached = this.userCache.get(userId)
    if (cached) return cached
    const user = await this.request<DiscordUser>('GET', ENDPOINTS.USER(userId), `user:${userId}`)
    this.userCache.set(userId, user)
    return user
  }

  // ----------- Guilds -----------

  async getGuilds(): Promise<DiscordGuild[]> {
    const guilds = await this.request<DiscordGuild[]>('GET', ENDPOINTS.GUILDS, 'guilds:list')
    return guilds
  }

  async getGuild(guildId: string): Promise<DiscordGuild> {
    return this.request<DiscordGuild>(
      'GET',
      `${ENDPOINTS.GUILD(guildId)}?with_counts=true`,
      `guild:${guildId}`
    )
  }

  async getGuildRoles(guildId: string): Promise<DiscordRole[]> {
    const cached = this.roleCache.get(guildId)
    if (cached) return cached
    const roles = await this.request<DiscordRole[]>(
      'GET',
      ENDPOINTS.GUILD_ROLES(guildId),
      `roles:${guildId}`
    )
    this.roleCache.set(guildId, roles)
    return roles
  }

  // ----------- Channels -----------

  async getChannels(guildId: string): Promise<DiscordChannel[]> {
    if (guildId === '@me') {
      const channels = await this.request<DiscordChannel[]>('GET', ENDPOINTS.USER_CHANNELS, 'channels:@me')
      for (const ch of channels) this.channelCache.set(ch.id, ch)
      return channels
    }
    const channels = await this.request<DiscordChannel[]>(
      'GET',
      ENDPOINTS.GUILD_CHANNELS(guildId),
      `channels:${guildId}`
    )
    // Cache them
    for (const ch of channels) {
      this.channelCache.set(ch.id, ch)
    }
    return channels
  }

  async getForumChannels(guildId: string): Promise<DiscordChannel[]> {
    const channels = await this.getChannels(guildId)
    if (guildId === '@me') {
      return channels.filter(ch => ch.type === 1 || ch.type === 3)
    }
    return channels.filter(
      ch => ch.type === 15 || ch.type === 16 || ch.type === 0 || ch.type === 5
    )
  }

  async getChannel(channelId: string): Promise<DiscordChannel> {
    const cached = this.channelCache.get(channelId)
    if (cached) return cached
    const channel = await this.request<DiscordChannel>(
      'GET',
      ENDPOINTS.CHANNEL(channelId),
      `channel:${channelId}`
    )
    this.channelCache.set(channelId, channel)
    return channel
  }

  // ----------- Forum Threads (Posts) -----------

  async searchForumThreads(
    channelId: string,
    options: {
      sort_by?: 'last_message_time' | 'creation_time'
      sort_order?: 'desc' | 'asc'
      tag_ids?: string[]
      offset?: number
      limit?: number
      archived?: boolean
    } = {}
  ): Promise<ThreadSearchResponse> {
    const params = new URLSearchParams()
    if (options.sort_by) params.set('sort_by', options.sort_by)
    if (options.sort_order) params.set('sort_order', options.sort_order)
    if (options.tag_ids && options.tag_ids.length > 0) {
      for (const tagId of options.tag_ids) {
        params.append('tag_ids', tagId)
      }
    }
    if (options.offset !== undefined) params.set('offset', options.offset.toString())
    if (options.limit !== undefined) params.set('limit', options.limit.toString())
    if (options.archived !== undefined) params.set('archived', options.archived.toString())

    const url = `${ENDPOINTS.THREAD_SEARCH(channelId)}?${params.toString()}`
    return this.request<ThreadSearchResponse>('GET', url, `threads:search:${channelId}`)
  }

  async getArchivedThreads(
    channelId: string,
    before?: string,
    limit = 25
  ): Promise<ArchivedThreadsResponse> {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    params.set('limit', limit.toString())

    const url = `${ENDPOINTS.ARCHIVED_PUBLIC_THREADS(channelId)}?${params.toString()}`
    return this.request<ArchivedThreadsResponse>('GET', url, `threads:archived:${channelId}`)
  }

  // Enhanced: support a lightweight cancellation token so long-running
  // forum fetches can be aborted from the main process. This keeps the
  // client fully synchronous (no extra threads) while still allowing
  // cooperative cancellation checks between network calls.
  async getAllForumPosts(
    channelId: string,
    onProgress?: (count: number, total: number) => void,
    // cancellation token shape: simple mutable object checked periodically
    cancellationToken?: { cancelled?: boolean }
  ): Promise<ForumPost[]> {
    const channel = await this.getChannel(channelId)

    // Si es un canal de texto estandar, devolvemos un único post que representa el canal completo
    if ([0, 1, 3, 5].includes(channel.type)) {
      if (onProgress) onProgress(1, 1)
      return [{
        thread: {
          id: channel.id,
          guild_id: channel.guild_id || '@me',
          parent_id: channel.parent_id || '',
          owner_id: '',
          name: channel.name || `Chat ${channel.id}`,
          type: channel.type,
          last_message_id: channel.last_message_id || null,
          message_count: channel.message_count || 0,
          member_count: 0,
          total_message_sent: channel.total_message_sent || 0,
          applied_tags: [],
          thread_metadata: {
             archived: false,
             auto_archive_duration: 0,
             archive_timestamp: new Date().toISOString(),
             locked: false
          },
          created_timestamp: new Date().toISOString()
        },
        firstMessage: null,
        tags: [],
        replyCount: 0
      }]
    }

    const tags = channel.available_tags || []
    const tagMap = new Map(tags.map(t => [t.id, t]))

    const allPosts: ForumPost[] = []
    let offset = 0
    const limit = 25
    let total = 0

    // Fetch active threads via search
    while (true) {
      // Cooperative cancellation check: if cancelled, stop cleanly.
      if (cancellationToken && cancellationToken.cancelled) {
        // Throw a specific error so callers can detect cancellation.
        throw new Error('fetch_cancelled')
      }
      const result = await this.searchForumThreads(channelId, {
        sort_by: 'creation_time',
        sort_order: 'desc',
        offset,
        limit
      })

      if (total === 0) total = result.total_results
      if (onProgress) onProgress(allPosts.length, total)

      for (const thread of result.threads) {
        if (cancellationToken && cancellationToken.cancelled) {
          throw new Error('fetch_cancelled')
        }
        const postTags = (thread.applied_tags || [])
          .map(tagId => tagMap.get(tagId))
          .filter((t): t is ForumTag => t !== undefined)

        // first_messages is an array — find by matching channel_id to thread id
        const firstMsg = (result.first_messages || []).find(m => m.channel_id === thread.id) || null

        allPosts.push({
          thread,
          firstMessage: firstMsg,
          tags: postTags,
          replyCount: thread.message_count - 1
        })
      }

      if (!result.has_more || result.threads.length < limit) break
      offset += limit
    }

    if (onProgress) onProgress(allPosts.length, total)
    return allPosts
  }

  // ----------- Messages -----------

  async getThreadMessages(
    threadId: string,
    options: { before?: string; after?: string; limit?: number } = {}
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams()
    if (options.before) params.set('before', options.before)
    if (options.after) params.set('after', options.after)
    params.set('limit', (options.limit || 100).toString())

    const url = `${ENDPOINTS.CHANNEL_MESSAGES(threadId)}?${params.toString()}`
    return this.request<DiscordMessage[]>('GET', url, `messages:${threadId}`)
  }

  async getAllThreadMessages(
    threadId: string,
    onProgress?: (count: number) => void,
    afterId?: string
  ): Promise<DiscordMessage[]> {
    const allMessages: DiscordMessage[] = []
    let before: string | undefined
    let after: string | undefined = afterId

    if (afterId) {
      // Delta Sync: fetching forward
      while (true) {
        const messages = await this.getThreadMessages(threadId, {
          after,
          limit: 100
        })

        if (messages.length === 0) break

        allMessages.push(...messages)
        if (onProgress) onProgress(allMessages.length)

        if (messages.length < 100) break
        // Discord after API returns ascending, so the last is the newest
        after = messages[messages.length - 1].id
      }
    } else {
      // Original full fetch backward
      while (true) {
        const messages = await this.getThreadMessages(threadId, {
          before,
          limit: 100
        })

        if (messages.length === 0) break

        allMessages.push(...messages)
        if (onProgress) onProgress(allMessages.length)

        if (messages.length < 100) break
        before = messages[messages.length - 1].id
      }
    }

    // Sort oldest first
    allMessages.sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime()
      const dateB = new Date(b.timestamp).getTime()
      return dateA - dateB
    })

    return allMessages
  }

  // ----------- Asset Downloads -----------

  async downloadAttachment(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await this.rateLimiter.execute('assets:download', async () => {
      return fetch(url, {
        headers: { 'User-Agent': 'ForoDownloader/1.0' }
      })
    })

    if (!response.ok) {
      throw new DiscordApiError(
        `Failed to download attachment: ${response.status}`,
        response.status,
        undefined,
        response.status >= 500
      )
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    return { buffer, contentType }
  }

  getGuildIconUrl(guildId: string, hash: string | null, size = 128): string | null {
    if (!hash) return null
    return `${ENDPOINTS.GUILD_ICON(guildId, hash)}?size=${size}`
  }

  getUserAvatarUrl(userId: string, hash: string | null, size = 128): string | null {
    if (!hash) return ENDPOINTS.DEFAULT_AVATAR(parseInt(userId) % 5)
    return `${ENDPOINTS.USER_AVATAR(userId, hash)}?size=${size}`
  }

  // ----------- Internal -----------

  private async request<T>(
    method: string,
    url: string,
    route: string,
    body?: unknown
  ): Promise<T> {
    let lastError: Error | null = null
    const maxRetries = 3

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.rateLimiter.execute(route, async () => {
          const headers: Record<string, string> = {
            'Authorization': this.token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }

          const fetchOptions: RequestInit = { method, headers }
          if (body) fetchOptions.body = JSON.stringify(body)

          return fetch(url, fetchOptions)
        })

        if (response.status === 401) {
          throw new DiscordApiError('Invalid or expired token', 401, undefined, false)
        }

        if (response.status === 403) {
          throw new DiscordApiError('Access denied. You may not have permission to view this resource.', 403, undefined, false)
        }

        if (response.status === 404) {
          throw new DiscordApiError('Resource not found', 404, undefined, false)
        }

        if (response.status >= 500) {
          throw new DiscordApiError(`Discord server error: ${response.status}`, response.status, undefined, true)
        }

        if (!response.ok) {
          const errorBody = await response.text()
          throw new DiscordApiError(`HTTP ${response.status}: ${errorBody}`, response.status)
        }

        return await response.json() as T
      } catch (error) {
        lastError = error as Error

        if (error instanceof DiscordApiError && !error.retryable) {
          throw error
        }

        // Exponential backoff for retryable errors
        if (attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000
          await new Promise(resolve => setTimeout(resolve, backoff))
        }
      }
    }

    throw lastError || new Error('Unknown error after retries')
  }

  clearCaches(): void {
    this.userCache.clear()
    this.roleCache.clear()
    this.channelCache.clear()
  }

  destroy(): void {
    this.rateLimiter.clearQueue()
    this.clearCaches()
  }
}
