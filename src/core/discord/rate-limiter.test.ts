import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from './rate-limiter'

function mockResponse(status = 200, headers: Record<string, string> = {}): Response {
  return new Response('{}', { status, headers })
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rechaza de inmediato si el AbortSignal ya llega abortado', async () => {
    const limiter = new RateLimiter()
    const controller = new AbortController()
    controller.abort()
    const spy = vi.fn(async () => mockResponse())

    await expect(limiter.execute('/guilds', spy, 0, controller.signal)).rejects.toThrow(
      'Operación cancelada'
    )
    expect(spy).not.toHaveBeenCalled()
    expect(limiter.getQueueLength()).toBe(0)
  })

  it('ordena la cola por prioridad descendente y cancela elementos en espera por señal', async () => {
    const limiter = new RateLimiter()
    const orden: string[] = []
    let liberarPrimera!: () => void

    const primera = limiter.execute('/r0', () => new Promise<Response>((resolve) => {
      orden.push('primera')
      liberarPrimera = () => resolve(mockResponse())
    }), 0)

    const ctrlCancelada = new AbortController()
    const baja = limiter.execute('/r1', async () => {
      orden.push('baja')
      return mockResponse()
    }, 1)
    const cancelada = limiter.execute('/r2', async () => {
      orden.push('cancelada')
      return mockResponse()
    }, 5, ctrlCancelada.signal)
    const alta = limiter.execute('/r3', async () => {
      orden.push('alta')
      return mockResponse()
    }, 10)

    ctrlCancelada.abort()
    await expect(cancelada).rejects.toThrow('Operación cancelada')

    liberarPrimera()
    await primera
    await vi.runAllTimersAsync()
    await Promise.all([baja, alta])

    expect(orden).toEqual(['primera', 'alta', 'baja'])
  })

  it('registra cabeceras de bucket x-ratelimit y estadísticas globales', async () => {
    const limiter = new RateLimiter()
    const res = await limiter.execute('/channels/1/messages', async () =>
      mockResponse(200, {
        'x-ratelimit-bucket': 'bucket-msgs',
        'x-ratelimit-remaining': '4',
        'x-ratelimit-limit': '5',
        'x-ratelimit-reset-after': '1.5'
      })
    )

    expect(res.status).toBe(200)
    const stats = limiter.getStats()
    expect(stats.totalRequests).toBe(1)
    expect(stats.rateLimitHits).toBe(0)
    expect(stats.routes['bucket-msgs']?.remaining).toBe(4)
    expect(stats.routes['bucket-msgs']?.limit).toBe(5)
  })

  it('limpia la cola pendiente al llamar clearQueue()', async () => {
    const limiter = new RateLimiter()
    let resolverPrimera!: () => void
    const primera = limiter.execute('/a', () => new Promise<Response>((r) => {
      resolverPrimera = () => r(mockResponse())
    }))
    const segunda = limiter.execute('/b', async () => mockResponse())

    expect(limiter.getQueueLength()).toBe(1)
    limiter.clearQueue()
    expect(limiter.getQueueLength()).toBe(0)
    await expect(segunda).rejects.toThrow('Queue cleared')

    resolverPrimera()
    await primera
  })

  it('reintenta respuestas 429, incrementa rateLimitHits y devuelve 200 al recuperar', async () => {
    const limiter = new RateLimiter()
    let intentos = 0

    const promesa = limiter.execute('/channels/99/threads', async () => {
      intentos++
      if (intentos === 1) {
        return new Response(JSON.stringify({ retry_after: 0.05 }), {
          status: 429,
          headers: { 'content-type': 'application/json' }
        })
      }
      return mockResponse(200)
    })

    await vi.runAllTimersAsync()
    const respuesta = await promesa

    expect(respuesta.status).toBe(200)
    expect(intentos).toBe(2)
    expect(limiter.getStats().rateLimitHits).toBe(1)
  })

  it('desempata elementos de igual prioridad en orden FIFO estricto', async () => {
    const limiter = new RateLimiter()
    const orden: string[] = []
    let liberar!: () => void

    const bloqueante = limiter.execute('/lock', () => new Promise<Response>((resolve) => {
      orden.push('lock')
      liberar = () => resolve(mockResponse())
    }), 0)

    const p1 = limiter.execute('/r1', async () => {
      orden.push('fifo-1')
      return mockResponse()
    }, 5)

    vi.advanceTimersByTime(1)
    const p2 = limiter.execute('/r2', async () => {
      orden.push('fifo-2')
      return mockResponse()
    }, 5)

    // Mismo milisegundo que p2 para validar también estabilidad ante addedAt idéntico
    const p3 = limiter.execute('/r3', async () => {
      orden.push('fifo-3')
      return mockResponse()
    }, 5)

    vi.advanceTimersByTime(1)
    const alta = limiter.execute('/r4', async () => {
      orden.push('alta')
      return mockResponse()
    }, 10)
    const baja = limiter.execute('/r5', async () => {
      orden.push('baja')
      return mockResponse()
    }, 1)

    liberar()
    await bloqueante
    await vi.runAllTimersAsync()
    await Promise.all([p1, p2, p3, alta, baja])

    expect(orden).toEqual(['lock', 'alta', 'fifo-1', 'fifo-2', 'fifo-3', 'baja'])
  })

  it('acota en memoria bucketIdByRoute (1000) y buckets (500) expulsando expirados y entradas antiguas', async () => {
    const limiter = new RateLimiter()

    // 1) Llenamos 500 buckets: los primeros 100 expiran rápido (0.1s) y 400 siguen activos (3600s)
    const lote1 = Array.from({ length: 500 }, (_, i) => {
      const resetAfter = i < 100 ? '0.1' : '3600'
      return limiter.execute(`/route-${i}`, async () =>
        mockResponse(200, {
          'x-ratelimit-bucket': `bucket-${i}`,
          'x-ratelimit-remaining': '4',
          'x-ratelimit-limit': '5',
          'x-ratelimit-reset-after': resetAfter
        })
      )
    })
    await vi.runAllTimersAsync()
    await Promise.all(lote1)
    expect(Object.keys(limiter.getStats().routes)).toHaveLength(500)

    // Al insertar otro bucket nuevo tras expirar los primeros 100, primero se purgan los expirados
    const extraPromise = limiter.execute('/route-extra', async () =>
      mockResponse(200, {
        'x-ratelimit-bucket': 'bucket-extra',
        'x-ratelimit-remaining': '4',
        'x-ratelimit-limit': '5',
        'x-ratelimit-reset-after': '3600'
      })
    )
    await vi.runAllTimersAsync()
    await extraPromise

    const routesTrasPurga = limiter.getStats().routes
    expect(routesTrasPurga['bucket-0']).toBeUndefined()
    expect(routesTrasPurga['bucket-100']).toBeDefined()
    expect(routesTrasPurga['bucket-extra']).toBeDefined()
    expect(Object.keys(routesTrasPurga).length).toBeLessThanOrEqual(500)

    // 2) Superamos MAX_ROUTES (1000) y MAX_BUCKETS (500) con buckets todos activos (3600s)
    const lote2 = Array.from({ length: 650 }, (_, j) => {
      const idx = 500 + j
      return limiter.execute(`/route-${idx}`, async () =>
        mockResponse(200, {
          'x-ratelimit-bucket': `bucket-${idx}`,
          'x-ratelimit-remaining': '4',
          'x-ratelimit-limit': '5',
          'x-ratelimit-reset-after': '3600'
        })
      )
    })
    await vi.runAllTimersAsync()
    await Promise.all(lote2)

    const statsFinal = limiter.getStats()
    expect(Object.keys(statsFinal.routes)).toHaveLength(500)
    expect(statsFinal.routes['bucket-1149']).toBeDefined()
    expect(statsFinal.routes['bucket-100']).toBeUndefined()

    const internal = limiter as unknown as { bucketIdByRoute: Map<string, string> }
    expect(internal.bucketIdByRoute.size).toBe(1000)
    expect(internal.bucketIdByRoute.has('/route-0')).toBe(false)
    expect(internal.bucketIdByRoute.has('/route-1149')).toBe(true)
  })
})
