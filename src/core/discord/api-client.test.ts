import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelType, type DiscordGuild, type DiscordMessage } from './types'
import { compareSnowflakes, DiscordApiError, DiscordClient } from './api-client'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function makeMessage(id: string, timestamp = '2024-06-01T12:00:00.000Z'): DiscordMessage {
  return {
    id,
    channel_id: 'thread-1',
    author: {
      id: 'user-1',
      username: 'tester',
      discriminator: '0',
      global_name: 'Tester',
      avatar: null
    },
    content: `msg ${id}`,
    timestamp,
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0
  }
}

describe('compareSnowflakes', () => {
  it('compara snowflakes numéricos grandes con BigInt y usa localeCompare como respaldo', () => {
    // Cruce de 18 a 19 dígitos: lexicográficamente '1000...' < '999...', numéricamente es mayor
    expect(compareSnowflakes('999999999999999999', '1000000000000000000')).toBe(-1)
    expect(compareSnowflakes('1000000000000000000', '999999999999999999')).toBe(1)
    expect(compareSnowflakes('123456789012345678', '123456789012345678')).toBe(0)

    // Respaldo para IDs no numéricos puros en tests
    expect(compareSnowflakes('msg-a', 'msg-b')).toBeLessThan(0)
    expect(compareSnowflakes('msg-b', 'msg-a')).toBeGreaterThan(0)
    expect(compareSnowflakes('msg-a', 'msg-a')).toBe(0)
  })
})

