import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CachedFileRecord,
  CachedPostRecord,
  ContentSelection,
  DiscordChannel,
  DiscordMessage,
  DiscordThread,
  DiscordUser,
  DownloadTask,
  ExportOptions,
  PersistedQueueItem
} from '../discord/types'

const {
  dbState,
  mockDb
} = vi.hoisted(() => {
  const state = {
    nextQueueId: 1,
    txDepth: 0,
    cachedPosts: new Map<string, CachedPostRecord>(),
    cachedFiles: new Map<string, CachedFileRecord>(),
    fileUpsertTxFlags: [] as boolean[],
    queueStatusUpdates: [] as { id: number; status: string; error?: string }[],
    deletedQueueIds: [] as number[][],
    retriedQueueIds: [] as number[],
    historyRecords: [] as unknown[]
  }

  const mockDb = {
    getCachedUser: vi.fn(() => null),
    upsertCachedUser: vi.fn(),
    updateQueueStatus: vi.fn((id: number, status: string, error?: string) => {
      state.queueStatusUpdates.push({ id, status, error })
    }),
    addToQueue: vi.fn(() => state.nextQueueId++),
    getCachedPost: vi.fn((threadId: string) => state.cachedPosts.get(threadId) ?? null),
    upsertCachedPost: vi.fn((post: CachedPostRecord) => {
      state.cachedPosts.set(post.thread_id, { ...post })
    }),
    upsertCachedMessage: vi.fn(),
    recordDownloadHistory: vi.fn((entry: unknown) => {
      state.historyRecords.push(entry)
    }),
    upsertCachedFile: vi.fn((file: CachedFileRecord) => {
      state.fileUpsertTxFlags.push(state.txDepth > 0)
      state.cachedFiles.set(file.file_id, { ...file })
    }),
    getCachedFile: vi.fn((fileId: string) => state.cachedFiles.get(fileId) ?? null),
    getCachedPostsByChannel: vi.fn(() => []),
    deleteQueueItems: vi.fn((ids: number[]) => {
      state.deletedQueueIds.push(ids)
    }),
    incrementRetryCount: vi.fn((id: number) => {
      state.retriedQueueIds.push(id)
    }),
    runInTransaction: vi.fn(<T>(cb: () => T): T => {
      state.txDepth++
      try {
        return cb()
      } finally {
        state.txDepth--
      }
    })
  }

  return { dbState: state, mockDb }
})

vi.mock('../storage/database', () => mockDb)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir()
  }
}))

import type { DiscordClient } from '../discord/api-client'
import type { FileDownloader } from './file-downloader'
import type { ProgressTracker } from './progress-tracker'
import type { Deduplicator } from './deduplicator'
import { DownloadManager } from './download-manager'

function makeExportOptions(outputDir: string, overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    formats: [],
    outputDir,
    folderStructure: 'flat',
    namingPattern: '{title}',
    includeToc: false,
    threadMode: 'single',
    maxFilenameLength: 80,
    includeAvatars: false,
    includeStickers: false,
    includeCustomEmojis: false,
    maxFileSize: 0,
    preserveFilenames: false,
    dateFormat: 'YYYY-MM-DD',
    syncMode: 'force',
    ...overrides
  }
}

function makeContentSelection(overrides: Partial<ContentSelection> = {}): ContentSelection {
  return {
    text: true,
    images: true,
    videos: true,
    files: true,
    embeds: false,
    replies: true,
    metadata: true,
    customEmojis: false,
    stickers: false,
    avatars: false,
    ...overrides
  }
}

function makeUser(): DiscordUser {
  return {
    id: 'user-1',
    username: 'tester',
    discriminator: '0',
    global_name: 'Tester',
    avatar: null
  }
}

function makeThread(id: string, name = `Hilo ${id}`): DiscordThread {
  return {
    id,
    guild_id: 'guild-1',
    parent_id: 'channel-1',
    owner_id: 'user-1',
    name,
    type: 11,
    last_message_id: `msg-${id}`,
    message_count: 1,
    member_count: 1,
    total_message_sent: 1,
    applied_tags: [],
    thread_metadata: {
      archived: false,
      auto_archive_duration: 1440,
      archive_timestamp: '2026-11-14T10:00:00.000Z',
      locked: false
    },
    created_timestamp: '2026-11-14T10:00:00.000Z'
  }
}

