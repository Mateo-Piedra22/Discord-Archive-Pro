// ============================================================
// Deduplicator — SHA-256 hash-based deduplication to avoid
// re-downloading the same files across posts.
// ============================================================

import * as db from '../storage/database'

export class Deduplicator {
  // In-memory lookup for current session
  private sessionMap = new Map<string, string>() // fileId -> localRelativePath

  check(fileId: string, fileSize: number): string | null {
    // Check session cache first
    const sessionHit = this.sessionMap.get(fileId)
    if (sessionHit) return sessionHit

    // Check database
    const cached = db.getCachedFile(fileId)
    if (cached && cached.still_valid) {
      // Verify local file still exists
      const fs = require('fs')
      if (fs.existsSync(cached.local_path)) {
        return cached.local_path
      }
    }

    return null
  }

  record(fileId: string, fileSize: number, relativePath: string): void {
    this.sessionMap.set(fileId, relativePath)
  }

  getStats(): { totalDeduplicated: number; bytesSaved: number } {
    return {
      totalDeduplicated: this.sessionMap.size,
      bytesSaved: 0 // Would need size tracking for accurate number
    }
  }

  clear(): void {
    this.sessionMap.clear()
  }
}
