// ============================================================
// Preload Script — Context bridge exposing safe APIs
// to the renderer process.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Auth
  auth: {
    setToken: (token: string) => ipcRenderer.invoke('auth:set-token', token),
    getToken: () => ipcRenderer.invoke('auth:get-token'),
    validate: () => ipcRenderer.invoke('auth:validate'),
    clear: () => ipcRenderer.invoke('auth:clear'),
    onAutoConnected: (callback: (connected: boolean) => void) =>
      ipcRenderer.on('auth:auto-connected', (_e, connected) => callback(connected))
  },

  // Discord browsing
  discord: {
    getGuilds: () => ipcRenderer.invoke('discord:get-guilds'),
    getChannels: (guildId: string) => ipcRenderer.invoke('discord:get-channels', guildId),
    getChannelInfo: (channelId: string) => ipcRenderer.invoke('discord:get-channel-info', channelId),
    getForumPosts: (channelId: string, offset?: number) =>
      ipcRenderer.invoke('discord:get-forum-posts', channelId, offset),
    getAllForumPosts: (channelId: string) =>
      ipcRenderer.invoke('discord:get-all-forum-posts', channelId),
    getThreadMessages: (threadId: string) =>
      ipcRenderer.invoke('discord:get-thread-messages', threadId),
    getGuild: (guildId: string) =>
      ipcRenderer.invoke('discord:get-guild', guildId),
    getGuildIcon: (guildId: string, hash: string | null) =>
      ipcRenderer.invoke('discord:get-guild-icon', guildId, hash)
  },

  // Cache
  cache: {
    checkPost: (threadId: string) => ipcRenderer.invoke('cache:check-post', threadId),
    checkStatus: (threadId: string) => ipcRenderer.invoke('cache:check-status', threadId),
    getCachedPosts: (channelId: string) => ipcRenderer.invoke('cache:get-cached-posts', channelId),
    clear: () => ipcRenderer.invoke('cache:clear')
  },

  // Downloads
  download: {
    start: (threads: any[], guildName: string, channelName: string, exportOptions: any, contentSelection: any) =>
      ipcRenderer.invoke('download:start', threads, guildName, channelName, exportOptions, contentSelection),
    getQueue: () => ipcRenderer.invoke('download:get-queue'),
    pauseAll: () => ipcRenderer.invoke('download:pause-all'),
    resumeAll: () => ipcRenderer.invoke('download:resume-all'),
    cancel: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),
    cancelAll: () => ipcRenderer.invoke('download:cancel-all'),
    clearCompleted: () => ipcRenderer.invoke('download:clear-completed'),
    retry: (taskId: string) => ipcRenderer.invoke('download:retry', taskId),
    setConcurrency: (n: number) => ipcRenderer.invoke('download:set-concurrency', n),

    // getHistory: Query persisted download history (audit/exports). Returns an
    // array of recent completed/errored exports. Non-blocking and paginated.
    getHistory: (limit = 50, offset = 0) => ipcRenderer.invoke('download:get-history', limit, offset),

    // Events from main
    onTaskStarted: (callback: (task: any) => void) =>
      ipcRenderer.on('download:task-started', (_e, task) => callback(task)),
    onTaskProgress: (callback: (taskId: string, progress: any) => void) =>
      ipcRenderer.on('download:task-progress', (_e, taskId, progress) => callback(taskId, progress)),
    onTaskCompleted: (callback: (task: any) => void) =>
      ipcRenderer.on('download:task-completed', (_e, task) => callback(task)),
    onTaskError: (callback: (taskId: string, error: string) => void) =>
      ipcRenderer.on('download:task-error', (_e, taskId, error) => callback(taskId, error)),
    onQueueUpdated: (callback: (queue: any[]) => void) =>
      ipcRenderer.on('download:queue-updated', (_e, queue) => callback(queue)),
    onAllCompleted: (callback: () => void) =>
      ipcRenderer.on('download:all-completed', () => callback())
  },

  // Settings
  settings: {
    pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),
    getRateLimiterStats: () => ipcRenderer.invoke('settings:get-rate-limiter-stats'),
    getDbStats: () => ipcRenderer.invoke('settings:get-db-stats'),
    saveOutputDir: (dir: string) => ipcRenderer.invoke('settings:save-output-dir', dir),
    getOutputDir: () => ipcRenderer.invoke('settings:get-output-dir'),
    saveAll: (preferences: any) => ipcRenderer.invoke('settings:save-all', preferences),
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    openFolder: (path: string) => ipcRenderer.invoke('folder:open', path),
    revealFolder: (path: string) => ipcRenderer.invoke('folder:reveal', path)
  },

  // Token auto-detection
  tokenDetector: {
    detect: () => ipcRenderer.invoke('token:detect')
  },

  // Archive viewer
  archive: {
    scanDirectory: (dirPath: string) => ipcRenderer.invoke('archive:scan-directory', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('archive:read-file', filePath),
    readBinaryFile: (path: string) => ipcRenderer.invoke('archive:read-binary-file', path)
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    toggleCompact: () => ipcRenderer.send('window:toggle-compact'),
    close: () => ipcRenderer.send('window:close'),
    setAlwaysOnTop: (value: boolean) => ipcRenderer.send('window:set-always-on-top', value),
    setZoom: (level: number) => ipcRenderer.send('window:set-zoom', level),
    onModeChanged: (callback: (mode: string) => void) =>
      ipcRenderer.on('window-mode-changed', (_e, mode) => callback(mode))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
