// ============================================================
// Discord API Client — Cliente REST real usando el token de usuario.
// Rate limiting conservador, reintento automático, manejo completo de errores.
// ============================================================

import { ENDPOINTS } from './endpoints'
import { LruCache } from './lru-cache'
import { RateLimiter } from './rate-limiter'
import { isForum, isMessageCapable } from './types'
import type {
  DiscordUser,
  DiscordGuild,
  DiscordChannel,
  DiscordMessage,
  ForumTag,
  ForumPost,
  ThreadSearchResponse
} from './types'

export function compareSnowflakes(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const ba = BigInt(a)
    const bb = BigInt(b)
    return ba < bb ? -1 : ba > bb ? 1 : 0
  }
  return a.localeCompare(b)
}

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
  private userCache = new LruCache<string, DiscordUser>(5000)
  private channelCache = new LruCache<string, DiscordChannel>(2000)
  private guildCache = new LruCache<string, DiscordGuild>(500)

  constructor(token: string) {
    this.token = token
    this.rateLimiter = new RateLimiter()
  }

  get limiter(): RateLimiter {
    return this.rateLimiter
  }

  getCacheStats(): {
    users: number
    maxUsers: number
    channels: number
    maxChannels: number
    guilds: number
    maxGuilds: number
  } {
    return {
      users: this.userCache.size,
      maxUsers: this.userCache.capacity,
      channels: this.channelCache.size,
      maxChannels: this.channelCache.capacity,
      guilds: this.guildCache.size,
      maxGuilds: this.guildCache.capacity
    }
  }

  clearCaches(): void {
    this.userCache.clear()
    this.channelCache.clear()
    this.guildCache.clear()
  }

  // ----------- Autenticación y usuario -----------

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

  // ----------- Servidores -----------

  async getGuilds(): Promise<DiscordGuild[]> {
    const guilds = await this.request<DiscordGuild[]>('GET', ENDPOINTS.GUILDS, 'guilds:list')
    for (const guild of guilds) {
      this.guildCache.set(guild.id, guild)
    }
    return guilds
  }

  async getGuild(guildId: string): Promise<DiscordGuild> {
    const cached = this.guildCache.get(guildId)
    if (cached) return cached
    const guild = await this.request<DiscordGuild>(
      'GET',
      `${ENDPOINTS.GUILD(guildId)}?with_counts=true`,
      `guild:${guildId}`
    )
    this.guildCache.set(guildId, guild)
    return guild
  }

  // ----------- Canales -----------

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
    for (const ch of channels) {
      this.channelCache.set(ch.id, ch)
    }
    return channels
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

  // ----------- Hilos de foro (posts) -----------

  async searchForumThreads(
    channelId: string,
    options: {
      sort_by?: 'last_message_time' | 'creation_time'
      sort_order?: 'desc' | 'asc'
      tag_ids?: string[]
      offset?: number
      limit?: number
      archived?: boolean
      signal?: AbortSignal
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
    return this.request<ThreadSearchResponse>(
      'GET',
      url,
      `threads:search:${channelId}`,
      undefined,
      options.signal
    )
  }

  // Ampliado: admite un token de cancelación ligero para poder abortar
  // desde el proceso principal las descargas de foro de larga duración.
  // Así el cliente sigue siendo totalmente síncrono (sin hilos extra) pero
  // permite comprobaciones cooperativas de cancelación entre llamadas de red.
  async getAllForumPosts(
    channelId: string,
    onProgress?: (count: number, total: number) => void,
    // forma del token de cancelación: objeto mutable simple o AbortSignal comprobado periódicamente
    cancellationToken?: { cancelled?: boolean; signal?: AbortSignal }
  ): Promise<ForumPost[]> {
    if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
      throw new Error('fetch_cancelled')
    }

    const channel = await this.getChannel(channelId)

    if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
      throw new Error('fetch_cancelled')
    }

    // Foros y canales de media: se navegan como lista de posts (threads).
    if (isForum(channel.type)) {
      return this.searchAllForumPosts(channel, onProgress, cancellationToken)
    }

    // Canal de texto/DM: un único "post" que representa el canal completo.
    // OJO: parent_id/id deben ser el propio canal — este valor se guarda como
    // cached_posts.channel_id y de él dependen el índice y el "ya archivado".
    if (isMessageCapable(channel.type)) {
      onProgress?.(1, 1)
      return [{
        thread: {
          id: channel.id,
          guild_id: channel.guild_id || '@me',
          parent_id: channel.id,
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

    // Voz, categoría, stage, directorio... no tienen historial que archivar.
    onProgress?.(0, 0)
    return []
  }

  private async searchAllForumPosts(
    channel: DiscordChannel,
    onProgress?: (count: number, total: number) => void,
    cancellationToken?: { cancelled?: boolean; signal?: AbortSignal }
  ): Promise<ForumPost[]> {
    const tagMap = new Map((channel.available_tags || []).map(t => [t.id, t]))

    const allPosts: ForumPost[] = []
    let offset = 0
    const limit = 25
    let total = 0

    while (true) {
      if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
        throw new Error('fetch_cancelled')
      }

      let result: ThreadSearchResponse
      try {
        result = await this.searchForumThreads(channel.id, {
          sort_by: 'creation_time',
          sort_order: 'desc',
          offset,
          limit,
          signal: cancellationToken?.signal
        })
      } catch (error) {
        if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
          throw new Error('fetch_cancelled')
        }
        throw error
      }

      if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
        throw new Error('fetch_cancelled')
      }

      if (total === 0) total = result.total_results
      onProgress?.(allPosts.length, total)

      for (const thread of result.threads) {
        if (cancellationToken?.cancelled || cancellationToken?.signal?.aborted) {
          throw new Error('fetch_cancelled')
        }

        const postTags = (thread.applied_tags || [])
          .map(tagId => tagMap.get(tagId))
          .filter((t): t is ForumTag => t !== undefined)

        // first_messages es un array — se busca por coincidencia de channel_id con el id del hilo
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

    onProgress?.(allPosts.length, total)
    return allPosts
  }

  /**
   * Una página de mensajes para el visor en vivo (sin descargar el hilo).
   * Discord devuelve los mensajes más recientes primero cuando se usa
   * `before`; aquí se invierten para que la lectura sea cronológica.
   */
  async getMessagePage(
    threadId: string,
    before?: string,
    limit = 50
  ): Promise<{ messages: DiscordMessage[]; hasMore: boolean }> {
    const messages = await this.getThreadMessages(threadId, { before, limit })
    return {
      messages: [...messages].reverse(),
      hasMore: messages.length === limit
    }
  }

  // ----------- Mensajes -----------

  async getThreadMessages(
    threadId: string,
    options: { before?: string; after?: string; limit?: number; signal?: AbortSignal } = {}
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams()
    if (options.before) params.set('before', options.before)
    if (options.after) params.set('after', options.after)
    params.set('limit', (options.limit || 100).toString())

    const url = `${ENDPOINTS.CHANNEL_MESSAGES(threadId)}?${params.toString()}`
    return this.request<DiscordMessage[]>('GET', url, `messages:${threadId}`, undefined, options.signal)
  }

  /**
   * Obtiene todos los mensajes de un canal/hilo.
   * - Admite token de cancelación cooperativa (`{ cancelled?: boolean; signal?: AbortSignal; afterId?: string }`)
   *   o `afterId` directo como string para paginación delta hacia delante.
   * - El resultado se deduplica por id y se ordena del más antiguo al más nuevo.
   */
  async getAllThreadMessages(
    threadId: string,
    onProgress?: (count: number) => void,
    cancellationOrAfterId?: string | { cancelled?: boolean; signal?: AbortSignal; afterId?: string },
    maxPages = 10_000
  ): Promise<DiscordMessage[]> {
    const tokenObj =
      typeof cancellationOrAfterId === 'object' && cancellationOrAfterId !== null
        ? cancellationOrAfterId
        : undefined
    const afterId =
      typeof cancellationOrAfterId === 'string'
        ? cancellationOrAfterId
        : tokenObj?.afterId

    const seen = new Map<string, DiscordMessage>()
    const forward = Boolean(afterId)
    let cursor: string | undefined = afterId
    const limit = 100

    // Tope de seguridad: 10.000 páginas × 100 mensajes = 1.000.000 de mensajes.
    // El corte real lo marca el cursor, que debe avanzar en cada vuelta.
    for (let page = 0; page < maxPages; page++) {
      if (tokenObj?.cancelled || tokenObj?.signal?.aborted) {
        throw new Error('Descarga cancelada')
      }

      const messages = forward
        ? await this.getThreadMessages(threadId, { after: cursor, limit, signal: tokenObj?.signal })
        : await this.getThreadMessages(threadId, { before: cursor, limit, signal: tokenObj?.signal })

      if (tokenObj?.cancelled || tokenObj?.signal?.aborted) {
        throw new Error('Descarga cancelada')
      }

      if (messages.length === 0) break

      for (const message of messages) {
        if (!seen.has(message.id)) seen.set(message.id, message)
      }
      onProgress?.(seen.size)

      if (messages.length < limit) break

      // En paginación hacia delante (`after`) avanzamos desde el ID mayor;
      // en paginación hacia atrás (`before`) avanzamos desde el ID menor.
      let next = messages[0].id
      for (let i = 1; i < messages.length; i++) {
        const id = messages[i].id
        if (forward ? compareSnowflakes(id, next) > 0 : compareSnowflakes(id, next) < 0) {
          next = id
        }
      }
      if (next === cursor) break // el cursor no avanzó → se detiene en vez de repetir para siempre
      cursor = next
    }

    return [...seen.values()].sort((a, b) => {
      const ta = Date.parse(a.timestamp)
      const tb = Date.parse(b.timestamp)
      if (ta === tb || Number.isNaN(ta) || Number.isNaN(tb)) {
        return compareSnowflakes(a.id, b.id)
      }
      return ta - tb
    })
  }

  // ----------- Recursos -----------

  getGuildIconUrl(guildId: string, hash: string | null, size = 128): string | null {
    if (!hash) return null
    return `${ENDPOINTS.GUILD_ICON(guildId, hash)}?size=${size}`
  }

  getUserAvatarUrl(userId: string, hash: string | null, size = 128): string | null {
    if (hash) return `${ENDPOINTS.USER_AVATAR(userId, hash)}?size=${size}`
    // El índice del avatar legacy se deriva de la marca de tiempo del snowflake
    // (bits 22..), no del id completo: parseInt() perdería precisión con ids de 19 dígitos.
    let index = 0
    try {
      index = Number((BigInt(userId) >> 22n) % 6n)
    } catch {
      index = 0
    }
    return ENDPOINTS.DEFAULT_AVATAR(index)
  }

  // ----------- Interno -----------

  private async request<T>(
    method: string,
    url: string,
    route: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: Error | null = null
    const maxRetries = 3

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('Operación cancelada')

      let response: Response
      try {
        response = await this.rateLimiter.execute(route, async () => {
          const headers: Record<string, string> = {
            'Authorization': this.token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }

          const fetchOptions: RequestInit = { method, headers, signal }
          if (body) fetchOptions.body = JSON.stringify(body)

          return fetch(url, fetchOptions)
        }, 0, signal)
      } catch (error) {
        // Si fue cancelación explícita o error fatal no reintentable, salir sin reintentar.
        if (signal?.aborted) throw new Error('Operación cancelada')
        lastError = error as Error
        if (error instanceof DiscordApiError && !error.retryable) throw error
        if (attempt < maxRetries - 1) await this.sleep(this.retryDelay(null, attempt))
        continue
      }

      if (response.status === 401) {
        throw new DiscordApiError('Invalid or expired token', 401, undefined, false)
      }

      if (response.status === 403) {
        throw new DiscordApiError('Access denied. You may not have permission to view this resource.', 403, undefined, false)
      }

      if (response.status === 404) {
        throw new DiscordApiError('Resource not found', 404, undefined, false)
      }

      // 429: el limitador ya reintentó; llegar aquí significa que se rindió.
      if (response.status === 429) {
        throw new DiscordApiError('Rate limited by Discord', 429, undefined, false)
      }

      if (response.status >= 500) {
        lastError = new DiscordApiError(`Discord server error: ${response.status}`, response.status, undefined, true)
        if (attempt < maxRetries - 1) await this.sleep(this.retryDelay(response, attempt))
        continue
      }

      if (!response.ok) {
        const errorBody = await response.text()
        throw new DiscordApiError(`HTTP ${response.status}: ${errorBody}`, response.status)
      }

      return await response.json() as T
    }

    throw lastError || new Error('Unknown error after retries')
  }

  /** Se prefiere la cabecera Retry-After de Discord; si no, se usa backoff exponencial acotado. */
  private retryDelay(response: Response | null, attempt: number): number {
    const header = response?.headers.get('retry-after')
    if (header) {
      const seconds = Number(header)
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000) + 250
      const date = Date.parse(header)
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now()) + 250
    }
    return Math.min(30000, Math.pow(2, attempt) * 1000 + Math.random() * 500)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
  }

  destroy(): void {
    this.rateLimiter.clearQueue()
    this.userCache.clear()
    this.channelCache.clear()
    this.guildCache.clear()
  }
}