function makePersistedItem(
  id: number,
  overrides: Partial<PersistedQueueItem> = {}
): PersistedQueueItem {
  return {
    id,
    thread_id: `thread-${id}`,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    guild_name: 'Servidor',
    channel_name: 'Foro',
    thread_name: `Post ${id}`,
    priority: 0,
    status: 'paused',
    error_message: null,
    created_at: `2026-11-14T10:0${Math.min(id, 9)}:00.000Z`,
    started_at: null,
    completed_at: null,
    retry_count: 0,
    export_options: null,
    ...overrides
  }
}

function makeMessage(
  id: string,
  threadId: string,
  attachments: DiscordMessage['attachments'] = []
): DiscordMessage {
  return {
    id,
    channel_id: threadId,
    author: makeUser(),
    content: `Mensaje ${id}`,
    timestamp: '2026-11-14T10:00:00.000Z',
    edited_timestamp: null,
    attachments,
    embeds: [],
    pinned: false,
    type: 0
  }
}

interface ManagerInternals {
  activeTasks: Map<string, DownloadTask>
  progressTracker: ProgressTracker
  fileDownloader: FileDownloader
  deduplicator: Deduplicator
}

function internals(manager: DownloadManager): ManagerInternals {
  return manager as unknown as ManagerInternals
}

function createFakeClient(
  messagesByThread: Record<string, DiscordMessage[]> = {}
): DiscordClient {
  return {
    getChannel: vi.fn(async (threadId: string): Promise<DiscordChannel> => {
      const msgs = messagesByThread[threadId] || [makeMessage(`m-${threadId}`, threadId)]
      return {
        id: threadId,
        type: 11,
        guild_id: 'guild-1',
        parent_id: 'channel-1',
        name: `Post ${threadId}`,
        last_message_id: msgs[msgs.length - 1]?.id || null,
        message_count: msgs.length
      }
    }),
    getAllThreadMessages: vi.fn(async (threadId: string): Promise<DiscordMessage[]> => {
      return messagesByThread[threadId] || [makeMessage(`m-${threadId}`, threadId)]
    }),
    getUser: vi.fn(async () => makeUser())
  } as unknown as DiscordClient
}

