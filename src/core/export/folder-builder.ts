// ============================================================
// Folder Builder — Creates the organized output directory
// structure with sanitized names and collision handling.
// ============================================================

import fs from 'fs'
import path from 'path'
import sanitize from 'sanitize-filename'
import type { ExportOptions } from '../discord/types'

export class FolderBuilder {
  private options: ExportOptions

  constructor(options: ExportOptions) {
    this.options = options
  }

  getBaseDir(): string {
    return this.options.outputDir
  }

  getServerDirectory(guildName: string): string {
    const safeName = this.sanitizeDirName(guildName)
    const dir = path.join(this.options.outputDir, safeName)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  getForumDirectory(guildName: string, channelName: string): string {
    const serverDir = this.getServerDirectory(guildName)
    const safeName = this.sanitizeDirName(channelName)
    const dir = path.join(serverDir, safeName)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  createPostDirectory(
    guildName: string,
    channelName: string,
    threadName: string,
    createdAt?: string
  ): string {
    const forumDir = this.getForumDirectory(guildName, channelName)

    // Count existing posts for numbering
    const existing = fs.existsSync(forumDir) ? fs.readdirSync(forumDir).filter(f => {
      return fs.statSync(path.join(forumDir, f)).isDirectory() && !f.startsWith('_')
    }) : []

    const num = (existing.length + 1).toString().padStart(3, '0')
    const date = createdAt ? this.formatDate(createdAt) : this.formatDate(new Date().toISOString())
    const title = this.sanitizeDirName(threadName)

    // Apply naming pattern
    let dirName = this.options.namingPattern
      .replace('{num}', num)
      .replace('{date}', date)
      .replace('{title}', title)

    // Truncate if needed
    if (dirName.length > this.options.maxFilenameLength) {
      dirName = dirName.substring(0, this.options.maxFilenameLength).replace(/[\s._-]+$/, '')
    }

    let postDir = path.join(forumDir, dirName)

    // Handle collision
    if (fs.existsSync(postDir)) {
      let counter = 2
      while (fs.existsSync(`${postDir}_${counter}`)) {
        counter++
      }
      postDir = `${postDir}_${counter}`
    }

    // Only create the post directory — subdirectories are created on-demand
    // by FileDownloader and MarkdownGenerator when actual content exists
    fs.mkdirSync(postDir, { recursive: true })

    return postDir
  }

  sanitizeDirName(name: string): string {
    // Use robust sanitization for Windows/POSIX compatibility
    let safe = sanitize(name, { replacement: '_' })

    // Windows specifically hates leading/trailing dots or spaces and certain names
    safe = safe.replace(/^[. ]+|[. ]+$/g, '').trim()

    if (safe.length > this.options.maxFilenameLength) {
      safe = safe.substring(0, this.options.maxFilenameLength).trim()
    }

    if (!safe) safe = 'unnamed'
    return safe
  }


  private formatDate(isoDate: string): string {
    try {
      const d = new Date(isoDate)
      const y = d.getFullYear()
      const m = (d.getMonth() + 1).toString().padStart(2, '0')
      const day = d.getDate().toString().padStart(2, '0')
      return `${y}-${m}-${day}`
    } catch {
      return 'unknown-date'
    }
  }

  // Check if path would exceed Windows MAX_PATH
  static checkPathLength(filePath: string): boolean {
    return filePath.length < 250 // Leave margin
  }
}