describe('DiscordClient', () => {
  let client: DiscordClient | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    client?.destroy()
    client = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('usa caché LRU en getGuild/getGuilds, expone stats de guilds y limpia en clearCaches/destroy', async () => {
    const guild1: DiscordGuild = { id: '101', name: 'Servidor Uno', icon: null }
    const guild2: DiscordGuild = { id: '102', name: 'Servidor Dos', icon: 'hash2' }

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/users/@me/guilds')) return jsonResponse([guild1, guild2])
      if (url.includes('/guilds/103')) return jsonResponse({ id: '103', name: 'Servidor Tres', icon: null })
      return jsonResponse({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    client = new DiscordClient('token-test')
    expect(client.getCacheStats()).toEqual({
      users: 0,
      maxUsers: 5000,
      channels: 0,
      maxChannels: 2000,
      guilds: 0,
      maxGuilds: 500
    })

    // getGuilds() puebla guildCache
    const guildsPromise = client.getGuilds()
    await vi.runAllTimersAsync()
    const guilds = await guildsPromise
    expect(guilds).toHaveLength(2)
    expect(client.getCacheStats().guilds).toBe(2)

    // getGuild('101') devuelve desde caché sin hacer petición HTTP adicional
    const cachedGuild = await client.getGuild('101')
    expect(cachedGuild).toEqual(guild1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // getGuild('103') consulta API, guarda en caché y reutiliza en segunda llamada
    const g3Promise = client.getGuild('103')
    await vi.runAllTimersAsync()
    const g3 = await g3Promise
    expect(g3.name).toBe('Servidor Tres')
    expect(client.getCacheStats().guilds).toBe(3)

    const g3Cached = await client.getGuild('103')
    expect(g3Cached).toEqual(g3)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    client.clearCaches()
    expect(client.getCacheStats().guilds).toBe(0)

    // Volver a poblar y verificar que destroy() también limpia guildCache
    const g3AgainPromise = client.getGuild('103')
    await vi.runAllTimersAsync()
    await g3AgainPromise
    expect(client.getCacheStats().guilds).toBe(1)

    client.destroy()
    expect(client.getCacheStats().guilds).toBe(0)
  })

  it('pagina hacia atrás (before) eligiendo el snowflake menor aunque el lote llegue desordenado', async () => {
    const base = 999_999_999_999_999_950n
    const orderedIds = Array.from({ length: 100 }, (_, i) => (base + BigInt(i)).toString())
    // Desordenamos para que el mínimo real (base) esté en medio y no al final
    const shuffledPage1 = [
      ...orderedIds.slice(60),
      ...orderedIds.slice(0, 60)
    ].map(id => makeMessage(id, '2024-06-01T12:00:00.000Z'))

    const page2 = [
      makeMessage((base - 2n).toString(), '2024-06-01T11:59:00.000Z'),
      makeMessage((base - 1n).toString(), '2024-06-01T12:00:00.000Z')
    ]

    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requestedUrls.push(url)
      if (!url.includes('before=')) return jsonResponse(shuffledPage1)
      if (url.includes(`before=${base.toString()}`)) return jsonResponse(page2)
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    client = new DiscordClient('token-test')
    const progress: number[] = []
    const promise = client.getAllThreadMessages('thread-1', count => progress.push(count))
    await vi.runAllTimersAsync()
    const result = await promise

    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls[1]).toContain(`before=${base.toString()}`)
    expect(result).toHaveLength(102)
    expect(result[0].id).toBe((base - 2n).toString())
    expect(result[1].id).toBe((base - 1n).toString())
    expect(result[2].id).toBe(base.toString())
    expect(result[result.length - 1].id).toBe((base + 99n).toString())
    expect(progress).toEqual([100, 102])
  })

  it('pagina hacia delante (after) eligiendo el snowflake mayor y ordena timestamps inválidos con compareSnowflakes', async () => {
    const base = 999_999_999_999_999_950n
    const orderedIds = Array.from({ length: 100 }, (_, i) => (base + BigInt(i)).toString())
    const maxPage1 = orderedIds[99] // '1000000000000000049' (menor lexicográficamente que '999...')
    // Colocamos el ID mayor en la mitad del lote y un ID de 18 dígitos al final
    const shuffledPage1 = [
      ...orderedIds.slice(50),
      ...orderedIds.slice(0, 50)
    ].map(id => makeMessage(id, 'fecha-invalida'))

    const page2 = [
      makeMessage('1000000000000000051', 'fecha-invalida'),
      makeMessage('1000000000000000050', 'fecha-invalida')
    ]

    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('after=999999999999999900')) return jsonResponse(shuffledPage1)
      if (url.includes(`after=${maxPage1}`)) return jsonResponse(page2)
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    client = new DiscordClient('token-test')
    const promise = client.getAllThreadMessages('thread-1', undefined, { afterId: '999999999999999900' })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls[1]).toContain(`after=${maxPage1}`)
    expect(result).toHaveLength(102)
    expect(result[0].id).toBe(base.toString())
    expect(result[99].id).toBe(maxPage1)
    expect(result[100].id).toBe('1000000000000000050')
    expect(result[101].id).toBe('1000000000000000051')
  })

  it('cancela searchForumThreads y getAllForumPosts mediante AbortSignal o cancellationToken', async () => {
    const acNormal = new AbortController()
    let seenSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/threads/search')) {
        seenSignal = init?.signal ?? undefined
        return jsonResponse({ threads: [], members: [], total_results: 0, has_more: false, first_messages: [] })
      }
      if (url.includes('/channels/forum-1')) {
        return jsonResponse({
          id: 'forum-1',
          type: ChannelType.GUILD_FORUM,
          name: 'foro',
          available_tags: []
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    client = new DiscordClient('token-test')

    // searchForumThreads pasa signal a request/fetch y aborta si ya viene cancelado
    const preAborted = new AbortController()
    preAborted.abort()
    await expect(
      client.searchForumThreads('forum-1', { signal: preAborted.signal })
    ).rejects.toThrow('Operación cancelada')

    const searchPromise = client.searchForumThreads('forum-1', { signal: acNormal.signal })
    await vi.runAllTimersAsync()
    await searchPromise
    expect(seenSignal).toBe(acNormal.signal)

    // Si el signal se aborta en mitad de searchForumThreads, rechaza con cancelación
    const acMidSearch = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      acMidSearch.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    const midSearchPromise = client.searchForumThreads('forum-1', { signal: acMidSearch.signal })
    const midSearchAssertion = expect(midSearchPromise).rejects.toThrow('Operación cancelada')
    await vi.runAllTimersAsync()
    await midSearchAssertion

    // getAllForumPosts lanza 'fetch_cancelled' si cancelled === true
    await expect(
      client.getAllForumPosts('forum-1', undefined, { cancelled: true })
    ).rejects.toThrow('fetch_cancelled')

    // getAllForumPosts lanza 'fetch_cancelled' si signal ya está abortado
    await expect(
      client.getAllForumPosts('forum-1', undefined, { signal: preAborted.signal })
    ).rejects.toThrow('fetch_cancelled')

    // getAllForumPosts también lanza 'fetch_cancelled' si el AbortSignal se aborta durante la búsqueda
    const midAbort = new AbortController()
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/threads/search')) {
        midAbort.abort()
        throw new DOMException('Aborted', 'AbortError')
      }
      if (url.includes('/channels/forum-2')) {
        return jsonResponse({
          id: 'forum-2',
          type: ChannelType.GUILD_FORUM,
          name: 'foro-2',
          available_tags: []
        })
      }
      return jsonResponse({})
    })

    const midPromise = client.getAllForumPosts('forum-2', undefined, { signal: midAbort.signal })
    const midAssertion = expect(midPromise).rejects.toThrow('fetch_cancelled')
    await vi.runAllTimersAsync()
    await midAssertion
  })

  it('lanza DiscordApiError inmediata en errores HTTP 401, 403 y 404 sin reintentar', async () => {
    for (const status of [401, 403, 404]) {
      const fetchMock = vi.fn(async () => jsonResponse({ message: 'error' }, status))
      vi.stubGlobal('fetch', fetchMock)
      client = new DiscordClient('token-test')

      const promise = client.getGuild(`guild-${status}`)
      const assertion = expect(promise).rejects.toMatchObject({
        name: 'DiscordApiError',
        status,
        retryable: false
      })
      await vi.runAllTimersAsync()
      await assertion
      expect(fetchMock).toHaveBeenCalledTimes(1)

      client.destroy()
      client = null
    }
  })

  it('reintenta respuestas 500 hasta recuperar o lanzar DiscordApiError tras agotar reintentos', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      if (calls < 3) {
        return jsonResponse({ message: 'internal error' }, 500, { 'retry-after': '0' })
      }
      return jsonResponse({ id: '777', name: 'Recuperado', icon: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    client = new DiscordClient('token-test')
    const okPromise = client.getGuild('777')
    await vi.runAllTimersAsync()
    const guild = await okPromise
    expect(guild.name).toBe('Recuperado')
    expect(calls).toBe(3)

    // Si falla 3 veces seguidas con 500, lanza DiscordApiError retryable
    let failCalls = 0
    fetchMock.mockImplementation(async () => {
      failCalls++
      return jsonResponse({ message: 'down' }, 502, { 'retry-after': '0' })
    })

    const failPromise = client.getGuild('888')
    const failAssertion = expect(failPromise).rejects.toBeInstanceOf(DiscordApiError)
    const statusAssertion = expect(failPromise).rejects.toMatchObject({ status: 502, retryable: true })
    await vi.runAllTimersAsync()
    await Promise.all([failAssertion, statusAssertion])
    expect(failCalls).toBe(3)
  })
})
