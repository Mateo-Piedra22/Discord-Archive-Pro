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

  update(partial: Partial<PostProgress>): void {
    Object.assign(this.progress, partial)
    if (partial.bytesDownloaded !== undefined) {
      this.samples.push({ time: Date.now(), bytes: partial.bytesDownloaded })
      if (this.samples.length > 20) this.samples.shift()
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
    if (elapsed <= 0) return 0
    return Math.max(0, (last.bytes - first.bytes) / elapsed)
  }

  getEta(): number {
    const speed = this.getSpeed()
    if (speed <= 0) return 0
    const remaining = this.progress.bytesTotal - this.progress.bytesDownloaded
    if (remaining <= 0) return 0
    return Math.round(remaining / speed)
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
