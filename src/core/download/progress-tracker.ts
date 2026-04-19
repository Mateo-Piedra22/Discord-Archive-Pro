// ============================================================
// Progress Tracker — Multi-level progress tracking with
// speed calculation and ETA estimation.
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

class TaskTracker {
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

  private bytesHistory: { time: number; bytes: number }[] = []

  update(partial: Partial<PostProgress>): void {
    Object.assign(this.progress, partial)
    if (partial.bytesDownloaded !== undefined) {
      this.bytesHistory.push({ time: Date.now(), bytes: partial.bytesDownloaded })
      // Keep last 20 entries for moving average
      if (this.bytesHistory.length > 20) {
        this.bytesHistory = this.bytesHistory.slice(-20)
      }
    }
  }

  get(): PostProgress {
    return { ...this.progress }
  }

  getSpeed(): number {
    if (this.bytesHistory.length < 2) return 0
    const first = this.bytesHistory[0]
    const last = this.bytesHistory[this.bytesHistory.length - 1]
    const elapsed = (last.time - first.time) / 1000
    if (elapsed <= 0) return 0
    return (last.bytes - first.bytes) / elapsed
  }

  getEta(): number {
    const speed = this.getSpeed()
    if (speed <= 0) return 0
    const remaining = this.progress.bytesTotal - this.progress.bytesDownloaded
    if (remaining <= 0) return 0
    return remaining / speed
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
