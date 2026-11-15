// ============================================================
// Rate Limiter conservador — ritmo de ~2 req/s
// Respeta las cabeceras X-RateLimit-* de Discord, backoff automático en 429
// ============================================================

import type { RateLimiterBucket, RateLimiterStats } from '../../shared/api'

interface QueuedRequest {
  execute: () => Promise<Response>
  resolve: (value: Response) => void
  reject: (reason: unknown) => void
  route: string
  priority: number
  addedAt: number
  /** Se marca al resolverse, para que un reintento 429 encolado nunca se resuelva/rechace dos veces. */
  settled: boolean
  attempts: number
  signal?: AbortSignal
  cleanupAbort?: () => void
}

export class RateLimiter {
  private readonly MIN_INTERVAL_MS = 500 // ~2 req/s
  private readonly MAX_429_RETRIES = 5
  private readonly MAX_ROUTES = 1000
  private readonly MAX_BUCKETS = 500

  /** clave de ruta (p. ej. `messages:123`) → hash de bucket de Discord */
  private bucketIdByRoute = new Map<string, string>()
  /** hash de bucket de Discord → estado del bucket */
  private buckets = new Map<string, RateLimiterBucket>()

  private queue: QueuedRequest[] = []
  private processing = false
  private globalLockUntil = 0
  private lastDispatch = 0
  private metrics = { totalRequests: 0, totalWaitTime: 0, rateLimitHits: 0 }
  private requestTimestamps: number[] = []

  async execute(
    route: string,
    requestFn: () => Promise<Response>,
    priority = 0,
    signal?: AbortSignal
  ): Promise<Response> {
    if (signal?.aborted) {
      return Promise.reject(new Error('Operación cancelada'))
    }

    return new Promise<Response>((resolve, reject) => {
      const item: QueuedRequest = {
        execute: requestFn,
        resolve,
        reject,
        route,
        priority,
        addedAt: Date.now(),
        settled: false,
        attempts: 0,
        signal
      }

      if (signal) {
        const onAbort = (): void => {
          const idx = this.queue.indexOf(item)
          if (idx !== -1) this.queue.splice(idx, 1)
          if (!item.settled) {
            item.settled = true
            item.reject(new Error('Operación cancelada'))
          }
        }
        signal.addEventListener('abort', onAbort, { once: true })
        item.cleanupAbort = () => signal.removeEventListener('abort', onAbort)
      }

      this.queue.push(item)
      this.sortQueue()
      void this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.queue.length > 0) {
        const request = this.queue[0]
        if (request.settled || request.signal?.aborted) {
          this.queue.shift()
          request.cleanupAbort?.()
          if (!request.settled) {
            request.settled = true
            request.reject(new Error('Operación cancelada'))
          }
          continue
        }

        // Bloqueo global por 429, bloqueo por bucket y luego el ritmo global conservador
        const waitMs = Math.max(
          this.globalLockUntil - Date.now(),
          this.bucketWaitMs(request.route),
          this.lastDispatch + this.MIN_INTERVAL_MS - Date.now()
        )
        if (waitMs > 0) await this.sleep(waitMs)
        this.lastDispatch = Date.now()

        // clearQueue() o AbortSignal pudo haberla descartado mientras esperábamos
        const index = this.queue.indexOf(request)
        if (index === -1 || request.settled) continue
        this.queue.splice(index, 1)
        if (request.signal?.aborted) {
          request.settled = true
          request.cleanupAbort?.()
          request.reject(new Error('Operación cancelada'))
          continue
        }
        this.metrics.totalWaitTime += Date.now() - request.addedAt

        let response: Response
        try {
          response = await request.execute()
        } catch (error) {
          request.settled = true
          request.cleanupAbort?.()
          request.reject(error)
          continue
        }

        this.metrics.totalRequests++
        this.recordRequest()
        this.updateBucket(request.route, response)

        if (response.status !== 429) {
          request.settled = true
          request.cleanupAbort?.()
          request.resolve(response)
          continue
        }

        this.metrics.rateLimitHits++
        request.attempts++
        const retryAfter = await this.handle429(response)

        if (request.signal?.aborted) {
          request.settled = true
          request.cleanupAbort?.()
          request.reject(new Error('Operación cancelada'))
          continue
        }

        if (request.attempts >= this.MAX_429_RETRIES) {
          // Se rinde: devuelve el 429 para que el llamador falle en vez de colgarse para siempre.
          request.settled = true
          request.cleanupAbort?.()
          request.resolve(response)
          continue
        }

        // Bloquea la ruta (también globalmente si Discord lo indicó), la reencola
        // con prioridad máxima y deja que el inicio del bucle duerma — nunca resolver dos veces.
        this.lockBucket(request.route, retryAfter)
        request.priority = 999
        request.addedAt = Date.now()
        this.queue.push(request)
        this.sortQueue()
      }
    } finally {
      // Nunca dejar la cola bloqueada si algo de arriba lanza una excepción.
      this.processing = false
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt)
  }

