// ============================================================
// Conservative Rate Limiter — Token bucket at ~2 req/s
// Respects Discord's X-RateLimit-* headers, auto-backoff on 429
// ============================================================

import { EventEmitter } from 'events'

interface RateLimitBucket {
  remaining: number
  limit: number
  resetAt: number // epoch ms
  resetAfter: number // ms
}

interface QueuedRequest {
  id: string
  execute: () => Promise<Response>
  resolve: (value: Response) => void
  reject: (reason: unknown) => void
  route: string
  priority: number
  addedAt: number
}

export interface RateLimiterStats {
  totalRequests: number
  totalWaitTime: number
  rateLimitHits: number
  requestsPerMinute: number
  averageWaitMs: number
  global: RateLimitBucket
  routes: Record<string, RateLimitBucket>
}

export class RateLimiter extends EventEmitter {
  private globalBucket: RateLimitBucket
  private routeBuckets = new Map<string, RateLimitBucket>()
  private queue: QueuedRequest[] = []
  private processing = false
  private globalLockUntil = 0
  private metrics = {
    totalRequests: 0,
    totalWaitTime: 0,
    rateLimitHits: 0,
    requestsPerMinute: 0,
    averageWaitMs: 0
  }
  private requestTimestamps: number[] = []
  private requestIdCounter = 0

  // Conservative: 2 tokens capacity, refill 1 token every 500ms
  private readonly TOKEN_CAPACITY = 2
  private readonly REFILL_INTERVAL_MS = 500
  private tokens = 2
  private lastRefill = Date.now()

  constructor() {
    super()
    this.globalBucket = {
      remaining: this.TOKEN_CAPACITY,
      limit: this.TOKEN_CAPACITY,
      resetAt: Date.now() + this.REFILL_INTERVAL_MS,
      resetAfter: this.REFILL_INTERVAL_MS
    }
  }

  async execute(
    route: string,
    requestFn: () => Promise<Response>,
    priority = 0
  ): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const id = `req_${++this.requestIdCounter}`
      this.queue.push({
        id,
        execute: requestFn,
        resolve,
        reject,
        route,
        priority,
        addedAt: Date.now()
      })
      // Sort by priority (higher first)
      this.queue.sort((a, b) => b.priority - a.priority)
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const request = this.queue[0]

      // Wait for global rate limit
      const now = Date.now()
      if (this.globalLockUntil > now) {
        const waitTime = this.globalLockUntil - now
        this.emit('rate-limit-wait', { type: 'global', waitMs: waitTime, route: request.route })
        await this.sleep(waitTime)
      }

      // Wait for route-specific bucket
      const routeBucket = this.routeBuckets.get(request.route)
      if (routeBucket && routeBucket.remaining <= 0 && routeBucket.resetAt > Date.now()) {
        const waitTime = routeBucket.resetAt - Date.now()
        this.emit('rate-limit-wait', { type: 'route', waitMs: waitTime, route: request.route })
        await this.sleep(waitTime)
      }

      // Token bucket throttle (conservative ~2 req/s)
      await this.waitForToken()

      // Dequeue and execute
      this.queue.shift()
      const waitTime = Date.now() - request.addedAt
      this.metrics.totalWaitTime += waitTime

      try {
        const response = await request.execute()
        this.metrics.totalRequests++
        this.recordRequestTimestamp()
        this.updateStatsRPM()

        // Parse rate limit headers
        this.updateBucketFromHeaders(request.route, response)

        // Handle 429
        if (response.status === 429) {
          this.metrics.rateLimitHits++
          const retryAfter = await this.handle429(response, request.route)
          // Re-queue the request at highest priority
          this.queue.unshift({
            ...request,
            priority: 999
          })
          this.emit('rate-limit-hit', {
            route: request.route,
            retryAfterMs: retryAfter,
            global: response.headers.get('x-ratelimit-global') === 'true'
          })
          await this.sleep(retryAfter)
          continue
        }

        request.resolve(response)
      } catch (error) {
        request.reject(error)
      }
    }

    this.processing = false
  }

  private async waitForToken(): Promise<void> {
    while (true) {
      this.refillTokens()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      // Wait for next refill
      const waitMs = this.REFILL_INTERVAL_MS - (Date.now() - this.lastRefill)
      if (waitMs > 0) {
        await this.sleep(waitMs)
      }
    }
  }

  private refillTokens(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = Math.floor(elapsed / this.REFILL_INTERVAL_MS)
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.TOKEN_CAPACITY, this.tokens + tokensToAdd)
      this.lastRefill = now - (elapsed % this.REFILL_INTERVAL_MS)
    }
  }

  private updateBucketFromHeaders(route: string, response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const limit = response.headers.get('x-ratelimit-limit')
    const resetAfter = response.headers.get('x-ratelimit-reset-after')
    const bucket = response.headers.get('x-ratelimit-bucket')

    if (remaining !== null && limit !== null && resetAfter !== null) {
      const bucketKey = bucket || route
      this.routeBuckets.set(bucketKey, {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        resetAfter: parseFloat(resetAfter) * 1000,
        resetAt: Date.now() + parseFloat(resetAfter) * 1000
      })
    }
  }

  private async handle429(response: Response, _route: string): Promise<number> {
    const isGlobal = response.headers.get('x-ratelimit-global') === 'true'
    let retryAfter = 5000 // default 5s

    try {
      const body = await response.json() as { retry_after?: number }
      if (body.retry_after) {
        retryAfter = Math.ceil(body.retry_after * 1000)
      }
    } catch {
      const retryHeader = response.headers.get('retry-after')
      if (retryHeader) {
        retryAfter = Math.ceil(parseFloat(retryHeader) * 1000)
      }
    }

    // Add safety margin
    retryAfter += 1000

    if (isGlobal) {
      this.globalLockUntil = Date.now() + retryAfter
    }

    return retryAfter
  }

  private recordRequestTimestamp(): void {
    this.requestTimestamps.push(Date.now())
    // Keep only last 60s of timestamps
    const cutoff = Date.now() - 60000
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff)
  }

  private updateStatsRPM(): void {
    this.metrics.requestsPerMinute = this.requestTimestamps.length
    if (this.metrics.totalRequests > 0) {
      this.metrics.averageWaitMs = this.metrics.totalWaitTime / this.metrics.totalRequests
    }
  }

  getStats(): RateLimiterStats {
    this.updateStatsRPM()
    
    // Sync global bucket view with internal token bucket state
    this.globalBucket.remaining = Math.floor(this.tokens)
    this.globalBucket.limit = this.TOKEN_CAPACITY

    const routes: Record<string, RateLimitBucket> = {}
    this.routeBuckets.forEach((bucket, key) => {
      routes[key] = { ...bucket }
    })
    return { 
      ...this.metrics, 
      global: { ...this.globalBucket },
      routes
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  clearQueue(): void {
    const pending = this.queue.splice(0)
    for (const req of pending) {
      req.reject(new Error('Queue cleared'))
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
  }
}
