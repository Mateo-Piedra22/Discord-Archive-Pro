// ============================================================
// Contrato IPC compartido entre preload y renderer.
// Una sola definición: si el preload no la cumple, no compila.
// ============================================================

import type {
  ContentSelection,
  DownloadHistoryRecord,
  DownloadTask,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordUser,
  ExportOptions,
  ForumPost,
  ThreadSearchResponse
} from '../core/discord/types'

export interface ArchiveFileEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  children?: ArchiveFileEntry[]
}

export interface ArchiveReadResult {
  content: string
  truncated: boolean
  size: number
}

export interface DbStats {
  totalPosts: number
  totalMessages: number
  totalFiles: number
  totalSize: number
  queuePending: number
  /** Tamaño actual del archivo WAL de SQLite en bytes. */
  walSizeBytes?: number
  /** Tamaño actual del archivo principal SQLite en bytes. */
  dbSizeBytes?: number
}

export interface RateLimiterBucket {
  remaining: number
  limit: number
  resetAt: number
  resetAfter: number
}

export interface RateLimiterStats {
  totalRequests: number
  totalWaitTime: number
  rateLimitHits: number
  requestsPerMinute: number
  averageWaitMs: number
  global: RateLimiterBucket
  routes: Record<string, RateLimiterBucket>
}

export interface DetectedToken {
  source: string
  token: string
  valid: boolean
  user?: DiscordUser
}

export interface DetectionDiagnostic {
  source: string
  kind: 'discord' | 'browser'
  found: boolean
  decrypted: boolean
  detail: string
}

export interface TokenDetectResult {
  success: boolean
  tokens: DetectedToken[]
  diagnostics: DetectionDiagnostic[]
  error?: string
}

export interface WindowState {
  maximized: boolean
  minimized: boolean
  alwaysOnTop: boolean
}

/** Página de mensajes para el visor en vivo (orden ascendente). */
export interface MessagePage {
  messages: DiscordMessage[]
  hasMore: boolean
}

export interface SearchHit {
  /** Ruta absoluta del archivo. */
  path: string
  /** Nombre del archivo. */
  name: string
  /** Ruta relativa al directorio de salida, para mostrar. */
  relative: string
  /** Número de línea (1-based). */
  line: number
  /** Fragmento alrededor de la coincidencia. */
  excerpt: string
}

export interface SearchResult {
  hits: SearchHit[]
  scanned: number
  truncated: boolean
  /** Duración total del escaneo en milisegundos. */
  durationMs?: number
}

/** Telemetría en vivo de memoria, CPU, cachés LRU y estado de SQLite. */
export interface ProcessPerfStats {
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  systemFreeBytes: number
  systemTotalBytes: number
  cpuPercent: number
  uptimeSeconds: number
  caches: {
    usersSize: number
    usersCapacity: number
    channelsSize: number
    channelsCapacity: number
  }
  db: DbStats
}

/** Resultado de la acción de optimización de memoria y caché. */
export interface MemoryOptimizeResult {
  heapBeforeBytes: number
  heapAfterBytes: number
  walBeforeBytes: number
  walAfterBytes: number
  cachesCleared: number
}

/** Resultado de la verificación y reparación de integridad de la caché. */
export interface CacheIntegrityResult {
  checkedFiles: number
  invalidatedFiles: number
  orphanPosts: number
  integrityOk: boolean
}

export interface ArchiveStats {
  posts: number
  messages: number
  files: number
  bytes: number
  servers: { name: string; posts: number; bytes: number }[]
  recent: {
    threadName: string
    status: string
    completedAt: string | null
    bytes: number
    downloadPath?: string | null
  }[]
}

export interface AuthResult {
  success: boolean
  user?: DiscordUser
  error?: string
}

export interface SimpleResult {
  success: boolean
  error?: string
}

/** Preferencias tal como las ve el renderer (nunca incluye el token). */
export interface AppPreferences {
  windowMode: 'expanded' | 'compact' | 'minimized'
  alwaysOnTop: boolean
  outputDirectory: string
  lastGuildId: string | null
  lastChannelId: string | null
  exportFormats: string[]
  folderStructure: string
  namingPattern: string
  includeToc: boolean
  threadMode: string
  maxFilenameLength: number
  includeAvatars: boolean
  includeStickers: boolean
  includeCustomEmojis: boolean
  syncMode: string
  maxConcurrent: number
  maxFileSize: number
  autoOpenFolder: boolean
  preserveFilenames: boolean
  contentSelection: ContentSelection
  minimizeToTray: boolean
  strictChannelFiltering: boolean
  dateFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'YYYYMMDD'
}

export interface ThreadMessageProgress {
  count: number
  total: number
}

export type Unsubscribe = () => void

export interface AppApi {
  auth: {
    setToken: (token: string) => Promise<AuthResult>
    validate: () => Promise<AuthResult>
    clear: () => Promise<void>
    onAutoConnected: (callback: (connected: boolean) => void) => Unsubscribe
  }