  /** Tiempo de espera (ms) impuesto por el bucket al que pertenece `route`. */
  private bucketWaitMs(route: string): number {
    const bucket = this.buckets.get(this.bucketIdByRoute.get(route) ?? route)
    if (!bucket || bucket.remaining > 0) return 0
    return Math.max(0, bucket.resetAt - Date.now())
  }

  private setRouteBucket(route: string, bucketId: string): void {
    if (this.bucketIdByRoute.has(route)) {
      this.bucketIdByRoute.delete(route)
    } else {
      while (this.bucketIdByRoute.size >= this.MAX_ROUTES) {
        const oldestRoute = this.bucketIdByRoute.keys().next().value
        if (oldestRoute === undefined) break
        this.bucketIdByRoute.delete(oldestRoute)
      }
    }
    this.bucketIdByRoute.set(route, bucketId)
  }

  private setBucket(key: string, bucket: RateLimiterBucket): void {
    if (this.buckets.has(key)) {
      this.buckets.delete(key)
    } else if (this.buckets.size >= this.MAX_BUCKETS) {
      const now = Date.now()
      for (const [existingKey, existing] of this.buckets) {
        if (existing.resetAt <= now) {
          this.buckets.delete(existingKey)
        }
      }
      while (this.buckets.size >= this.MAX_BUCKETS) {
        const oldestKey = this.buckets.keys().next().value
        if (oldestKey === undefined) break
        this.buckets.delete(oldestKey)
      }
    }
    this.buckets.set(key, bucket)
  }

  private updateBucket(route: string, response: Response): void {
    const bucketId = response.headers.get('x-ratelimit-bucket')
    if (bucketId) this.setRouteBucket(route, bucketId)

    const remaining = response.headers.get('x-ratelimit-remaining')
    const limit = response.headers.get('x-ratelimit-limit')
    const resetAfter = response.headers.get('x-ratelimit-reset-after')
    if (remaining === null || limit === null || resetAfter === null) return

    const resetAfterMs = parseFloat(resetAfter) * 1000
    this.setBucket(bucketId ?? route, {
      remaining: parseInt(remaining, 10),
      limit: parseInt(limit, 10),
      resetAfter: resetAfterMs,
      resetAt: Date.now() + resetAfterMs
    })
  }

  /** Marca como agotado, durante `retryAfterMs`, el bucket al que pertenece `route`. */
  private lockBucket(route: string, retryAfterMs: number): void {
    const key = this.bucketIdByRoute.get(route) ?? route
    const existingLimit = this.buckets.get(key)?.limit ?? 1
    this.setBucket(key, {
      remaining: 0,
      limit: existingLimit,
      resetAfter: retryAfterMs,
      resetAt: Date.now() + retryAfterMs
    })
  }

  private async handle429(response: Response): Promise<number> {
    const body = (await response.json().catch(() => null)) as { retry_after?: number } | null
    let retryAfter = body?.retry_after ? Math.ceil(body.retry_after * 1000) : NaN

    if (!Number.isFinite(retryAfter)) {
      const header = response.headers.get('retry-after')
      const seconds = header ? parseFloat(header) : NaN
      retryAfter = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : 5000
    }
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = 5000
    retryAfter += 1000 // margen de seguridad

    if (response.headers.get('x-ratelimit-global') === 'true') {
      this.globalLockUntil = Date.now() + retryAfter
    }
    return retryAfter
  }

  private recordRequest(): void {
    const now = Date.now()
    this.requestTimestamps.push(now)
    const cutoff = now - 60000
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] <= cutoff) {
      this.requestTimestamps.shift()
    }
  }

  getStats(): RateLimiterStats {
    const { totalRequests, totalWaitTime, rateLimitHits } = this.metrics
    const nextSlot = this.lastDispatch + this.MIN_INTERVAL_MS

    const routes: Record<string, RateLimiterBucket> = {}
    this.buckets.forEach((bucket, key) => { routes[key] = { ...bucket } })

    return {
      totalRequests,
      totalWaitTime,
      rateLimitHits,
      requestsPerMinute: this.requestTimestamps.length,
      averageWaitMs: totalRequests > 0 ? totalWaitTime / totalRequests : 0,
      global: {
        remaining: Math.max(0, nextSlot - Date.now()) > 0 ? 0 : 2,
        limit: 2,
        resetAt: nextSlot,
        resetAfter: Math.max(0, nextSlot - Date.now())
      },
      routes
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  clearQueue(): void {
    const pending = this.queue.splice(0)
    for (const req of pending) {
      req.cleanupAbort?.()
      if (req.settled) continue
      req.settled = true
      req.reject(new Error('Queue cleared'))
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
  }
}
