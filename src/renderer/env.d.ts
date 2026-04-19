declare global {
  interface Window {
    api: {
      auth: {
        setToken: (token: string) => Promise<{ success: boolean; user?: any; error?: string }>
        getToken: () => Promise<string | null>
        validate: () => Promise<{ success: boolean; user?: any; error?: string }>
        clear: () => Promise<void>
        onAutoConnected: (callback: (connected: boolean) => void) => void
      }
      discord: {
        getGuilds: () => Promise<any[]>
        getChannels: (guildId: string) => Promise<any[]>
        getChannelInfo: (channelId: string) => Promise<any>
        getForumPosts: (channelId: string, offset?: number) => Promise<any>
        getAllForumPosts: (channelId: string) => Promise<any[]>
        getThreadMessages: (threadId: string) => Promise<any[]>
        getGuild: (guildId: string) => Promise<any>
        getGuildIcon: (guildId: string, hash: string | null) => Promise<string | null>
      }
      cache: {
        checkPost: (threadId: string) => Promise<any>
        checkStatus: (threadId: string) => Promise<string>
        getCachedPosts: (channelId: string) => Promise<any[]>
        clear: () => Promise<{ success: boolean; error?: string }>
      }
      download: {
        start: (threads: any[], guildName: string, channelName: string, exportOptions: any, contentSelection: any) => Promise<string[]>
        getHistory: (limit?: number, offset?: number) => Promise<any[]>
        getQueue: () => Promise<any[]>
        pauseAll: () => Promise<void>
        resumeAll: () => Promise<void>
        cancel: (taskId: string) => Promise<void>
        cancelAll: () => Promise<void>
        clearCompleted: () => Promise<void>
        retry: (taskId: string) => Promise<void>
        setConcurrency: (n: number) => Promise<void>
        onTaskStarted: (callback: (task: any) => void) => void
        onTaskProgress: (callback: (taskId: string, progress: any) => void) => void
        onTaskCompleted: (callback: (task: any) => void) => void
        onTaskError: (callback: (taskId: string, error: string) => void) => void
        onQueueUpdated: (callback: (queue: any[]) => void) => void
        onAllCompleted: (callback: () => void) => void
      }
      settings: {
        pickDirectory: () => Promise<string | null>
        getRateLimiterStats: () => Promise<any>
        getDbStats: () => Promise<any>
        saveOutputDir: (dir: string) => Promise<void>
        getOutputDir: () => Promise<string>
        saveAll: (preferences: any) => Promise<void>
        getAll: () => Promise<any>
        openFolder: (path: string) => Promise<boolean>
        revealFolder: (path: string) => Promise<void>
      }
      archive: {
        scanDirectory: (dirPath: string) => Promise<any[]>
        readFile: (filePath: string) => Promise<string>
        readBinaryFile: (filePath: string) => Promise<Uint8Array | null>
      }
      window: {
        minimize: () => void
        toggleMaximize: () => void
        toggleCompact: () => void
        close: () => void
        setAlwaysOnTop: (value: boolean) => void
        setZoom: (level: number) => void
        onModeChanged: (callback: (mode: string) => void) => void
      }
      tokenDetector: {
        detect: () => Promise<{ success: boolean; tokens: { source: string; token: string; valid: boolean; user?: any }[]; error?: string }>
      }
    }
  }
}
export {}
