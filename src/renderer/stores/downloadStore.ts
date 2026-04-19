import { create } from 'zustand'

interface DownloadTask {
  id: string
  threadId: string
  guildId: string
  channelId: string
  guildName: string
  channelName: string
  threadName: string
  status: string
  progress: {
    phase: string
    messagesTotal: number
    messagesFetched: number
    assetsTotal: number
    assetsDownloaded: number
    bytesDownloaded: number
    speed: number
    eta: number
    currentFile?: string
  }
  errorMessage?: string
}

interface DownloadState {
  queue: DownloadTask[]
  isDownloading: boolean
  outputDir: string
  exportFormats: string[]
  contentSelection: {
    text: boolean
    images: boolean
    videos: boolean
    files: boolean
    embeds: boolean
    replies: boolean
    metadata: boolean
    customEmojis: boolean
    stickers: boolean
    avatars: boolean
  }
  folderStructure: string
  namingPattern: string
  threadMode: string
  includeToc: boolean
  maxConcurrent: number
  maxFileSize: number // MB, 0 = unlimited
  dateFormat: string
  autoOpenFolder: boolean
  preserveFilenames: boolean
  minimizeToTray: boolean
  strictChannelFiltering: boolean

  startDownload: (threads: any[], guildName: string, channelName: string) => Promise<void>
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
  setAutoOpenFolder: (v: boolean) => void
  setPreserveFilenames: (v: boolean) => void
  setMinimizeToTray: (v: boolean) => void
  setStrictChannelFiltering: (v: boolean) => void
  pickDirectory: () => Promise<void>
  openOutputFolder: () => void
  loadPersistedSettings: () => Promise<void>
  initListeners: () => void
  fetchHistory: (limit?: number, offset?: number) => Promise<any[]>
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
  autoOpenFolder: true,
  preserveFilenames: true,
  minimizeToTray: false,
  strictChannelFiltering: true,

  startDownload: async (threads, guildName, channelName) => {
    const state = get()
    if (!state.outputDir) {
      await get().pickDirectory()
      if (!get().outputDir) return
    }

    set({ isDownloading: true })

    const exportOptions = {
      formats: state.exportFormats,
      outputDir: state.outputDir,
      folderStructure: state.folderStructure,
      namingPattern: state.namingPattern,
      imageQuality: 'original' as const,
      includeToc: state.includeToc,
      threadMode: state.threadMode,
      maxFilenameLength: 120,
      includeAvatars: state.contentSelection.avatars,
      includeStickers: state.contentSelection.stickers,
      includeCustomEmojis: state.contentSelection.customEmojis
    }

    try {
      await window.api.download.start(
        threads,
        guildName,
        channelName,
        exportOptions,
        state.contentSelection
      )
    } catch (error) {
      console.error('Download start failed:', error)
      set({ isDownloading: false })
    }
  },

  pauseAll: () => { window.api.download.pauseAll() },
  resumeAll: () => { window.api.download.resumeAll() },
  cancelTask: (taskId) => { window.api.download.cancel(taskId) },
  retryTask: (taskId) => { window.api.download.retry(taskId) },

  clearCompleted: () => {
    window.api.download.clearCompleted()
  },

  cancelAll: () => {
    window.api.download.cancelAll()
  },

  setOutputDir: (dir) => {
    set({ outputDir: dir })
    window.api.settings.saveOutputDir(dir)
  },
  setExportFormats: (formats) => {
    set({ exportFormats: formats })
    const state = get()
    window.api.settings.saveAll({ exportFormats: formats })
  },
  setContentSelection: (key, value) => {
    set((state) => {
      const next = { ...state.contentSelection, [key]: value }
      window.api.settings.saveAll({ contentSelection: next })
      return { contentSelection: next }
    })
  },
  setFolderStructure: (structure) => {
    set({ folderStructure: structure })
    window.api.settings.saveAll({ folderStructure: structure })
  },
  setNamingPattern: (pattern) => {
    set({ namingPattern: pattern })
    window.api.settings.saveAll({ namingPattern: pattern })
  },
  setThreadMode: (mode) => {
    set({ threadMode: mode })
    window.api.settings.saveAll({ threadMode: mode })
  },
  setIncludeToc: (value) => {
    set({ includeToc: value })
    window.api.settings.saveAll({ includeToc: value })
  },
  setMaxConcurrent: (n) => {
    set({ maxConcurrent: n })
    window.api.download.setConcurrency(n)
    window.api.settings.saveAll({ maxConcurrent: n })
  },
  setMaxFileSize: (mb) => {
    set({ maxFileSize: mb })
    window.api.settings.saveAll({ maxFileSize: mb })
  },
  setDateFormat: (fmt) => {
    set({ dateFormat: fmt })
    window.api.settings.saveAll({ dateFormat: fmt })
  },
  setAutoOpenFolder: (v) => {
    set({ autoOpenFolder: v })
    window.api.settings.saveAll({ autoOpenFolder: v })
  },
  setPreserveFilenames: (v) => {
    set({ preserveFilenames: v })
    window.api.settings.saveAll({ preserveFilenames: v })
  },
  setMinimizeToTray: (v) => {
    set({ minimizeToTray: v })
    window.api.settings.saveAll({ minimizeToTray: v })
  },
  setStrictChannelFiltering: (v) => {
    set({ strictChannelFiltering: v })
    window.api.settings.saveAll({ strictChannelFiltering: v })
  },

  pickDirectory: async () => {
    const dir = await window.api.settings.pickDirectory()
    if (dir) {
      set({ outputDir: dir })
      window.api.settings.saveOutputDir(dir)
    }
  },

  openOutputFolder: () => {
    const dir = get().outputDir
    if (dir) window.api.settings.openFolder(dir)
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
          maxConcurrent: prefs.maxConcurrent || 2,
          maxFileSize: prefs.maxFileSize || 0,
          autoOpenFolder: prefs.autoOpenFolder ?? true,
          preserveFilenames: prefs.preserveFilenames ?? true,
          minimizeToTray: prefs.minimizeToTray ?? false,
          strictChannelFiltering: prefs.strictChannelFiltering ?? true
        })
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  },

  initListeners: () => {
    // Load persisted settings
    get().loadPersistedSettings()

    window.api.download.onQueueUpdated((queue) => {
      set({ queue })
    })
    window.api.download.onTaskCompleted(() => {
      const state = get()
      const allDone = state.queue.every(t => t.status === 'done' || t.status === 'error' || t.status === 'cancelled')
      if (allDone) {
        set({ isDownloading: false })
        // Auto-open folder on completion
        if (state.autoOpenFolder && state.outputDir) {
          window.api.settings.openFolder(state.outputDir)
        }
      }
    })
    window.api.download.onAllCompleted(() => {
      set({ isDownloading: false })
    })
    window.api.download.onTaskProgress((taskId, progress) => {
      set((state) => ({
        queue: state.queue.map(t =>
          t.id === taskId ? { ...t, progress, status: 'downloading' } : t
        )
      }))
    })
    window.api.download.onTaskError((taskId, error) => {
      set((state) => ({
        queue: state.queue.map(t =>
          t.id === taskId ? { ...t, status: 'error', errorMessage: error } : t
        )
      }))
    })
    // Optionally fetch persisted download history when needed.
    // This method does not mutate the store by default; the UI can call it.
  }
  ,
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
