import { create } from 'zustand'
import type {
  ContentSelection,
  DownloadHistoryRecord,
  DownloadTask,
  ExportOptions
} from '../../core/discord/types'
import type { Unsubscribe } from '../../shared/api'

type DateFormat = ExportOptions['dateFormat']
type SyncMode = ExportOptions['syncMode']
type ExportFormat = ExportOptions['formats'][number]

/** Estados en los que una tarea sigue consumiendo la cola. */
const ACTIVE_STATUSES = new Set(['downloading', 'queued'])

function hasActiveTasks(queue: DownloadTask[]): boolean {
  return queue.some((t) => ACTIVE_STATUSES.has(t.status))
}

interface DownloadState {
  queue: DownloadTask[]
  isDownloading: boolean
  outputDir: string
  exportFormats: string[]
  contentSelection: ContentSelection
  folderStructure: string
  namingPattern: string
  threadMode: string
  includeToc: boolean
  maxConcurrent: number
  maxFileSize: number // MB, 0 = sin límite
  dateFormat: DateFormat
  syncMode: SyncMode
  autoOpenFolder: boolean
  preserveFilenames: boolean
  minimizeToTray: boolean
  strictChannelFiltering: boolean

  /** Resuelve `false` si el usuario cancela el selector de carpeta o falla el arranque. */
  startDownload: (
    threads: { thread: unknown; tags: unknown[] }[],
    guildName: string,
    channelName: string
  ) => Promise<boolean>
  pauseAll: () => void
  resumeAll: () => void
  cancelTask: (taskId: string) => void
  cancelAll: () => void
  retryTask: (taskId: string) => void
  clearCompleted: () => void
  setOutputDir: (dir: string) => void
  setExportFormats: (formats: string[]) => void
  setContentSelection: (key: string, value: boolean) => void
  setFolderStructure: (structure: string) => void
  setNamingPattern: (pattern: string) => void
  setThreadMode: (mode: string) => void
  setIncludeToc: (value: boolean) => void
  setMaxConcurrent: (n: number) => void
  setMaxFileSize: (mb: number) => void
  setDateFormat: (fmt: string) => void
  setSyncMode: (mode: string) => void
  setAutoOpenFolder: (v: boolean) => void
  setPreserveFilenames: (v: boolean) => void
  setMinimizeToTray: (v: boolean) => void
  setStrictChannelFiltering: (v: boolean) => void
  pickDirectory: () => Promise<void>
  openOutputFolder: () => void
  loadPersistedSettings: () => Promise<void>
  refreshQueue: () => Promise<void>
  /** Registra los listeners IPC y devuelve la función de limpieza. */
  initListeners: () => Unsubscribe
  fetchHistory: (limit?: number, offset?: number) => Promise<DownloadHistoryRecord[]>
}

/** Desuscribers activos, para no duplicar listeners bajo React StrictMode. */
let activeUnsubscribers: Unsubscribe[] = []

