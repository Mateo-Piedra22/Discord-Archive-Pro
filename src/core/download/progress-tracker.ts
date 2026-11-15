// ============================================================
// Seguimiento de progreso — progreso por fases, velocidad y ETA.
// ============================================================

export interface PostProgress {
  phase: 'fetching' | 'downloading_assets' | 'exporting' | 'done'
  messagesTotal: number
  messagesFetched: number
  assetsTotal: number
  assetsDownloaded: number
  bytesTotal: number
  bytesDownloaded: number
  currentFile?: string
  speed: number
  eta: number
}

export class TaskTracker {
  private static readonly SAMPLE_WINDOW_MS = 8000
  private static readonly MIN_WINDOW_SEC = 0.05
  private static readonly EMA_ALPHA = 0.35

  private progress: PostProgress = {
    phase: 'fetching',
    messagesTotal: 0,
    messagesFetched: 0,
    assetsTotal: 0,
    assetsDownloaded: 0,
    bytesTotal: 0,
    bytesDownloaded: 0,
    speed: 0,
    eta: 0
  }

  private samples: { time: number; bytes: number }[] = []
  private emaSpeed: number | null = null
  private readonly createdAt = Date.now()
  private assetStartTime: number | null = null
  private hadNonAssetUpdate = false

  update(partial: Partial<PostProgress>): void {
    const now = Date.now()
    if (
      this.assetStartTime === null &&
      (partial.phase === 'downloading_assets' ||
        partial.assetsTotal !== undefined ||
        partial.assetsDownloaded !== undefined)
    ) {
      this.assetStartTime = now
    } else if (this.assetStartTime === null) {
      this.hadNonAssetUpdate = true
    }

    Object.assign(this.progress, partial)

    if (partial.bytesDownloaded !== undefined) {
      this.samples.push({ time: now, bytes: partial.bytesDownloaded })
      const cutoff = now - TaskTracker.SAMPLE_WINDOW_MS
      while (this.samples.length > 0 && this.samples[0].time < cutoff) {
        this.samples.shift()
      }

      if (this.samples.length < 2) {
        this.emaSpeed = null
        return
      }

      const first = this.samples[0]
      const last = this.samples[this.samples.length - 1]
      const elapsed = (last.time - first.time) / 1000
      if (elapsed >= TaskTracker.MIN_WINDOW_SEC) {
        const instant = Math.max(0, (last.bytes - first.bytes) / elapsed)
        this.emaSpeed =
          this.emaSpeed === null
            ? instant
            : TaskTracker.EMA_ALPHA * instant + (1 - TaskTracker.EMA_ALPHA) * this.emaSpeed
      }
    }
  }

  get(): PostProgress {
    return { ...this.progress }
  }

  getSpeed(): number {
    if (this.samples.length < 2) return 0
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const elapsed = (last.time - first.time) / 1000
    if (elapsed < TaskTracker.MIN_WINDOW_SEC) return 0
    return this.emaSpeed ?? 0
  }

  getEta(): number {
    if (this.progress.bytesTotal > 0) {
      const speed = this.getSpeed()
      if (speed <= 0) return 0
      const remaining = this.progress.bytesTotal - this.progress.bytesDownloaded
      if (remaining <= 0) return 0
      return Math.round(remaining / speed)
    }

    if (this.progress.assetsTotal > 0 && this.progress.assetsDownloaded > 0) {
      const remainingAssets = this.progress.assetsTotal - this.progress.assetsDownloaded
      if (remainingAssets <= 0) return 0
      const now = Date.now()
      const refStart =
        this.assetStartTime !== null && (now > this.assetStartTime || this.hadNonAssetUpdate)
          ? this.assetStartTime
          : this.createdAt
      const elapsed = (now - refStart) / 1000
      if (elapsed <= 0) return 0
      const rate = this.progress.assetsDownloaded / elapsed
      if (rate <= 0) return 0
      return Math.round(remainingAssets / rate)
    }

    return 0
  }
}

export class ProgressTracker {
  private trackers = new Map<string, TaskTracker>()

  createTracker(taskId: string): TaskTracker {
    const tracker = new TaskTracker()
    this.trackers.set(taskId, tracker)
    return tracker
  }

  getTracker(taskId: string): TaskTracker | undefined {
    return this.trackers.get(taskId)
  }

  getSpeed(taskId: string): number {
    return this.trackers.get(taskId)?.getSpeed() || 0
  }

  getEta(taskId: string): number {
    return this.trackers.get(taskId)?.getEta() || 0
  }

  remove(taskId: string): void {
    this.trackers.delete(taskId)
  }

  clear(): void {
    this.trackers.clear()
  }
}