  discord: {
    getGuilds: () => Promise<DiscordGuild[]>
    getGuild: (guildId: string) => Promise<DiscordGuild>
    getChannels: (guildId: string) => Promise<DiscordChannel[]>
    getChannelInfo: (channelId: string) => Promise<DiscordChannel>
    getForumPosts: (channelId: string, offset?: number) => Promise<ThreadSearchResponse>
    getAllForumPosts: (channelId: string) => Promise<ForumPost[]>
    cancelGetAllForumPosts: (channelId: string) => Promise<SimpleResult>
    onForumPostsProgress: (callback: (progress: ThreadMessageProgress) => void) => Unsubscribe
    getThreadMessages: (threadId: string) => Promise<DiscordMessage[]>
    /** Página de mensajes para lectura sin descargar (ascendente). */
    getMessagePage: (threadId: string, before?: string, limit?: number) => Promise<MessagePage>
    getGuildIcon: (guildId: string, hash: string | null) => Promise<string | null>
  }

  cache: {
    checkPost: (threadId: string) => Promise<unknown>
    checkStatus: (threadId: string) => Promise<string>
    getCachedPosts: (channelId: string) => Promise<unknown[]>
    clear: () => Promise<SimpleResult>
    verifyIntegrity: () => Promise<CacheIntegrityResult>
  }

  download: {
    start: (
      threads: { thread: unknown; tags: unknown[] }[],
      guildName: string,
      channelName: string,
      exportOptions: ExportOptions,
      contentSelection: ContentSelection
    ) => Promise<string[]>
    getQueue: () => Promise<DownloadTask[]>
    getHistory: (limit?: number, offset?: number) => Promise<DownloadHistoryRecord[]>
    pauseAll: () => Promise<SimpleResult>
    resumeAll: () => Promise<SimpleResult>
    cancel: (taskId: string) => Promise<SimpleResult>
    cancelAll: () => Promise<SimpleResult>
    clearCompleted: () => Promise<SimpleResult>
    retry: (taskId: string) => Promise<SimpleResult>
    retryAllFailed: () => Promise<{ count: number }>
    removeTask: (taskId: string) => Promise<{ success: boolean }>
    setConcurrency: (n: number) => Promise<SimpleResult>
    onTaskStarted: (cb: (task: DownloadTask) => void) => Unsubscribe
    onTaskProgress: (cb: (taskId: string, progress: DownloadTask['progress']) => void) => Unsubscribe
    onTaskCompleted: (cb: (task: DownloadTask) => void) => Unsubscribe
    onTaskError: (cb: (taskId: string, error: string) => void) => Unsubscribe
    onQueueUpdated: (cb: (queue: DownloadTask[]) => void) => Unsubscribe
    onAllCompleted: (cb: () => void) => Unsubscribe
  }

  settings: {
    pickDirectory: () => Promise<string | null>
    getRateLimiterStats: () => Promise<RateLimiterStats | null>
    getDbStats: () => Promise<DbStats>
    saveOutputDir: (dir: string) => Promise<void>
    saveAll: (preferences: Record<string, unknown>) => Promise<SimpleResult>
    getAll: () => Promise<AppPreferences>
    openFolder: (path: string) => Promise<boolean>
    revealFolder: (path: string) => Promise<void>
  }

  tokenDetector: {
    detect: () => Promise<TokenDetectResult>
  }

  archive: {
    scanDirectory: (dirPath: string) => Promise<ArchiveFileEntry[]>
    readFile: (filePath: string) => Promise<ArchiveReadResult>
    /** Busca texto en los archivos del archivo local. */
    search: (query: string, limit?: number) => Promise<SearchResult>
    toUrl: (filePath: string) => string
  }

  app: {
    /** Métricas agregadas del archivo local. */
    getStats: () => Promise<ArchiveStats>
    /** Telemetría en vivo de memoria, CPU y cachés del proceso principal. */
    getPerfStats: () => Promise<ProcessPerfStats>
    /** Ejecuta limpieza de caché LRU, checkpoint WAL y liberación de memoria SQLite. */
    optimizeMemory: () => Promise<MemoryOptimizeResult>
    /**
     * Abre un enlace externo en el navegador o en el cliente de Discord.
     * Solo se permiten dominios de Discord (https o esquema discord:).
     */
    openExternal: (url: string) => Promise<boolean>
  }

  window: {
    minimize: () => void
    toggleMaximize: () => void
    toggleCompact: () => void
    close: () => void
    setAlwaysOnTop: (value: boolean) => void
    setZoom: (factor: number) => void
    getState: () => Promise<WindowState>
    /** Devuelve la ventana a tamaño y posición usables. */
    resetState: () => Promise<{ success: boolean }>
    onModeChanged: (cb: (mode: string) => void) => Unsubscribe
    onStateChanged: (cb: (state: { maximized: boolean }) => void) => Unsubscribe
  }
}