function clampConcurrent(n: number): number {
  if (!Number.isFinite(n)) return 2
  return Math.min(10, Math.max(1, Math.round(n)))
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  queue: [],
  isDownloading: false,
  outputDir: '',
  exportFormats: ['markdown'],
  contentSelection: {
    text: true,
    images: true,
    videos: true,
    files: true,
    embeds: true,
    replies: true,
    metadata: true,
    customEmojis: true,
    stickers: true,
    avatars: false
  },
  folderStructure: 'by-server',
  namingPattern: '{num}_{date}_{title}',
  threadMode: 'both',
  includeToc: true,
  maxConcurrent: 2,
  maxFileSize: 0,
  dateFormat: 'YYYY-MM-DD',
  syncMode: 'quick',
  autoOpenFolder: true,
  preserveFilenames: true,
  minimizeToTray: false,
  strictChannelFiltering: false,

  startDownload: async (threads, guildName, channelName) => {
    // Elegir carpeta ANTES de leer el estado: `pickDirectory` muta `outputDir`
    // y el snapshot anterior seguiría teniendo '' (lo que hacía que
    // FolderBuilder escribiera en el cwd de la app).
    if (!get().outputDir) {
      await get().pickDirectory()
      if (!get().outputDir) return false
    }

    const state = get()

    const exportOptions: ExportOptions = {
      formats: state.exportFormats as ExportFormat[],
      outputDir: state.outputDir,
      folderStructure: state.folderStructure as ExportOptions['folderStructure'],
      namingPattern: state.namingPattern,
      includeToc: state.includeToc,
      threadMode: state.threadMode as ExportOptions['threadMode'],
      maxFilenameLength: 120,
      includeAvatars: state.contentSelection.avatars,
      includeStickers: state.contentSelection.stickers,
      includeCustomEmojis: state.contentSelection.customEmojis,
      // La UI guarda MB; el contrato IPC espera bytes.
      maxFileSize: Math.max(0, Math.round(state.maxFileSize * 1024 * 1024)),
      preserveFilenames: state.preserveFilenames,
      dateFormat: state.dateFormat,
      syncMode: state.syncMode
    }

    set({ isDownloading: true })

    try {
      await window.api.download.start(
        threads,
        guildName,
        channelName,
        exportOptions,
        state.contentSelection
      )
      return true
    } catch (error) {
      console.error('Download start failed:', error)
      set({ isDownloading: false })
      return false
    }
  },

  pauseAll: () => { void window.api.download.pauseAll() },
  resumeAll: () => { void window.api.download.resumeAll() },
  cancelTask: (taskId) => { void window.api.download.cancel(taskId) },
  retryTask: (taskId) => { void window.api.download.retry(taskId) },

  clearCompleted: () => {
    void window.api.download.clearCompleted()
  },

  cancelAll: () => {
    void window.api.download.cancelAll()
  },

  setOutputDir: (dir) => {
    set({ outputDir: dir })
    void window.api.settings.saveOutputDir(dir)
  },
  setExportFormats: (formats) => {
    set({ exportFormats: formats })
    void window.api.settings.saveAll({ exportFormats: formats })
  },
  setContentSelection: (key, value) => {
    set((state) => {
      const next: ContentSelection = { ...state.contentSelection, [key]: value }
      void window.api.settings.saveAll({ contentSelection: next })
      return { contentSelection: next }
    })
  },
  setFolderStructure: (structure) => {
    set({ folderStructure: structure })
    void window.api.settings.saveAll({ folderStructure: structure })
  },
  setNamingPattern: (pattern) => {
    set({ namingPattern: pattern })
    void window.api.settings.saveAll({ namingPattern: pattern })
  },
  setThreadMode: (mode) => {
    set({ threadMode: mode })
    void window.api.settings.saveAll({ threadMode: mode })
  },
  setIncludeToc: (value) => {
    set({ includeToc: value })
    void window.api.settings.saveAll({ includeToc: value })
  },
  setMaxConcurrent: (n) => {
    const next = clampConcurrent(n)
    set({ maxConcurrent: next })
    void window.api.download.setConcurrency(next)
    void window.api.settings.saveAll({ maxConcurrent: next })
  },
  setMaxFileSize: (mb) => {
    const next = Math.max(0, mb)
    set({ maxFileSize: next })
    void window.api.settings.saveAll({ maxFileSize: next })
  },
  setDateFormat: (fmt) => {
    set({ dateFormat: fmt as DateFormat })
    void window.api.settings.saveAll({ dateFormat: fmt })
  },
  setSyncMode: (mode) => {
    const next: SyncMode = mode === 'force' ? 'force' : 'quick'
    set({ syncMode: next })
    void window.api.settings.saveAll({ syncMode: next })
  },
  setAutoOpenFolder: (v) => {
    set({ autoOpenFolder: v })
    void window.api.settings.saveAll({ autoOpenFolder: v })
  },
  setPreserveFilenames: (v) => {
    set({ preserveFilenames: v })
    void window.api.settings.saveAll({ preserveFilenames: v })
  },
  setMinimizeToTray: (v) => {
    set({ minimizeToTray: v })
    void window.api.settings.saveAll({ minimizeToTray: v })
  },
  setStrictChannelFiltering: (v) => {
    set({ strictChannelFiltering: v })
    void window.api.settings.saveAll({ strictChannelFiltering: v })
  },

  pickDirectory: async () => {
    const dir = await window.api.settings.pickDirectory()
    if (dir) {
      set({ outputDir: dir })
      void window.api.settings.saveOutputDir(dir)
    }
  },

  openOutputFolder: () => {
    const dir = get().outputDir
    if (dir) void window.api.settings.openFolder(dir)
  },

  loadPersistedSettings: async () => {
    try {
      const prefs = await window.api.settings.getAll()
      if (prefs) {
        set({
          outputDir: prefs.outputDirectory || '',
          exportFormats: prefs.exportFormats || ['markdown'],
          contentSelection: prefs.contentSelection || get().contentSelection,
          folderStructure: prefs.folderStructure || 'by-server',
          namingPattern: prefs.namingPattern || '{num}_{date}_{title}',
          threadMode: prefs.threadMode || 'both',
          includeToc: prefs.includeToc ?? true,
          maxConcurrent: clampConcurrent(prefs.maxConcurrent ?? 2),
          maxFileSize: prefs.maxFileSize ?? 0,
          dateFormat: prefs.dateFormat ?? 'YYYY-MM-DD',
          syncMode: (prefs.syncMode as SyncMode) || 'quick',
          autoOpenFolder: prefs.autoOpenFolder ?? true,
          preserveFilenames: prefs.preserveFilenames ?? true,
          minimizeToTray: prefs.minimizeToTray ?? false,
          strictChannelFiltering: prefs.strictChannelFiltering ?? false
        })
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  },

  refreshQueue: async () => {
    try {
      const queue = await window.api.download.getQueue()
      set({ queue, isDownloading: hasActiveTasks(queue) })
    } catch (err) {
      console.error('Failed to refresh queue:', err)
    }
  },

  initListeners: () => {
    // Idempotente: si ya había listeners (StrictMode, HMR) los quitamos antes.
    activeUnsubscribers.forEach((off) => { try { off() } catch { /* noop */ } })
    activeUnsubscribers = []

    void get().loadPersistedSettings()
    void get().refreshQueue()

    const offQueueUpdated = window.api.download.onQueueUpdated((queue) => {
      set({ queue, isDownloading: hasActiveTasks(queue) })
    })

    const offTaskCompleted = window.api.download.onTaskCompleted((task) => {
      // Aplicamos el evento ANTES de decidir: la cola previa todavía tenía la
      // tarea como `downloading`, así que `allDone` se calculaba mal.
      set((state) => {
        const exists = state.queue.some((t) => t.id === task.id)
        const queue = exists
          ? state.queue.map((t) => (t.id === task.id ? { ...t, ...task } : t))
          : [...state.queue, task]
        return { queue, isDownloading: hasActiveTasks(queue) }
      })

      const state = get()
      if (!state.isDownloading && state.autoOpenFolder && state.outputDir) {
        void window.api.settings.openFolder(state.outputDir)
      }
    })

    const offAllCompleted = window.api.download.onAllCompleted(() => {
      set({ isDownloading: false })
    })

    const offTaskProgress = window.api.download.onTaskProgress((taskId, progress) => {
      set((state) => ({
        queue: state.queue.map((t) =>
          t.id === taskId ? { ...t, progress, status: 'downloading' as const } : t
        ),
        isDownloading: true
      }))
    })

    const offTaskError = window.api.download.onTaskError((taskId, error) => {
      set((state) => {
        const queue = state.queue.map((t) =>
          t.id === taskId ? { ...t, status: 'error' as const, errorMessage: error } : t
        )
        return { queue, isDownloading: hasActiveTasks(queue) }
      })
    })

    activeUnsubscribers = [
      offQueueUpdated,
      offTaskCompleted,
      offAllCompleted,
      offTaskProgress,
      offTaskError
    ]

    return () => {
      activeUnsubscribers.forEach((off) => { try { off() } catch { /* noop */ } })
      activeUnsubscribers = []
    }
  },

  fetchHistory: async (limit = 50, offset = 0) => {
    try {
      const rows = await window.api.download.getHistory(limit, offset)
      return rows || []
    } catch (e) {
      console.error('Failed to load download history:', e)
      return []
    }
  }
}))