describe('DownloadManager', () => {
  let tempDir: string
  let activeManagers: DownloadManager[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-dm-'))
    activeManagers = []
    dbState.nextQueueId = 1
    dbState.txDepth = 0
    dbState.cachedPosts.clear()
    dbState.cachedFiles.clear()
    dbState.fileUpsertTxFlags = []
    dbState.queueStatusUpdates = []
    dbState.deletedQueueIds = []
    dbState.retriedQueueIds = []
    dbState.historyRecords = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const manager of activeManagers) {
      manager.destroy()
    }
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createManager(
    client = createFakeClient(),
    concurrency = 1,
    exportOverrides: Partial<ExportOptions> = {}
  ): DownloadManager {
    const manager = new DownloadManager(client, {
      concurrency,
      exportOptions: makeExportOptions(tempDir, exportOverrides),
      contentSelection: makeContentSelection()
    })
    activeManagers.push(manager)
    return manager
  }

  it('selecciona la siguiente tarea según mayor prioridad y menor createdAt en empates mediante setTaskPriority', async () => {
    const manager = createManager(createFakeClient(), 1)
    manager.restoreQueue([
      makePersistedItem(1, { thread_id: 'th-1', priority: 1, created_at: '2026-11-14T10:03:00.000Z' }),
      makePersistedItem(2, { thread_id: 'th-2', priority: 5, created_at: '2026-11-14T10:05:00.000Z' }),
      makePersistedItem(3, { thread_id: 'th-3', priority: 5, created_at: '2026-11-14T10:01:00.000Z' }),
      makePersistedItem(4, { thread_id: 'th-4', priority: 0, created_at: '2026-11-14T10:00:00.000Z' })
    ])

    const queueEvents: DownloadTask[][] = []
    manager.on('queue-updated', (q) => queueEvents.push(q))

    expect(manager.setTaskPriority('inexistente', 10)).toBe(false)
    expect(manager.setTaskPriority('4', Number.NaN)).toBe(false)
    expect(queueEvents).toHaveLength(0)

    // Subir prioridad de la tarea 4 por encima de todas (10)
    expect(manager.setTaskPriority('4', 10)).toBe(true)
    expect(queueEvents).toHaveLength(1)
    expect(manager.getQueue().find((t) => t.id === '4')?.priority).toBe(10)

    const startedOrder: string[] = []
    manager.on('task-started', (task) => startedOrder.push(task.id))
    const allDone = new Promise<void>((resolve) => manager.once('all-completed', resolve))

    manager.resumeAll()
    await allDone

    // Orden esperado: id 4 (prio 10) -> id 3 (prio 5, 10:01) -> id 2 (prio 5, 10:05) -> id 1 (prio 1)
    expect(startedOrder).toEqual(['4', '3', '2', '1'])
  })

  it('removeTask solo elimina tareas terminales, actualiza BD y libera su ProgressTracker', () => {
    const manager = createManager()
    manager.restoreQueue([
      makePersistedItem(10, { thread_id: 'th-paused' }),
      makePersistedItem(11, { thread_id: 'th-done' }),
      makePersistedItem(12, { thread_id: 'th-err' })
    ])

    const { activeTasks, progressTracker } = internals(manager)
    activeTasks.get('11')!.status = 'done'
    activeTasks.get('12')!.status = 'error'
    progressTracker.createTracker('11')
    progressTracker.createTracker('12')

    const queueEvents: DownloadTask[][] = []
    manager.on('queue-updated', (q) => queueEvents.push(q))

    // No permite borrar tareas inexistentes o no terminales
    expect(manager.removeTask('999')).toBe(false)
    expect(manager.removeTask('10')).toBe(false)
    expect(queueEvents).toHaveLength(0)

    expect(manager.removeTask('11')).toBe(true)
    expect(progressTracker.getTracker('11')).toBeUndefined()
    expect(manager.getQueue().map((t) => t.id)).toEqual(['10', '12'])
    expect(dbState.deletedQueueIds).toEqual([[11]])
    expect(queueEvents).toHaveLength(1)

    expect(manager.removeTask('12')).toBe(true)
    expect(progressTracker.getTracker('12')).toBeUndefined()
    expect(manager.getQueue().map((t) => t.id)).toEqual(['10'])
    expect(dbState.deletedQueueIds).toEqual([[11], [12]])
  })

  it('retryAllFailed reencola solo tareas en error sin duplicar hilos activos y devuelve el conteo', async () => {
    const manager = createManager()
    manager.pauseAll()

    manager.restoreQueue([
      makePersistedItem(1, { thread_id: 'th-a' }),
      makePersistedItem(2, { thread_id: 'th-b' }),
      makePersistedItem(3, { thread_id: 'th-c' }),
      makePersistedItem(4, { thread_id: 'th-dup' }),
      makePersistedItem(5, { thread_id: 'th-dup' })
    ])

    const { activeTasks } = internals(manager)
    activeTasks.get('1')!.status = 'error'
    activeTasks.get('1')!.errorMessage = 'red'
    activeTasks.get('2')!.status = 'done'
    activeTasks.get('3')!.status = 'error'
    activeTasks.get('4')!.status = 'error'
    activeTasks.get('5')!.status = 'paused' // Mismo hilo que tarea 4: bloquea reencolado duplicado

    const count = await manager.retryAllFailed()

    expect(count).toBe(2)
    expect(activeTasks.get('1')?.status).toBe('queued')
    expect(activeTasks.get('1')?.errorMessage).toBeUndefined()
    expect(activeTasks.get('1')?.retryCount).toBe(1)
    expect(activeTasks.get('3')?.status).toBe('queued')
    expect(activeTasks.get('3')?.retryCount).toBe(1)
    expect(activeTasks.get('2')?.status).toBe('done')
    expect(activeTasks.get('4')?.status).toBe('error')
    expect(dbState.retriedQueueIds).toEqual([1, 3])
  })

  it('pruneFinishedTasks poda las tareas terminadas más antiguas por encima de 250 y limpia sus trackers', () => {
    const manager = createManager()
    const { activeTasks, progressTracker } = internals(manager)

    // 1 tarea en pausa que nunca debe podarse
    manager.restoreQueue([makePersistedItem(999, { thread_id: 'th-keep-paused' })])

    const baseMs = Date.parse('2026-11-14T00:00:00.000Z')
    for (let i = 1; i <= 254; i++) {
      const id = String(i)
      const iso = new Date(baseMs + i * 1000).toISOString()
      activeTasks.set(id, {
        id,
        threadId: `th-${i}`,
        guildId: 'guild-1',
        channelId: 'channel-1',
        guildName: 'Servidor',
        channelName: 'Foro',
        threadName: `Post ${i}`,
        priority: 0,
        status: i % 3 === 0 ? 'error' : 'done',
        progress: {
          phase: 'done',
          messagesTotal: 1,
          messagesFetched: 1,
          assetsTotal: 0,
          assetsDownloaded: 0,
          bytesTotal: 0,
          bytesDownloaded: 0,
          speed: 0,
          eta: 0
        },
        createdAt: iso,
        completedAt: iso,
        retryCount: 0
      })
      progressTracker.createTracker(id)
    }

    const pruned = manager.pruneFinishedTasks()

    expect(pruned).toBe(4)
    expect(activeTasks.has('999')).toBe(true)
    for (let i = 1; i <= 4; i++) {
      expect(activeTasks.has(String(i))).toBe(false)
      expect(progressTracker.getTracker(String(i))).toBeUndefined()
    }
    expect(activeTasks.has('5')).toBe(true)
    expect(activeTasks.has('254')).toBe(true)
    expect(manager.pruneFinishedTasks()).toBe(0)
  })

  it('libera el ProgressTracker al finalizar processTask en éxito, quick-sync y error', async () => {
    const client = createFakeClient()
    const manager = createManager(client, 1, { syncMode: 'quick' })
    const { progressTracker } = internals(manager)
    const removeSpy = vi.spyOn(progressTracker, 'remove')

    // 1. Tarea completada normalmente
    const donePromise = new Promise<void>((resolve) => manager.once('all-completed', resolve))
    const [idNormal] = await manager.addToQueue(
      [{ thread: makeThread('th-normal'), tags: [] }],
      'Servidor',
      'Foro'
    )
    await donePromise

    expect(removeSpy).toHaveBeenCalledWith(idNormal)
    expect(progressTracker.getTracker(idNormal)).toBeUndefined()

    // 2. Tarea saltada por quick-sync (ya cacheada en disco)
    const quickDone = new Promise<void>((resolve) => manager.once('all-completed', resolve))
    const [idQuick] = await manager.addToQueue(
      [{ thread: makeThread('th-normal'), tags: [] }],
      'Servidor',
      'Foro'
    )
    await quickDone

    expect(removeSpy).toHaveBeenCalledWith(idQuick)
    expect(progressTracker.getTracker(idQuick)).toBeUndefined()

    // 3. Tarea que falla (0 mensajes)
    ;(client.getAllThreadMessages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    const errDone = new Promise<void>((resolve) => manager.once('all-completed', resolve))
    const [idFail] = await manager.addToQueue(
      [{ thread: makeThread('th-empty'), tags: [] }],
      'Servidor',
      'Foro'
    )
    await errDone

    expect(removeSpy).toHaveBeenCalledWith(idFail)
    expect(progressTracker.getTracker(idFail)).toBeUndefined()
  })

  it('downloadAssets ejecuta hasta ASSET_CONCURRENCY = 3 descargas paralelas, usa checkAsync y persiste en transacción por lote', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const attachments: DiscordMessage['attachments'] = Array.from({ length: 7 }, (_, i) => ({
      id: `att-${i}`,
      filename: `file-${i}.png`,
      content_type: 'image/png',
      size: 100,
      url: `https://cdn.example/file-${i}.png`,
      proxy_url: `https://media.example/file-${i}.png`
    }))

    const client = createFakeClient({
      'th-assets': [makeMessage('m-1', 'th-assets', attachments)]
    })
    const manager = createManager(client, 1)
    const { deduplicator, fileDownloader } = internals(manager)

    const checkSyncSpy = vi.spyOn(deduplicator, 'check')
    const checkAsyncSpy = vi.spyOn(deduplicator, 'checkAsync').mockImplementation(async (fileId) => {
      return fileId === 'att-0' ? 'assets/images/cached-0.png' : null
    })

    let activeDownloads = 0
    let maxActiveDownloads = 0
    vi.spyOn(fileDownloader, 'download').mockImplementation(async (req) => {
      activeDownloads++
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads)
      await new Promise((resolve) => setTimeout(resolve, 15))
      activeDownloads--

      if (req.filename === 'file-3.png') {
        throw new Error('fallo transitorio de prueba')
      }

      req.onProgress?.(40)
      req.onProgress?.(60)
      return {
        localPath: path.join(req.postDir, 'assets', req.subDir, req.filename),
        relativePath: `assets/${req.subDir}/${req.filename}`,
        size: 100,
        hash: `hash-${req.filename}`,
        reused: false
      }
    })

    const progressHistory: { assetsDownloaded: number; bytesDownloaded: number }[] = []
    manager.on('task-progress', (_id, p) => {
      progressHistory.push({
        assetsDownloaded: p.assetsDownloaded,
        bytesDownloaded: p.bytesDownloaded
      })
    })

    const allDone = new Promise<void>((resolve) => manager.once('all-completed', resolve))
    const [taskId] = await manager.addToQueue(
      [{ thread: makeThread('th-assets'), tags: [] }],
      'Servidor',
      'Foro'
    )
    await allDone

    const finished = manager.getQueue().find((t) => t.id === taskId)
    expect(finished?.status).toBe('done')

    // Verifica pool paralelo acotado a 3 workers y uso de checkAsync
    expect(maxActiveDownloads).toBeLessThanOrEqual(3)
    expect(maxActiveDownloads).toBeGreaterThan(1)
    expect(checkAsyncSpy).toHaveBeenCalledTimes(7)
    expect(checkSyncSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('file-3.png'))

    // att-0 fue deduplicado, file-3.png falló sin abortar, 5 archivos nuevos persistidos en una sola transacción
    expect(dbState.cachedFiles.size).toBe(5)
    expect(dbState.fileUpsertTxFlags).toHaveLength(5)
    expect(dbState.fileUpsertTxFlags.every(Boolean)).toBe(true)

    // Progreso monotónico (nunca retrocede)
    for (let i = 1; i < progressHistory.length; i++) {
      expect(progressHistory[i].assetsDownloaded).toBeGreaterThanOrEqual(
        progressHistory[i - 1].assetsDownloaded
      )
      expect(progressHistory[i].bytesDownloaded).toBeGreaterThanOrEqual(
        progressHistory[i - 1].bytesDownloaded
      )
    }
    expect(finished?.progress.assetsDownloaded).toBe(7)
  })

  it('downloadAssets detiene el pool paralelo ante cancelación sin persistir caché parcial ni filtrar trackers', async () => {
    const attachments: DiscordMessage['attachments'] = Array.from({ length: 6 }, (_, i) => ({
      id: `att-c-${i}`,
      filename: `cancel-${i}.png`,
      content_type: 'image/png',
      size: 100,
      url: `https://cdn.example/cancel-${i}.png`,
      proxy_url: `https://media.example/cancel-${i}.png`
    }))

    const client = createFakeClient({
      'th-cancel': [makeMessage('m-c', 'th-cancel', attachments)]
    })
    const manager = createManager(client, 1)
    const { deduplicator, fileDownloader, progressTracker } = internals(manager)

    vi.spyOn(deduplicator, 'checkAsync').mockResolvedValue(null)
    let startedCount = 0
    let cancelTriggered = false

    vi.spyOn(fileDownloader, 'download').mockImplementation(async (req) => {
      startedCount++
      if (!cancelTriggered && startedCount >= 2) {
        cancelTriggered = true
        manager.cancelTask('1')
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (req.signal?.aborted) throw new Error('cancelled')
      return {
        localPath: path.join(req.postDir, 'assets', req.subDir, req.filename),
        relativePath: `assets/${req.subDir}/${req.filename}`,
        size: 100,
        hash: `hash-${req.filename}`,
        reused: false
      }
    })

    const allDone = new Promise<void>((resolve) => manager.once('all-completed', resolve))
    const [taskId] = await manager.addToQueue(
      [{ thread: makeThread('th-cancel'), tags: [] }],
      'Servidor',
      'Foro'
    )
    await allDone

    const cancelledTask = manager.getQueue().find((t) => t.id === taskId)
    expect(cancelledTask?.status).toBe('cancelled')
    expect(dbState.cachedFiles.size).toBe(0)
    expect(progressTracker.getTracker(taskId)).toBeUndefined()
  })
})
