// ============================================================
// Download Manager — Queue-based orchestrator for downloading
// forum posts. Concurrent downloads, persistent queue, events.
// ============================================================

import { EventEmitter } from 'events'
import { DiscordClient } from '../discord/api-client'
import { FileDownloader } from './file-downloader'
import { ProgressTracker, type PostProgress } from './progress-tracker'
import { Deduplicator } from './deduplicator'
import { CacheManager, type SyncCheckResult } from '../storage/cache-manager'
import { MarkdownGenerator } from '../export/markdown-generator'
import { HtmlGenerator } from '../export/html-generator'
import { JsonExporter } from '../export/json-exporter'
import { FolderBuilder } from '../export/folder-builder'
import { IndexGenerator } from '../export/index-generator'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
import * as db from '../storage/database'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import Epub from 'epub-gen-memory'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type {
  DiscordThread,
  DiscordMessage,
  DownloadTask,
  DownloadStatus,
  ExportOptions,
  ContentSelection,
  ForumTag
} from '../discord/types'

export interface DownloadManagerEvents {
  'task-started': (task: DownloadTask) => void
  'task-progress': (taskId: string, progress: PostProgress) => void
  'task-completed': (task: DownloadTask) => void
  'task-error': (taskId: string, error: string) => void
  'task-cancelled': (taskId: string) => void
  'queue-updated': (queue: DownloadTask[]) => void
  'all-completed': () => void
}

export class DownloadManager extends EventEmitter {
  private client: DiscordClient
  private fileDownloader: FileDownloader
  private deduplicator: Deduplicator
  private progressTracker: ProgressTracker
  private mdParser: DiscordMarkdownParser

  private activeTasks = new Map<string, DownloadTask>()
  private concurrency: number
  private running = 0
  private paused = false
  private exportOptions: ExportOptions
  private contentSelection: ContentSelection

  constructor(
    client: DiscordClient,
    options: {
      concurrency?: number
      exportOptions: ExportOptions
      contentSelection: ContentSelection
    }
  ) {
    super()
    this.client = client
    this.concurrency = options.concurrency || 2
    this.exportOptions = options.exportOptions
    this.contentSelection = options.contentSelection
    this.fileDownloader = new FileDownloader()
    this.deduplicator = new Deduplicator()
    this.progressTracker = new ProgressTracker()
    this.mdParser = new DiscordMarkdownParser({
      resolveUser: async (userId: string) => {
        // Try DB cache first
        const cached = db.getCachedUser(userId)
        if (cached) return cached
        try {
          const user = await this.client.getUser(userId)
          db.upsertCachedUser(user)
          return user
        } catch {
          return null
        }
      }
    })
  }

  setConcurrency(n: number): void {
    this.concurrency = n
    if (!this.paused) this.processQueue()
  }

  updateOptions(exportOptions: ExportOptions, contentSelection: ContentSelection): void {
    this.exportOptions = exportOptions
    this.contentSelection = contentSelection
  }

  // ----------- Queue Management -----------

  async addToQueue(
    threads: { thread: DiscordThread; tags: ForumTag[] }[],
    guildName: string,
    channelName: string
  ): Promise<string[]> {
    const taskIds: string[] = []

    for (const { thread } of threads) {
      const queueId = db.addToQueue({
        thread_id: thread.id,
        guild_id: thread.guild_id,
        channel_id: thread.parent_id,
        guild_name: guildName,
        channel_name: channelName,
        thread_name: thread.name,
        priority: 0,
        export_options: JSON.stringify(this.exportOptions)
      })

      const task: DownloadTask = {
        id: queueId.toString(),
        threadId: thread.id,
        guildId: thread.guild_id,
        channelId: thread.parent_id,
        guildName,
        channelName,
        threadName: thread.name,
        priority: 0,
        status: 'queued',
        progress: {
          phase: 'fetching',
          messagesTotal: 0,
          messagesFetched: 0,
          assetsTotal: 0,
          assetsDownloaded: 0,
          bytesTotal: 0,
          bytesDownloaded: 0,
          speed: 0,
          eta: 0
        },
        createdAt: new Date().toISOString(),
        retryCount: 0
      }

      this.activeTasks.set(task.id, task)
      taskIds.push(task.id)
    }

    this.emit('queue-updated', this.getQueue())
    this.processQueue()
    return taskIds
  }

