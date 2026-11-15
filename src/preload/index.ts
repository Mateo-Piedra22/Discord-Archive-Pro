// ============================================================
// Preload — Context bridge. Única superficie que el renderer
// puede tocar. Todas las suscripciones devuelven unsub().
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
    callback(...(args as T))
  }
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  // Autenticación
  auth: {
    setToken: (token: string) => ipcRenderer.invoke('auth:set-token', token),
    validate: () => ipcRenderer.invoke('auth:validate'),
    clear: () => ipcRenderer.invoke('auth:clear'),
    onAutoConnected: (callback: (connected: boolean) => void) =>
      subscribe<[boolean]>('auth:auto-connected', callback)
  },

  // Navegación de Discord
  discord: {
    getGuilds: () => ipcRenderer.invoke('discord:get-guilds'),
    getGuild: (guildId: string) => ipcRenderer.invoke('discord:get-guild', guildId),
    getChannels: (guildId: string) => ipcRenderer.invoke('discord:get-channels', guildId),
    getChannelInfo: (channelId: string) => ipcRenderer.invoke('discord:get-channel-info', channelId),
    getForumPosts: (channelId: string, offset?: number) =>
      ipcRenderer.invoke('discord:get-forum-posts', channelId, offset),
    getAllForumPosts: (channelId: string) => ipcRenderer.invoke('discord:get-all-forum-posts', channelId),
    cancelGetAllForumPosts: (channelId: string) =>
      ipcRenderer.invoke('discord:cancel-get-all-forum-posts', channelId),
    onForumPostsProgress: (callback: (progress: { count: number; total: number }) => void) =>
      subscribe<[{ count: number; total: number }]>('forum-posts-progress', callback),
    getThreadMessages: (threadId: string) => ipcRenderer.invoke('discord:get-thread-messages', threadId),
    getMessagePage: (threadId: string, before?: string, limit?: number) =>
      ipcRenderer.invoke('discord:get-message-page', threadId, before, limit),
    getGuildIcon: (guildId: string, hash: string | null) =>
      ipcRenderer.invoke('discord:get-guild-icon', guildId, hash)
  },

  // Caché
  cache: {
    checkPost: (threadId: string) => ipcRenderer.invoke('cache:check-post', threadId),
    checkStatus: (threadId: string) => ipcRenderer.invoke('cache:check-status', threadId),
    getCachedPosts: (channelId: string) => ipcRenderer.invoke('cache:get-cached-posts', channelId),
    clear: () => ipcRenderer.invoke('cache:clear'),
    verifyIntegrity: () => ipcRenderer.invoke('cache:verify-integrity')
  },

  // Descargas
  download: {
    start: (
      threads: unknown[],
      guildName: string,
      channelName: string,
      exportOptions: unknown,
      contentSelection: unknown
    ) => ipcRenderer.invoke('download:start', threads, guildName, channelName, exportOptions, contentSelection),
    getQueue: () => ipcRenderer.invoke('download:get-queue'),
    getHistory: (limit = 50, offset = 0) => ipcRenderer.invoke('download:get-history', limit, offset),
    pauseAll: () => ipcRenderer.invoke('download:pause-all'),
    resumeAll: () => ipcRenderer.invoke('download:resume-all'),
    cancel: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),
    cancelAll: () => ipcRenderer.invoke('download:cancel-all'),
    clearCompleted: () => ipcRenderer.invoke('download:clear-completed'),
    retry: (taskId: string) => ipcRenderer.invoke('download:retry', taskId),
    retryAllFailed: () => ipcRenderer.invoke('download:retry-all-failed'),
    removeTask: (taskId: string) => ipcRenderer.invoke('download:remove-task', taskId),
    setConcurrency: (n: number) => ipcRenderer.invoke('download:set-concurrency', n),

    onTaskStarted: (cb: (task: unknown) => void) => subscribe<[unknown]>('download:task-started', cb),
    onTaskProgress: (cb: (taskId: string, progress: unknown) => void) =>
      subscribe<[string, unknown]>('download:task-progress', cb),
    onTaskCompleted: (cb: (task: unknown) => void) => subscribe<[unknown]>('download:task-completed', cb),
    onTaskError: (cb: (taskId: string, error: string) => void) =>
      subscribe<[string, string]>('download:task-error', cb),
    onQueueUpdated: (cb: (queue: unknown[]) => void) => subscribe<[unknown[]]>('download:queue-updated', cb),
    onAllCompleted: (cb: () => void) => subscribe<[]>('download:all-completed', cb)
  },

  // Ajustes
  settings: {
    pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),
    getRateLimiterStats: () => ipcRenderer.invoke('settings:get-rate-limiter-stats'),
    getDbStats: () => ipcRenderer.invoke('settings:get-db-stats'),
    saveOutputDir: (dir: string) => ipcRenderer.invoke('settings:save-output-dir', dir),
    saveAll: (preferences: Record<string, unknown>) => ipcRenderer.invoke('settings:save-all', preferences),
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    openFolder: (path: string) => ipcRenderer.invoke('folder:open', path),
    revealFolder: (path: string) => ipcRenderer.invoke('folder:reveal', path)
  },

  // Auto-detección de token
  tokenDetector: {
    detect: () => ipcRenderer.invoke('token:detect')
  },

  // Visor de archivo — solo lectura dentro del directorio de salida
  archive: {
    scanDirectory: (dirPath: string) => ipcRenderer.invoke('archive:scan-directory', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('archive:read-file', filePath),
    search: (query: string, limit?: number) => ipcRenderer.invoke('archive:search', query, limit),
    /** URL archive:// que el protocolo del main resuelve de forma segura. */
    toUrl: (filePath: string) => `archive://local/${encodeURIComponent(filePath)}`
  },

  app: {
    getStats: () => ipcRenderer.invoke('app:get-stats'),
    getPerfStats: () => ipcRenderer.invoke('app:get-perf-stats'),
    optimizeMemory: () => ipcRenderer.invoke('app:optimize-memory'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url)
  },

  // Controles de ventana
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    toggleCompact: () => ipcRenderer.send('window:toggle-compact'),
    close: () => ipcRenderer.send('window:close'),
    setAlwaysOnTop: (value: boolean) => ipcRenderer.send('window:set-always-on-top', value),
    /** factor: 1 = 100 %, 1.5 = 150 %. Rango válido 0.8–2.0. */
    setZoom: (factor: number) => ipcRenderer.send('window:set-zoom', factor),
    getState: () => ipcRenderer.invoke('window:get-state'),
    resetState: () => ipcRenderer.invoke('window:reset-state'),
    onModeChanged: (cb: (mode: string) => void) => subscribe<[string]>('window-mode-changed', cb),
    onStateChanged: (cb: (state: { maximized: boolean }) => void) =>
      subscribe<[{ maximized: boolean }]>('window:state', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
