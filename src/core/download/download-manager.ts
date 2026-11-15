// ============================================================
// Gestor de descargas — orquestador de cola con concurrencia,
// cancelación real, deduplicación y export multi-formato.
// ============================================================

import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { DiscordClient } from '../discord/api-client'
import { ENDPOINTS } from '../discord/endpoints'
import { FileDownloader } from './file-downloader'
import { ProgressTracker, type PostProgress, type TaskTracker } from './progress-tracker'
import { Deduplicator } from './deduplicator'
import { CacheManager } from '../storage/cache-manager'
import { MarkdownGenerator } from '../export/markdown-generator'
import { HtmlGenerator } from '../export/html-generator'
import { JsonExporter } from '../export/json-exporter'
import { FolderBuilder } from '../export/folder-builder'
import { IndexGenerator } from '../export/index-generator'
import { PdfGenerator } from '../export/pdf-generator'
import { buildEpub } from '../export/epub-generator'
import { DiscordMarkdownParser } from '../discord/markdown-parser'
import * as db from '../storage/database'
import type {
  CachedFileRecord,
  ContentSelection,
  DiscordMessage,
  DiscordThread,
  DownloadTask,
  ExportOptions,
  ForumTag,
  PersistedQueueItem
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

interface PlannedAsset {
  url: string
  aliases: string[]
  filename: string
  subDir: 'images' | 'videos' | 'files'
  fileId: string
  messageId: string
  size: number
}

interface IndexTarget {
  channelName: string
  channelId: string
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.avi', '.mkv']

function emptyProgress(): PostProgress {
  return {
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
}

function kindOf(contentType: string | undefined, filename: string): 'images' | 'videos' | 'files' {
  const ext = path.extname(filename).toLowerCase()
  if ((contentType || '').startsWith('image/') || IMAGE_EXT.includes(ext)) return 'images'
  if ((contentType || '').startsWith('video/') || VIDEO_EXT.includes(ext)) return 'videos'
  return 'files'
}

export class DownloadManager extends EventEmitter {
  private static readonly MAX_FINISHED_TASKS = 250
  private static readonly ASSET_CONCURRENCY = 3

  private client: DiscordClient
  private fileDownloader = new FileDownloader()
  private deduplicator = new Deduplicator()
  private progressTracker = new ProgressTracker()
  private mdParser: DiscordMarkdownParser

  private activeTasks = new Map<string, DownloadTask>()
  private controllers = new Map<string, AbortController>()
  private lastProgressEmit = new Map<string, number>()

  private concurrency: number
  private running = 0
  private paused = false
  private destroyed = false

  private exportOptions: ExportOptions
  private contentSelection: ContentSelection

  private indexTimer: NodeJS.Timeout | null = null
  private pendingIndexes = new Map<string, IndexTarget>()
  /** Tags reales (con nombre) por taskId; el hilo solo trae IDs. */
  private taskTags = new Map<string, ForumTag[]>()

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
    this.concurrency = Math.min(10, Math.max(1, options.concurrency || 2))
    this.exportOptions = options.exportOptions
    this.contentSelection = options.contentSelection
    this.mdParser = new DiscordMarkdownParser({
      resolveUser: async (userId: string) => {
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

  // ----------- Configuración -----------

  setClient(client: DiscordClient): void {
    this.client = client
  }

  setConcurrency(n: number): void {
    this.concurrency = Math.min(10, Math.max(1, n))
    if (!this.paused) void this.processQueue()
  }

  updateOptions(exportOptions: ExportOptions, contentSelection: ContentSelection): void {
    this.exportOptions = exportOptions
    this.contentSelection = contentSelection
  }

  // ----------- Cola -----------

  /** Reconstruye la cola persistida al arrancar (queda en pausa). */
  restoreQueue(items: PersistedQueueItem[]): void {
    for (const item of items) {
      const id = String(item.id)
      if (this.activeTasks.has(id)) continue
      const cached = db.getCachedPost(item.thread_id)
      this.activeTasks.set(id, {
        id,
        threadId: item.thread_id,
        guildId: item.guild_id,
        channelId: item.channel_id,
        guildName: item.guild_name || '',
        channelName: item.channel_name || '',
        threadName: item.thread_name || '',
        priority: item.priority || 0,
        status: 'paused',
        progress: emptyProgress(),
        downloadPath: cached?.download_path || undefined,
        createdAt: item.created_at,
        retryCount: item.retry_count || 0
      })
      db.updateQueueStatus(item.id, 'paused')
    }
    this.emit('queue-updated', this.getQueue())
  }

  async addToQueue(
    threads: { thread: DiscordThread; tags: ForumTag[] }[],
    guildName: string,
    channelName: string
  ): Promise<string[]> {
    const taskIds: string[] = []

    for (const { thread, tags } of threads) {
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

      const id = String(queueId)
      if (tags?.length) this.taskTags.set(id, tags)
      if (this.activeTasks.has(id)) {
        taskIds.push(id)
        continue
      }

      const cached = db.getCachedPost(thread.id)
      this.activeTasks.set(id, {
        id,
        threadId: thread.id,
        guildId: thread.guild_id,
        channelId: thread.parent_id,
        guildName,
        channelName,
        threadName: thread.name,
        priority: 0,
        status: 'queued',
        progress: emptyProgress(),
        downloadPath: cached?.download_path || undefined,
        createdAt: new Date().toISOString(),
        retryCount: 0
      })
      taskIds.push(id)
    }

    this.emit('queue-updated', this.getQueue())
    void this.processQueue()
    return taskIds
  }

  private async processQueue(): Promise<void> {
    if (this.paused || this.destroyed) return

    while (this.running < this.concurrency) {
      const task = this.getNextQueued()
      if (!task) break

      this.running++
      task.status = 'downloading'
      task.startedAt = new Date().toISOString()
      db.updateQueueStatus(parseInt(task.id, 10), 'downloading')
      this.emit('task-started', task)
      this.emit('queue-updated', this.getQueue())

      const controller = new AbortController()
      this.controllers.set(task.id, controller)

      this.processTask(task, controller.signal)
        .then(() => {
          // Cancelar NUNCA debe terminar como "done".
          if (task.status === 'cancelled' || controller.signal.aborted) {
            task.status = 'cancelled'
            task.completedAt = new Date().toISOString()
            db.updateQueueStatus(parseInt(task.id, 10), 'cancelled')
            this.emit('task-cancelled', task.id)
            return
          }
          task.status = 'done'
          task.completedAt = new Date().toISOString()
          db.updateQueueStatus(parseInt(task.id, 10), 'done')
          this.emit('task-completed', task)
        })
        .catch((error: Error) => {
          if (
            task.status === 'cancelled' ||
            controller.signal.aborted ||
            error.message === 'cancelled' ||
            error.message === 'Descarga cancelada' ||
            error.message === 'Operación cancelada'
          ) {
            task.status = 'cancelled'
            task.completedAt = new Date().toISOString()
            db.updateQueueStatus(parseInt(task.id, 10), 'cancelled')
            this.emit('task-cancelled', task.id)
            return
          }
          task.status = 'error'
          task.completedAt = new Date().toISOString()
          task.errorMessage = error.message
          db.updateQueueStatus(parseInt(task.id, 10), 'error', error.message)
          this.emit('task-error', task.id, error.message)
          db.recordDownloadHistory({
            queue_id: parseInt(task.id, 10) || undefined,
            thread_id: task.threadId,
            guild_id: task.guildId,
            channel_id: task.channelId,
            guild_name: task.guildName,
            channel_name: task.channelName,
            thread_name: task.threadName,
            status: 'error',
            error_message: error.message,
            started_at: task.startedAt || null,
            completed_at: new Date().toISOString()
          })
        })
        .finally(() => {
          this.running--
          this.controllers.delete(task.id)
          this.pruneFinishedTasks()
          this.emit('queue-updated', this.getQueue())
          if (this.running === 0 && !this.getNextQueued()) {
            void this.flushIndexes()
            this.emit('all-completed')
          } else {
            void this.processQueue()
          }
        })
    }
  }

  private getNextQueued(): DownloadTask | null {
    let best: DownloadTask | null = null
    let bestPriority = -Infinity
    let bestTime = Infinity

    for (const task of this.activeTasks.values()) {
      if (task.status !== 'queued') continue
      const priority = task.priority ?? 0
      const parsedTime = task.createdAt ? Date.parse(task.createdAt) : NaN
      const time = Number.isNaN(parsedTime) ? Infinity : parsedTime

      if (!best || priority > bestPriority || (priority === bestPriority && time < bestTime)) {
        best = task
        bestPriority = priority
        bestTime = time
      }
    }
    return best
  }

  // ----------- Procesamiento -----------

  private async processTask(task: DownloadTask, signal: AbortSignal): Promise<void> {
    const progress = this.progressTracker.createTracker(task.id)
    const startedAt = task.startedAt || new Date().toISOString()
    task.startedAt = startedAt

    const throwIfCancelled = (): void => {
      if (signal.aborted || task.status === 'cancelled') throw new Error('cancelled')
    }

    try {
      progress.update({ phase: 'fetching' })
      this.emitProgress(task.id, progress.get())

      const channel = await this.client.getChannel(task.threadId)
      throwIfCancelled()

      // --- Delta real: si no cambió nada y el export existe, no se toca nada ---
      const cached = db.getCachedPost(task.threadId)
      if (this.exportOptions.syncMode === 'quick' && cached?.download_path && fs.existsSync(cached.download_path)) {
        const lastMessageId = channel.last_message_id || null
        const messageCount = channel.message_count ?? cached.message_count
        if (
          (cached.last_message_id || '') === (lastMessageId || '') &&
          cached.message_count === messageCount &&
          cached.sync_status === 'synced'
        ) {
          task.downloadPath = cached.download_path
          progress.update({ phase: 'done', messagesTotal: messageCount, messagesFetched: messageCount })
          this.emitProgress(task.id, progress.get())
          return
        }
      }

      // --- Mensajes ---
      const cancellationToken = { cancelled: signal.aborted, signal }
      const onAbort = (): void => {
        cancellationToken.cancelled = true
      }
      signal.addEventListener('abort', onAbort, { once: true })

      let messages: DiscordMessage[]
      try {
        messages = await this.client.getAllThreadMessages(
          task.threadId,
          (count) => {
            progress.update({ messagesFetched: count })
            this.emitProgress(task.id, progress.get())
          },
          cancellationToken
        )
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
      throwIfCancelled()

      if (messages.length === 0) throw new Error('El hilo no contiene mensajes')

      progress.update({ messagesTotal: messages.length, messagesFetched: messages.length })

      const thread = this.buildThread(task, channel, messages)

      // --- Directorio (reutiliza el existente para no duplicar 002_, 003_...) ---
      const folderBuilder = new FolderBuilder(this.exportOptions)
      const postDir =
        cached?.download_path && fs.existsSync(cached.download_path)
          ? cached.download_path
          : folderBuilder.createPostDirectory(
              task.guildName,
              task.channelName,
              thread.name,
              messages[0]?.timestamp
            )
      task.downloadPath = postDir

      // --- Recursos ---
      progress.update({ phase: 'downloading_assets' })
      this.emitProgress(task.id, progress.get())

      const { assetMap, totalSize } = await this.downloadAssets(
        messages,
        postDir,
        task.id,
        progress,
        signal
      )
      throwIfCancelled()

      // --- Exportación ---
      progress.update({ phase: 'exporting' })
      this.emitProgress(task.id, progress.get())

      const tags = this.taskTags.get(task.id) || []
      await this.runExports(thread, messages, task, postDir, assetMap, tags)

      CacheManager.recordPostSync(thread, messages, postDir, totalSize)

      if (this.exportOptions.includeToc) {
        this.scheduleIndex(task.guildName, task.channelName, thread.parent_id || task.channelId)
      }

      db.recordDownloadHistory({
        queue_id: parseInt(task.id, 10) || undefined,
        thread_id: task.threadId,
        guild_id: task.guildId,
        channel_id: task.channelId,
        guild_name: task.guildName,
        channel_name: task.channelName,
        thread_name: task.threadName,
        status: 'done',
        files_count: progress.get().assetsTotal,
        total_bytes: totalSize,
        download_path: postDir,
        started_at: startedAt,
        completed_at: new Date().toISOString()
      })

      progress.update({ phase: 'done' })
      this.emitProgress(task.id, progress.get())
    } finally {
      this.progressTracker.remove(task.id)
    }
  }

  private buildThread(
    task: DownloadTask,
    channel: Awaited<ReturnType<DiscordClient['getChannel']>>,
    messages: DiscordMessage[]
  ): DiscordThread {
    const raw = channel as unknown as Partial<DiscordThread>
    if (raw.thread_metadata) {
      return {
        ...(raw as DiscordThread),
        last_message_id: messages[messages.length - 1]?.id || raw.last_message_id || null,
        message_count: messages.length
      }
    }

    // Canal de texto / DM: el propio canal actúa como "hilo".
    return {
      id: channel.id,
      guild_id: channel.guild_id || task.guildId,
      // parent_id ES el canal: así cached_posts.channel_id queda correcto.
      parent_id: channel.id,
      owner_id: messages[0]?.author?.id || '',
      name: channel.name || task.threadName || `Chat ${channel.id}`,
      type: channel.type,
      last_message_id: messages[messages.length - 1]?.id || null,
      message_count: messages.length,
      member_count: 0,
      total_message_sent: messages.length,
      applied_tags: [],
      thread_metadata: {
        archived: false,
        auto_archive_duration: 0,
        archive_timestamp: new Date().toISOString(),
        locked: false
      },
      created_timestamp: messages[0]?.timestamp || new Date().toISOString()
    }
  }

  // ----------- Recursos -----------

  private async downloadAssets(
    messages: DiscordMessage[],
    postDir: string,
    taskId: string,
    progress: TaskTracker,
    signal: AbortSignal
  ): Promise<{ assetMap: Map<string, string>; totalSize: number }> {
    const plan = this.planAssets(messages)
    const assetMap = new Map<string, string>()

    const totalBytes = plan.reduce((sum, asset) => sum + (asset.size || 0), 0)
    progress.update({ assetsTotal: plan.length, bytesTotal: totalBytes })

    if (signal.aborted) throw new Error('cancelled')
    if (plan.length === 0) return { assetMap, totalSize: 0 }

    let totalSize = 0
    let done = 0
    let bytesDownloaded = 0
    let nextIndex = 0
    let cancelled = false
    const cachedRecords: CachedFileRecord[] = []

    const advanceDone = (): void => {
      done++
      progress.update({ assetsDownloaded: done })
      this.emitProgress(taskId, progress.get())
    }

    const worker = async (): Promise<void> => {
      while (true) {
        if (signal.aborted || cancelled) throw new Error('cancelled')

        const index = nextIndex++
        if (index >= plan.length) return
        const asset = plan[index]

        const deduped = await this.deduplicator.checkAsync(asset.fileId, postDir)
        if (signal.aborted || cancelled) throw new Error('cancelled')

        if (deduped) {
          for (const key of [asset.url, ...asset.aliases]) assetMap.set(key, deduped)
          totalSize += asset.size || 0
          advanceDone()
          continue
        }

        try {
          const result = await this.fileDownloader.download({
            url: asset.url,
            postDir,
            subDir: asset.subDir,
            filename: asset.filename,
            preserveFilename: this.exportOptions.preserveFilenames,
            maxFileSize: this.exportOptions.maxFileSize,
            signal,
            onProgress: (bytes) => {
              if (bytes > 0) bytesDownloaded += bytes
              progress.update({
                bytesDownloaded,
                currentFile: asset.filename
              })
              this.emitProgress(taskId, progress.get())
            }
          })

          for (const key of [asset.url, ...asset.aliases]) assetMap.set(key, result.relativePath)
          this.deduplicator.record(asset.fileId, result.relativePath)
          totalSize += result.size

          cachedRecords.push({
            file_id: asset.fileId,
            message_id: asset.messageId,
            original_url: asset.url,
            local_path: result.localPath,
            file_hash: result.hash,
            file_size: result.size,
            mime_type: 'application/octet-stream',
            filename: asset.filename,
            downloaded_at: new Date().toISOString(),
            still_valid: true
          })
        } catch (error) {
          if (signal.aborted || (error as Error).message === 'cancelled') {
            cancelled = true
            throw new Error('cancelled')
          }
          // Un adjunto caído no debe tumbar el archivo completo.
          console.warn(`[download] ${asset.filename}: ${(error as Error).message}`)
        }

        advanceDone()
      }
    }

    const workerCount = Math.min(DownloadManager.ASSET_CONCURRENCY, plan.length)
    const results = await Promise.allSettled(
      Array.from({ length: workerCount }, () => worker())
    )

    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failure) throw failure.reason
    if (signal.aborted || cancelled) throw new Error('cancelled')

    if (cachedRecords.length > 0) {
      db.runInTransaction(() => {
        for (const record of cachedRecords) {
          db.upsertCachedFile(record)
        }
      })
    }

    return { assetMap, totalSize }
  }

  private planAssets(messages: DiscordMessage[]): PlannedAsset[] {
    const plan = new Map<string, PlannedAsset>()
    const sel = this.contentSelection
    const maxSize = this.exportOptions.maxFileSize || 0

    const add = (asset: PlannedAsset): void => {
      if (!asset.url) return
      if (maxSize > 0 && asset.size > maxSize) return
      const existing = plan.get(asset.url)
      if (existing) {
        for (const alias of asset.aliases) {
          if (!existing.aliases.includes(alias)) existing.aliases.push(alias)
        }
        return
      }
      plan.set(asset.url, asset)
    }

    const seenAuthors = new Set<string>()

    for (const msg of messages) {
      for (const att of msg.attachments) {
        const subDir = kindOf(att.content_type, att.filename)
        if (subDir === 'images' && !sel.images) continue
        if (subDir === 'videos' && !sel.videos) continue
        if (subDir === 'files' && !sel.files) continue

        add({
          url: att.url,
          aliases: [att.proxy_url].filter(Boolean) as string[],
          filename: att.filename,
          subDir,
          fileId: att.id,
          messageId: msg.id,
          size: att.size || 0
        })
      }

      if (sel.embeds) {
        for (const embed of msg.embeds) {
          for (const media of [embed.image, embed.thumbnail, embed.video]) {
            if (!media?.url) continue
            const isVideo = media === embed.video
            if (isVideo && !sel.videos) continue
            if (!isVideo && !sel.images) continue
            const name = path.basename(new URL(media.url).pathname) || `embed-${msg.id}`
            add({
              url: media.url,
              aliases: media.proxy_url ? [media.proxy_url] : [],
              filename: decodeURIComponent(name),
              subDir: isVideo ? 'videos' : 'images',
              fileId: `embed:${msg.id}:${media.url}`,
              messageId: msg.id,
              size: 0
            })
          }
        }
      }

      if (this.exportOptions.includeStickers && sel.stickers) {
        for (const sticker of msg.sticker_items || []) {
          if (sticker.format_type === 3) continue // Lottie no es una imagen
          const ext: 'png' | 'gif' = sticker.format_type === 4 ? 'gif' : 'png'
          const url = ENDPOINTS.STICKER(sticker.id, ext)
          add({
            url,
            aliases: [],
            filename: `${sticker.name}.${ext}`,
            subDir: 'images',
            fileId: `sticker:${sticker.id}`,
            messageId: msg.id,
            size: 0
          })
        }
      }

      if (this.exportOptions.includeCustomEmojis && sel.customEmojis) {
        const emojiRe = /<(a?):(\w+):(\d+)>/g
        let match: RegExpExecArray | null
        while ((match = emojiRe.exec(msg.content || '')) !== null) {
          const [, animated, name, id] = match
          const url = ENDPOINTS.CUSTOM_EMOJI(id, animated === 'a')
          add({
            url,
            aliases: [],
            filename: `${name}.${animated === 'a' ? 'gif' : 'png'}`,
            subDir: 'images',
            fileId: `emoji:${id}`,
            messageId: msg.id,
            size: 0
          })
        }
      }

      if (this.exportOptions.includeAvatars && sel.avatars && msg.author?.avatar) {
        if (!seenAuthors.has(msg.author.id)) {
          seenAuthors.add(msg.author.id)
          const base = ENDPOINTS.USER_AVATAR(msg.author.id, msg.author.avatar)
          add({
            url: `${base}?size=128`,
            aliases: [base, `${base}?size=80`, `${base}?size=64`, `${base}?size=48`],
            filename: `avatar-${msg.author.username}.png`,
            subDir: 'images',
            fileId: `avatar:${msg.author.id}:${msg.author.avatar}`,
            messageId: msg.id,
            size: 0
          })
        }
      }
    }

    return Array.from(plan.values())
  }

  // ----------- Exportación -----------

  private async runExports(
    thread: DiscordThread,
    messages: DiscordMessage[],
    task: DownloadTask,
    postDir: string,
    assetMap: Map<string, string>,
    tags: ForumTag[]
  ): Promise<void> {
    const formats = this.exportOptions.formats
    const mode = this.exportOptions.threadMode

    if (formats.includes('markdown')) {
      const generator = new MarkdownGenerator(this.mdParser, assetMap, mode)
      const selection = {
        text: this.contentSelection.text,
        embeds: this.contentSelection.embeds,
        metadata: this.contentSelection.metadata,
        stickers: this.contentSelection.stickers
      }
      await generator.generatePostMarkdown(
        thread, messages, task.guildName, task.channelName, postDir, tags, selection
      )
      // El generador decide si escribe thread.md, replies/ o ambos según threadMode.
      await generator.generateThreadMarkdown(
        thread, messages, task.guildName, task.channelName, postDir, tags, selection
      )
    }

    if (formats.includes('json') || formats.includes('csv')) {
      const jsonExporter = new JsonExporter()
      if (formats.includes('json')) {
        await jsonExporter.exportThread(thread, messages, postDir)
      }
      if (formats.includes('csv')) {
        await jsonExporter.exportCsv(thread, messages, postDir)
      }
    }

    if (formats.includes('html')) {
      await new HtmlGenerator(assetMap).generatePostHtml(
        thread,
        messages,
        task.guildName,
        task.channelName,
        postDir
      )
    }

    if (formats.includes('pdf')) {
      try {
        await PdfGenerator.generate({ thread, messages, outputDir: postDir, assetMap })
      } catch (error) {
        console.error('[pdf] no se pudo generar:', (error as Error).message)
      }
    }

    if (formats.includes('epub')) {
      try {
        const buffer = await buildEpub(thread, messages, assetMap)
        await fs.promises.writeFile(path.join(postDir, 'export.epub'), buffer)
      } catch (error) {
        console.error('[epub] no se pudo generar:', (error as Error).message)
      }
    }
  }

  // ----------- Índice (una sola vez por lote) -----------

  private scheduleIndex(guildName: string, channelName: string, channelId: string): void {
    try {
      const forumDir = new FolderBuilder(this.exportOptions).getForumDirectory(guildName, channelName)
      this.pendingIndexes.set(forumDir, { channelName, channelId })
      if (this.indexTimer) clearTimeout(this.indexTimer)
      this.indexTimer = setTimeout(() => { void this.flushIndexes() }, 1500)
    } catch (error) {
      console.warn('[index] no se pudo programar:', (error as Error).message)
    }
  }

  private async flushIndexes(): Promise<void> {
    if (this.indexTimer) {
      clearTimeout(this.indexTimer)
      this.indexTimer = null
    }
    const entries = Array.from(this.pendingIndexes.entries())
    this.pendingIndexes.clear()
    for (const [forumDir, target] of entries) {
      try {
        const posts = db.getCachedPostsByChannel(target.channelId)
        await IndexGenerator.generateIndexAsync(forumDir, target.channelName, posts)
      } catch (error) {
        console.warn('[index] no se pudo generar:', (error as Error).message)
      }
    }
  }

  private isTerminalStatus(status: DownloadTask['status']): boolean {
    return status === 'done' || status === 'cancelled' || status === 'error'
  }

  private deleteTaskFromMemory(taskId: string): void {
    this.activeTasks.delete(taskId)
    this.lastProgressEmit.delete(taskId)
    this.taskTags.delete(taskId)
    this.progressTracker.remove(taskId)
  }

  /** Poda tareas terminadas en RAM si exceden MAX_FINISHED_TASKS (conserva las más recientes). */
  pruneFinishedTasks(): number {
    const finished: { id: string; time: number }[] = []
    for (const [id, task] of this.activeTasks) {
      if (this.isTerminalStatus(task.status)) {
        const ref = task.completedAt || task.startedAt || task.createdAt
        const ms = ref ? Date.parse(ref) : 0
        finished.push({ id, time: Number.isNaN(ms) ? 0 : ms })
      }
    }
    const excess = finished.length - DownloadManager.MAX_FINISHED_TASKS
    if (excess <= 0) return 0

    finished.sort((a, b) => a.time - b.time)
    for (let i = 0; i < excess; i++) {
      this.deleteTaskFromMemory(finished[i].id)
    }
    return excess
  }

  // ----------- Progreso -----------

  private emitProgress(taskId: string, progress: PostProgress): void {
    const now = Date.now()
    const last = this.lastProgressEmit.get(taskId) || 0
    const isTerminal = progress.phase === 'done'
    if (!isTerminal && now - last < 120) return
    this.lastProgressEmit.set(taskId, now)

    const enriched: PostProgress = {
      ...progress,
      speed: this.progressTracker.getSpeed(taskId),
      eta: this.progressTracker.getEta(taskId)
    }
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.progress = enriched
    }
    this.emit('task-progress', taskId, enriched)
  }

  // ----------- Control -----------

  getQueue(): DownloadTask[] {
    return Array.from(this.activeTasks.values())
  }

  getActiveCount(): number {
    return this.running
  }

  pauseAll(): void {
    this.paused = true
    for (const task of this.activeTasks.values()) {
      if (task.status === 'queued') {
        task.status = 'paused'
        db.updateQueueStatus(parseInt(task.id, 10), 'paused')
      }
    }
    this.emit('queue-updated', this.getQueue())
  }

  resumeAll(): void {
    this.paused = false
    for (const task of this.activeTasks.values()) {
      if (task.status === 'paused') {
        task.status = 'queued'
        db.updateQueueStatus(parseInt(task.id, 10), 'queued')
      }
    }
    this.emit('queue-updated', this.getQueue())
    void this.processQueue()
  }

  cancelTask(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    if (task.status === 'done' || task.status === 'error') return

    task.status = 'cancelled'
    db.updateQueueStatus(parseInt(taskId, 10), 'cancelled')
    this.controllers.get(taskId)?.abort()
    this.emit('task-cancelled', taskId)
    this.emit('queue-updated', this.getQueue())
  }

  cancelAll(): void {
    for (const task of this.activeTasks.values()) {
      if (task.status === 'queued' || task.status === 'downloading' || task.status === 'paused') {
        task.status = 'cancelled'
        db.updateQueueStatus(parseInt(task.id, 10), 'cancelled')
        this.controllers.get(task.id)?.abort()
      }
    }
    this.emit('queue-updated', this.getQueue())
  }

  private requeueTask(task: DownloadTask): boolean {
    // Evita reencolar si ya existe otra tarea activa, en cola o pausada para el mismo hilo.
    for (const other of this.activeTasks.values()) {
      if (
        other.id !== task.id &&
        other.threadId === task.threadId &&
        (other.status === 'queued' || other.status === 'downloading' || other.status === 'paused')
      ) {
        return false
      }
    }

    task.status = 'queued'
    task.errorMessage = undefined
    task.completedAt = undefined
    task.retryCount++
    const numeric = parseInt(task.id, 10)
    if (!Number.isNaN(numeric)) {
      db.updateQueueStatus(numeric, 'queued')
      db.incrementRetryCount(numeric)
    }
    return true
  }

  clearCompleted(): void {
    const removable: number[] = []
    for (const [id, task] of this.activeTasks) {
      if (this.isTerminalStatus(task.status)) {
        this.deleteTaskFromMemory(id)
        const numeric = parseInt(id, 10)
        if (!Number.isNaN(numeric)) removable.push(numeric)
      }
    }
    if (removable.length > 0) db.deleteQueueItems(removable)
    this.emit('queue-updated', this.getQueue())
  }

  /** Actualiza la prioridad de una tarea en cola y notifica el cambio. */
  setTaskPriority(taskId: string, priority: number): boolean {
    if (!Number.isFinite(priority)) return false
    const task = this.activeTasks.get(taskId)
    if (!task) return false
    task.priority = priority
    this.emit('queue-updated', this.getQueue())
    return true
  }

  /** Elimina una única tarea en estado terminal de la cola y emite `queue-updated`. */
  removeTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId)
    if (!task || !this.isTerminalStatus(task.status)) return false

    this.deleteTaskFromMemory(taskId)
    const numeric = parseInt(taskId, 10)
    if (!Number.isNaN(numeric)) {
      db.deleteQueueItems([numeric])
    }
    this.emit('queue-updated', this.getQueue())
    return true
  }

  async retryTask(taskId: string): Promise<void> {
    const task = this.activeTasks.get(taskId)
    if (!task) return
    if (task.status !== 'error' && task.status !== 'cancelled') return

    if (!this.requeueTask(task)) return
    this.emit('queue-updated', this.getQueue())
    void this.processQueue()
  }

  /** Reencola todas las tareas en estado `error` evitando duplicados y devuelve el conteo. */
  async retryAllFailed(): Promise<number> {
    let count = 0
    for (const task of this.activeTasks.values()) {
      if (task.status !== 'error') continue
      if (this.requeueTask(task)) count++
    }
    if (count > 0) {
      this.emit('queue-updated', this.getQueue())
      void this.processQueue()
    }
    return count
  }

  destroy(): void {
    this.destroyed = true
    this.paused = true
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    if (this.indexTimer) {
      clearTimeout(this.indexTimer)
      this.indexTimer = null
    }
    for (const [forumDir, target] of this.pendingIndexes) {
      try {
        const posts = db.getCachedPostsByChannel(target.channelId)
        IndexGenerator.generateIndex(forumDir, target.channelName, posts)
      } catch {
        /* mejor esfuerzo al cerrar */
      }
    }
    this.pendingIndexes.clear()
    this.removeAllListeners()
  }
}