  private async processQueue(): Promise<void> {
    if (this.paused) return

    while (this.running < this.concurrency) {
      const nextTask = this.getNextTask()
      if (!nextTask) break

      this.running++
      nextTask.status = 'downloading'
      nextTask.startedAt = new Date().toISOString()
      db.updateQueueStatus(parseInt(nextTask.id), 'downloading')
      this.emit('task-started', nextTask)

      this.processTask(nextTask)
        .then(() => {
          nextTask.status = 'done'
          nextTask.completedAt = new Date().toISOString()
          db.updateQueueStatus(parseInt(nextTask.id), 'done')
          this.emit('task-completed', nextTask)
        })
        .catch((error: Error) => {
          nextTask.status = 'error'
          nextTask.errorMessage = error.message
          db.updateQueueStatus(parseInt(nextTask.id), 'error', error.message)
          this.emit('task-error', nextTask.id, error.message)

          // Persist an error entry in download history for diagnostics.
          try {
            db.recordDownloadHistory({
              queue_id: parseInt(nextTask.id) || undefined,
              thread_id: nextTask.threadId,
              guild_id: nextTask.guildId,
              channel_id: nextTask.channelId,
              guild_name: nextTask.guildName,
              channel_name: nextTask.channelName,
              thread_name: nextTask.threadName,
              status: 'error',
              error_message: error.message,
              started_at: nextTask.startedAt || null,
              completed_at: new Date().toISOString()
            })
          } catch (e) {
            console.warn('Failed to record history for errored task:', (e as Error).message)
          }
        })
        .finally(() => {
          this.running--
          this.emit('queue-updated', this.getQueue())
          if (this.running === 0 && !this.getNextTask()) {
            this.emit('all-completed')
          } else {
            this.processQueue()
          }
        })
    }
  }

  private getNextTask(): DownloadTask | null {
    for (const task of this.activeTasks.values()) {
      if (task.status === 'queued') return task
    }
    return null
  }

