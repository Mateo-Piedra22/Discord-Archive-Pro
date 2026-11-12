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
}

export class RateLimiter {
  private readonly MIN_INTERVAL_MS = 500 // ~2 req/s
  private readonly MAX_429_RETRIES = 5

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

  async execute(route: string, requestFn: () => Promise<Response>, priority = 0): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this.queue.push({
        execute: requestFn, resolve, reject, route, priority,
        addedAt: Date.now(), settled: false, attempts: 0
      })
      this.queue.sort((a, b) => b.priority - a.priority)
      void this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.queue.length > 0) {
        const request = this.queue[0]
        if (request.settled) {
          this.queue.shift()
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

        // clearQueue() pudo haberla descartado mientras esperábamos
        const index = this.queue.indexOf(request)
        if (index === -1 || request.settled) continue
        this.queue.splice(index, 1)
        this.metrics.totalWaitTime += Date.now() - request.addedAt

        let response: Response
        try {
          response = await request.execute()
        } catch (error) {
          request.settled = true
          request.reject(error)
          continue
        }

        this.metrics.totalRequests++
        this.recordRequest()
        this.updateBucket(request.route, response)

        if (response.status !== 429) {
          request.settled = true
          request.resolve(response)
          continue
        }

        this.metrics.rateLimitHits++
        request.attempts++
        const retryAfter = await this.handle429(response)

        if (request.attempts >= this.MAX_429_RETRIES) {
          // Se rinde: devuelve el 429 para que el llamador falle en vez de colgarse para siempre.
          request.settled = true
          request.resolve(response)
          continue
        }

        // Bloquea la ruta (también globalmente si Discord lo indicó), la reencola
        // con prioridad máxima y deja que el inicio del bucle duerma — nunca resolver dos veces.
        this.lockBucket(request.route, retryAfter)
        request.priority = 999
        request.addedAt = Date.now()
        this.queue.push(request)
        this.queue.sort((a, b) => b.priority - a.priority)
      }
    } finally {
      // Nunca dejar la cola bloqueada si algo de arriba lanza una excepción.
      this.processing = false
    }
  }

  /** Tiempo de espera (ms) impuesto por el bucket al que pertenece `route`. */
  private bucketWaitMs(route: string): number {
    const bucket = this.buckets.get(this.bucketIdByRoute.get(route) ?? route)
    if (!bucket || bucket.remaining > 0) return 0
    return Math.max(0, bucket.resetAt - Date.now())
  }

  private updateBucket(route: string, response: Response): void {
    const bucketId = response.headers.get('x-ratelimit-bucket')
    if (bucketId) this.bucketIdByRoute.set(route, bucketId)

    const remaining = response.headers.get('x-ratelimit-remaining')
    const limit = response.headers.get('x-ratelimit-limit')
    const resetAfter = response.headers.get('x-ratelimit-reset-after')
    if (remaining === null || limit === null || resetAfter === null) return

    const resetAfterMs = parseFloat(resetAfter) * 1000
    this.buckets.set(bucketId ?? route, {
      remaining: parseInt(remaining, 10),
      limit: parseInt(limit, 10),
      resetAfter: resetAfterMs,
      resetAt: Date.now() + resetAfterMs
    })
  }

  /** Marca como agotado, durante `retryAfterMs`, el bucket al que pertenece `route`. */
  private lockBucket(route: string, retryAfterMs: number): void {
    const key = this.bucketIdByRoute.get(route) ?? route
    this.buckets.set(key, {
      remaining: 0,
      limit: this.buckets.get(key)?.limit ?? 1,
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
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff)
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
      if (req.settled) continue
      req.settled = true
      req.reject(new Error('Queue cleared'))
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
  }
}