  private async processTask(task: DownloadTask): Promise<void> {
    const progress = this.progressTracker.createTracker(task.id)
    // Record a local start time for history auditing. We avoid overwriting
    // the outer `startedAt` if already populated by the manager.
    const startedAt = task.startedAt || new Date().toISOString()
    task.startedAt = startedAt

    // Phase 1: Fetch all messages (with Delta Sync)
    progress.update({ phase: 'fetching' })
    this.emitProgress(task.id, progress.get())

    const cachedPost = db.getCachedPost(task.threadId)
    const afterId = cachedPost?.last_message_id || undefined

    const newMessages = await this.client.getAllThreadMessages(task.threadId, (count) => {
      progress.update({ messagesFetched: count })
      this.emitProgress(task.id, progress.get())
    })

    let messages = newMessages
    if (messages.length === 0) {
      throw new Error('No messages found in thread')
    }

    progress.update({
      messagesTotal: messages.length,
      messagesFetched: messages.length
    })

    // Build folder structure
    const folderBuilder = new FolderBuilder(this.exportOptions)
    const postDir = folderBuilder.createPostDirectory(
      task.guildName,
      task.channelName,
      task.threadName,
      messages[0]?.timestamp
    )

    // Phase 2: Download assets
    progress.update({ phase: 'downloading_assets' })
    this.emitProgress(task.id, progress.get())

    let totalSize = 0
    const assetMap = new Map<string, string>() // original URL -> local relative path

    // Count total assets (all attachments)
    let totalAssets = 0
    for (const msg of messages) {
      totalAssets += msg.attachments.length
    }
    progress.update({ assetsTotal: totalAssets })

    // Download attachments
    let assetsDownloaded = 0
    for (const msg of messages) {
      for (const attachment of msg.attachments) {
        if (task.status === 'cancelled') return

        const ext = path.extname(attachment.filename).toLowerCase()
        const isImage = attachment.content_type?.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)
        const isVideo = attachment.content_type?.startsWith('video/') || ['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)
        const isFile = !isImage && !isVideo

        // Logic revised to comply with 'download all' mandate:
        // We still categorize for subfolder organization, but we ensure broad extension support.
        if (isImage && !this.contentSelection.images) continue
        if (isVideo && !this.contentSelection.videos) continue
        if (isFile && !this.contentSelection.files) continue

        try {
          // Check dedup
          const dedupResult = this.deduplicator.check(attachment.id, attachment.size)
          if (dedupResult) {
            assetMap.set(attachment.url, dedupResult)
            assetsDownloaded++
            progress.update({ assetsDownloaded })
            this.emitProgress(task.id, progress.get())
            continue
          }

          const subDir = isImage ? 'images' : isVideo ? 'videos' : 'files'
          const { localPath, size } = await this.fileDownloader.download(
            attachment.url,
            postDir,
            subDir,
            attachment.filename,
            (bytes: number) => {
              progress.update({
                bytesDownloaded: progress.get().bytesDownloaded + bytes,
                currentFile: attachment.filename
              })
              this.emitProgress(task.id, progress.get())
            }
          )

          const relativePath = `./assets/${subDir}/${path.basename(localPath)}`
          assetMap.set(attachment.url, relativePath)
          assetMap.set(attachment.proxy_url, relativePath)

          // Issue #4: Convert GIF to PNG for better compatibility while keeping original
          if (ext === '.gif') {
            try {
              const pngFilename = `${path.basename(localPath, '.gif')}.png`
              const pngLocalPath = path.join(path.dirname(localPath), pngFilename)
              await sharp(localPath).png().toFile(pngLocalPath)
              // Store PNG as additional asset reference
              assetMap.set(`${attachment.url}_png`, `./assets/${subDir}/${pngFilename}`)
            } catch (err) {
              console.error('GIF to PNG conversion failed:', err)
            }
          }

          totalSize += size

          // Record in dedup and cache
          this.deduplicator.record(attachment.id, attachment.size, relativePath)
          db.upsertCachedFile({
            file_id: attachment.id,
            message_id: msg.id,
            original_url: attachment.url,
            local_path: localPath,
            file_hash: CacheManager.computeFileHash(localPath),
            file_size: size,
            mime_type: attachment.content_type || 'application/octet-stream',
            filename: attachment.filename,
            downloaded_at: new Date().toISOString(),
            still_valid: true
          })
        } catch (error) {
          console.error(`Failed to download ${attachment.filename}:`, error)
        }

        assetsDownloaded++
        progress.update({ assetsDownloaded })
        this.emitProgress(task.id, progress.get())
      }
    }

    // Phase 3: Export
    progress.update({ phase: 'exporting' })
    this.emitProgress(task.id, progress.get())

    // Get thread info
    let thread: DiscordThread
    try {
      thread = (await this.client.getChannel(task.threadId)) as unknown as DiscordThread
    } catch {
      thread = {
        id: task.threadId,
        guild_id: task.guildId,
        parent_id: task.channelId,
        owner_id: messages[0]?.author?.id || '',
        name: task.threadName,
        type: 11,
        last_message_id: messages[messages.length - 1]?.id || null,
        message_count: messages.length,
        member_count: 0,
        total_message_sent: messages.length,
        applied_tags: [],
        thread_metadata: { archived: false, auto_archive_duration: 4320, archive_timestamp: '', locked: false },
        created_timestamp: messages[0]?.timestamp || ''
      }
    }

    // Generate exports
    const mdGenerator = new MarkdownGenerator(this.mdParser, assetMap)

    if (this.exportOptions.formats.includes('markdown')) {
      await mdGenerator.generatePostMarkdown(thread, messages, task.guildName, task.channelName, postDir)
      if (this.contentSelection.replies && messages.length > 1) {
        await mdGenerator.generateThreadMarkdown(thread, messages, task.guildName, task.channelName, postDir)
      }
    }

    if (this.exportOptions.formats.includes('json')) {
      new JsonExporter().exportThread(thread, messages, postDir)
    }

    if (this.exportOptions.formats.includes('html')) {
      await new HtmlGenerator(assetMap).generatePostHtml(thread, messages, task.guildName, task.channelName, postDir)
    }

    // Premium Exports (PDF with Unicode Fix)
    if (this.exportOptions.formats.includes('pdf')) {
      try {
        const pdfDoc = await PDFDocument.create()
        pdfDoc.registerFontkit(fontkit)

        let customFont: any;
        let isCustomFontLoaded = false;
        try {
          // Cross-environment font path logic (Dev vs Prod/ASAR)
          const isDev = !app.isPackaged;
          const fontPath = isDev
            ? path.join(process.cwd(), 'resources', 'fonts', 'Roboto-Regular.ttf')
            : path.join(process.resourcesPath, 'fonts', 'Roboto-Regular.ttf');

          if (fs.existsSync(fontPath)) {
            const fontBytes = fs.readFileSync(fontPath);
            customFont = await pdfDoc.embedFont(new Uint8Array(fontBytes));
            isCustomFontLoaded = true;
          } else {
            console.warn('Font file not found at:', fontPath);
          }
        } catch (fontErr) {
          console.error('Critical: Custom font embedding failed. Fallback to Helvetica initiated.', fontErr);
        }

        // Fallback to standard font if custom loading failed
        if (!isCustomFontLoaded) {
          customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }

        let page = pdfDoc.addPage()
        const { width, height } = page.getSize()
        const margin = 50
        const fontSize = 11

        // Function to clean text based on font capabilities
        const cleanText = (text: string) => {
          if (!text) return '';
          // If we have custom font, we still remove extremely rare chars that might not be in Roboto
          // If we have Helvetica, we MUST remove everything non-WinAnsi to avoid crash (Issue #1)
          if (!isCustomFontLoaded) {
            return text.replace(/[^\x00-\x7F]/g, '?');
          }
          // With Roboto, we are much safer, but still limit to basic plane for pdf-lib stability
          return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
        };

        // Function to draw an image and adjust yOffset
        const drawImage = async (imgUrl: string) => {
          const localRelPath = assetMap.get(imgUrl);
          if (!localRelPath) return;
          const imgPath = path.join(postDir, localRelPath);
          if (!fs.existsSync(imgPath)) return;

          try {
            const bytes = fs.readFileSync(imgPath);
            const ext = path.extname(imgPath).toLowerCase();
            let image;

            // Convert to PNG/JPG buffer if needed or use sharp for optimal PDF size
            const optimized = await sharp(bytes).resize({ width: 400, withoutEnlargement: true }).toBuffer();

            if (ext === '.png') image = await pdfDoc.embedPng(optimized);
            else if (['.jpg', '.jpeg'].includes(ext)) image = await pdfDoc.embedJpg(optimized);
            else {
              // Try to convert to PNG if it's gif/webp
              const pngBuffer = await sharp(bytes).png().toBuffer();
              image = await pdfDoc.embedPng(pngBuffer);
            }

            const dims = image.scale(0.8);
            if (yOffset - dims.height < margin) {
              page = pdfDoc.addPage();
              yOffset = height - margin;
            }
            page.drawImage(image, { x: margin, y: yOffset - dims.height, width: dims.width, height: dims.height });
            yOffset -= dims.height + 10;
          } catch (e) {
            console.error('Failed to embed image in PDF:', e);
          }
        };

        // Function to draw generic attachment reference in PDF
        const drawAttachmentRef = async (filename: string, size: number) => {
          const text = `📎 [Archivo Adjunto] ${filename} (${cleanText(this.formatSize(size))})`;
          if (yOffset - 20 < margin) {
            page = pdfDoc.addPage();
            yOffset = height - margin;
          }
          page.drawText(text, {
            x: margin,
            y: yOffset,
            size: 9,
            font: customFont,
            color: rgb(0.3, 0.3, 0.8)
          });
          yOffset -= 15;
        };

        const safeThreadName = cleanText(thread.name || 'Thread');
        page.drawText(safeThreadName, { x: margin, y: height - 40, size: 18, font: customFont })

        let yOffset = height - 70;
        for (const msg of messages) {
          // Add author and date
          const header = `${msg.author.username} (${new Date(msg.timestamp).toLocaleString()}):`;
          const safeHeader = cleanText(header);
          if (yOffset < margin + 20) { page = pdfDoc.addPage(); yOffset = height - margin; }
          page.drawText(safeHeader, { x: margin, y: yOffset, size: 10, font: customFont, color: rgb(0.4, 0.4, 0.4) });
          yOffset -= 15;

          const content = (msg.content || '').trim();
          if (content) {
            const lines = content.split('\n');
            for (const rawLine of lines) {
              const safeLine = cleanText(rawLine);
              const words = safeLine.split(' ');
              let currentLine = '';
              for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const textWidth = (customFont as any).widthOfTextAtSize(testLine, fontSize);
                if (textWidth > width - 2 * margin) {
                  if (yOffset < margin) { page = pdfDoc.addPage(); yOffset = height - margin; }
                  page.drawText(currentLine, { x: margin, y: yOffset, size: fontSize, font: customFont });
                  yOffset -= fontSize + 4;
                  currentLine = word;
                } else {
                  currentLine = testLine;
                }
              }
              if (currentLine) {
                if (yOffset < margin) { page = pdfDoc.addPage(); yOffset = height - margin; }
                page.drawText(currentLine, { x: margin, y: yOffset, size: fontSize, font: customFont });
                yOffset -= fontSize + 6;
              }
            }
          }

          // Attachments (Images and Generic Files)
          for (const attachment of msg.attachments) {
            const ext = path.extname(attachment.filename).toLowerCase()
            const isImage = attachment.content_type?.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)

            if (isImage && assetMap.has(attachment.url)) {
              await drawImage(attachment.url);
            } else if (assetMap.has(attachment.url)) {
              // List as attachment link for PDF
              await drawAttachmentRef(attachment.filename, attachment.size);
            }
          }
          yOffset -= 10;
        }

        const pdfBytes = await pdfDoc.save()
        fs.writeFileSync(path.join(postDir, 'export.pdf'), pdfBytes)
      } catch (pdfErr) {
        console.error('Fatal: PDF generation crashed despite sanitization:', pdfErr);
      }
    }

    if (this.exportOptions.formats.includes('epub')) {
      const epubConstructor = (Epub as any).default || Epub;
      const epubData = await epubConstructor(
        { title: thread.name || 'Thread Export', author: messages[0]?.author?.username || 'System' },
        [{ title: 'Main', content: messages.map(m => `<p><b>${m.author.username}</b>: ${m.content || ''}</p>`).join('') }]
      )
      fs.writeFileSync(path.join(postDir, 'export.epub'), Buffer.from(epubData as any))
    }

    CacheManager.recordPostSync(thread, messages, postDir, totalSize)
    if (this.exportOptions.includeToc) {
      const indexDir = folderBuilder.getForumDirectory(task.guildName, task.channelName)
      IndexGenerator.generateIndex(indexDir, task.channelName, db.getCachedPostsByChannel(task.channelId))
    }

    // Persist a lightweight download history record for post-export auditing.
    try {
      db.recordDownloadHistory({
        queue_id: parseInt(task.id) || undefined,
        thread_id: task.threadId,
        guild_id: task.guildId,
        channel_id: task.channelId,
        guild_name: task.guildName,
        channel_name: task.channelName,
        thread_name: task.threadName,
        status: 'done',
        files_count: totalAssets || 0,
        total_bytes: totalSize || 0,
        download_path: postDir,
        started_at: startedAt,
        completed_at: new Date().toISOString()
      })
    } catch (e) {
      console.warn('recordDownloadHistory failed:', (e as Error).message)
    }

    progress.update({ phase: 'done' })
    this.emitProgress(task.id, progress.get())
  }

  private emitProgress(taskId: string, progress: PostProgress): void {
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.progress = {
        ...progress,
        speed: this.progressTracker.getSpeed(taskId),
        eta: this.progressTracker.getEta(taskId)
      }
    }
    this.emit('task-progress', taskId, progress)
  }

  getQueue(): DownloadTask[] { return Array.from(this.activeTasks.values()) }
  pauseAll(): void { this.paused = true }
  resumeAll(): void { this.paused = false; this.processQueue() }
  cancelTask(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.status = 'cancelled'
      db.updateQueueStatus(parseInt(taskId), 'cancelled')
      this.emit('task-cancelled', taskId)
      this.emit('queue-updated', this.getQueue())
    }
  }

  cancelAll(): void {
    for (const task of this.activeTasks.values()) {
      if (task.status === 'queued' || task.status === 'downloading') {
        task.status = 'cancelled'
        db.updateQueueStatus(parseInt(task.id), 'cancelled')
      }
    }
    this.emit('queue-updated', this.getQueue())
  }

  clearCompleted(): void {
    for (const [id, task] of this.activeTasks.entries()) {
      if (task.status === 'done' || task.status === 'cancelled' || task.status === 'error') {
        this.activeTasks.delete(id)
      }
    }
    this.emit('queue-updated', this.getQueue())
  }

  async retryTask(taskId: string): Promise<void> {
    const task = this.activeTasks.get(taskId)
    if (task && task.status === 'error') {
      task.status = 'queued'
      task.retryCount++
      db.updateQueueStatus(parseInt(taskId), 'queued')
      db.incrementRetryCount(parseInt(taskId))
      this.emit('queue-updated', this.getQueue())
      this.processQueue()
    }
  }
  getActiveCount(): number { return this.running }
  destroy(): void {
    this.paused = true
    this.activeTasks.clear()
    this.removeAllListeners()
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
  }
}
