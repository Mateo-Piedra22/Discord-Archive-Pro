// ============================================================
// Electron Main Process — App lifecycle, window creation,
// IPC handlers, tray, and shortcuts.
// ============================================================

import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage, shell } from 'electron'
import path from 'path'
import { initDatabase, closeDatabase, resetStuckDownloads } from '../core/storage/database'
import {
  initStore, getStore, getToken, setToken, clearToken,
  getWindowBounds, setWindowBounds, getWindowMode, setWindowMode,
  getOutputDirectory, setOutputDirectory, getAllPreferences
} from '../core/storage/encrypted-store'
import { DiscordClient } from '../core/discord/api-client'
import { DownloadManager } from '../core/download/download-manager'
import { CacheManager } from '../core/storage/cache-manager'
import { TokenDetector } from '../core/discord/token-detector'
import * as db from '../core/storage/database'
import type { ExportOptions, ContentSelection } from '../core/discord/types'
import cron from 'node-cron'
import { Notification } from 'electron'
import i18next from 'i18next'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let discordClient: DiscordClient | null = null
let downloadManager: DownloadManager | null = null
let isQuitting = false

// Ensure single instance
const gotTheSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotTheSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  // Initialize storage
  initStore()
  initDatabase()

  // Crash Recovery: Reset stuck downloads
  resetStuckDownloads()

  createMainWindow()
  createTray()
  registerShortcuts()
  setupIpcHandlers()
  setupI18n()
  setupBackgroundCron()

  // Auto-detect token on startup if none stored
  const storedToken = getToken()
  if (storedToken) {
    try {
      discordClient = new DiscordClient(storedToken)
      await discordClient.validateToken()
      mainWindow?.webContents.send('auth:auto-connected', true)
    } catch {
      // Token expired/invalid — user will need to re-enter
      clearToken()
      mainWindow?.webContents.send('auth:auto-connected', false)
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeDatabase()
})

// ==================== Window ====================

function createMainWindow(): void {
  const savedBounds = getWindowBounds()
  const savedMode = getWindowMode()

  const width = savedMode === 'compact' ? 320 : 900
  const height = 650

  mainWindow = new BrowserWindow({
    title: 'Discord Archive Pro',
    icon: path.join(__dirname, '../../resources/icon.png'),
    width: savedBounds?.width || width,
    height: savedBounds?.height || height,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 320,
    minHeight: 400,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    show: false,
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false // Required to view local files (images/PDFs) directly
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      const s = getStore()
      if (s.get('minimizeToTray')) {
        event.preventDefault()
        mainWindow?.hide()
      }
    }
  })

  mainWindow.on('moved', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds()
      setWindowBounds(bounds)
    }
  })

  mainWindow.on('resized', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds()
      setWindowBounds(bounds)
    }
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ==================== Tray ====================

function createTray(): void {
  const iconPath = path.join(__dirname, '../../resources/icon.png')
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(1)) : icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostrar/Ocultar',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Siempre Arriba',
      type: 'checkbox',
      checked: false,
      click: (item) => {
        mainWindow?.setAlwaysOnTop(item.checked)
      }
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Discord Archive Pro')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

// ==================== Shortcuts ====================

function registerShortcuts(): void {
  globalShortcut.register('Ctrl+Shift+F', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  globalShortcut.register('Ctrl+Shift+M', () => {
    if (mainWindow) {
      const [width] = mainWindow.getSize()
      if (width > 350) {
        mainWindow.setSize(320, mainWindow.getSize()[1])
        setWindowMode('compact')
      } else {
        mainWindow.setSize(900, mainWindow.getSize()[1])
        setWindowMode('expanded')
      }
      mainWindow.webContents.send('window-mode-changed', width > 350 ? 'compact' : 'expanded')
    }
  })
}

// ==================== Background Tasks & i18n ====================

function setupBackgroundCron(): void {
  // Ej: Cada 4 horas revisamos "favoritos" / cache base
  cron.schedule('0 */4 * * *', async () => {
    if (!discordClient) return
    const cachedPosts = db.getDatabase().prepare('SELECT thread_id, channel_id FROM cached_posts LIMIT 50').all() as any[]
    let newFiles = 0;
    
    for (const post of cachedPosts) {
      try {
        const msgs = await discordClient.getThreadMessages(post.thread_id, { limit: 10 });
        if (msgs.length > 0) newFiles++;
      } catch {}
    }

    if (newFiles > 0) {
      new Notification({
        title: i18next.t('cron_title', 'Sincronización Completada'),
        body: i18next.t('cron_body', `Se encontraron novedades en ${newFiles} posts.`)
      }).show()
    }
  })
}

function setupI18n(): void {
  const localesPath = path.join(app.getAppPath(), 'locales')
  if (!fs.existsSync(localesPath)) fs.mkdirSync(localesPath, { recursive: true })
  
  const esPath = path.join(localesPath, 'es.json')
  const enPath = path.join(localesPath, 'en.json')
  
  // Create default fallback if missing
  if (!fs.existsSync(esPath)) fs.writeFileSync(esPath, JSON.stringify({
    "cron_title": "Sincronización Completada",
    "cron_body": "Se encontraron novedades en {{count}} posts."
  }))
  if (!fs.existsSync(enPath)) fs.writeFileSync(enPath, JSON.stringify({
    "cron_title": "Sync Completed",
    "cron_body": "Found updates in {{count}} posts."
  }))

  const es = JSON.parse(fs.readFileSync(esPath, 'utf-8'))
  const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'))

  i18next.init({
    lng: 'es',
    fallbackLng: 'en',
    resources: {
      es: { translation: es },
      en: { translation: en }
    }
  })

  ipcMain.handle('i18n:change-language', (_event, lng: string) => {
    i18next.changeLanguage(lng)
    return { success: true }
  })

  ipcMain.handle('i18n:get-translation', (_event, key: string, params?: any) => {
    return i18next.t(key, params)
  })
}

// ==================== IPC Handlers ====================

function setupIpcHandlers(): void {
  // --- Auth ---
  ipcMain.handle('auth:set-token', async (_event, token: string) => {
    try {
      const client = new DiscordClient(token)
      const user = await client.validateToken()
      setToken(token)
      discordClient = client
      return { success: true, user }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('auth:get-token', async () => {
    return getToken()
  })

  ipcMain.handle('auth:validate', async () => {
    const token = getToken()
    if (!token) return { success: false, error: 'No token stored' }
    try {
      if (!discordClient) discordClient = new DiscordClient(token)
      const user = await discordClient.validateToken()
      return { success: true, user }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('auth:clear', async () => {
    clearToken()
    discordClient?.destroy()
    discordClient = null
  })

  // --- Discord Browsing ---
  ipcMain.handle('discord:get-guilds', async () => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getGuilds()
  })

  ipcMain.handle('discord:get-guild', async (_event, guildId: string) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getGuild(guildId)
  })

  ipcMain.handle('discord:get-channels', async (_event, guildId: string) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getChannels(guildId)
  })

  ipcMain.handle('discord:get-channel-info', async (_event, channelId: string) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getChannel(channelId)
  })

  ipcMain.handle('discord:get-forum-posts', async (_event, channelId: string, offset?: number) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.searchForumThreads(channelId, {
      sort_by: 'creation_time',
      sort_order: 'desc',
      offset: offset || 0,
      limit: 25
    })
  })

  ipcMain.handle('discord:get-all-forum-posts', async (_event, channelId: string) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getAllForumPosts(channelId, (count, total) => {
      mainWindow?.webContents.send('forum-posts-progress', { count, total })
    })
  })

  ipcMain.handle('discord:get-thread-messages', async (_event, threadId: string) => {
    if (!discordClient) throw new Error('Not authenticated')
    return discordClient.getAllThreadMessages(threadId)
  })

  ipcMain.handle('discord:get-guild-icon', async (_event, guildId: string, hash: string | null) => {
    if (!discordClient || !hash) return null
    return discordClient.getGuildIconUrl(guildId, hash)
  })

  // --- Cache ---
  ipcMain.handle('cache:check-post', async (_event, threadId: string) => {
    return db.getCachedPost(threadId)
  })

  ipcMain.handle('cache:check-status', async (_event, threadId: string) => {
    return CacheManager.getPostStatus(threadId)
  })

  ipcMain.handle('cache:get-cached-posts', async (_event, channelId: string) => {
    return db.getCachedPostsByChannel(channelId)
  })

  ipcMain.handle('cache:clear', async () => {
    try {
      db.clearAllCache()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // --- Downloads ---
  ipcMain.handle('download:start', async (
    _event,
    threads: any[],
    guildName: string,
    channelName: string,
    exportOptions: ExportOptions,
    contentSelection: ContentSelection
  ) => {
    if (!discordClient) throw new Error('Not authenticated')

    if (!downloadManager) {
      downloadManager = new DownloadManager(discordClient, {
        concurrency: 2,
        exportOptions,
        contentSelection
      })

      // Forward events to renderer
      downloadManager.on('task-started', (task) => {
        mainWindow?.webContents.send('download:task-started', task)
      })
      downloadManager.on('task-progress', (taskId, progress) => {
        mainWindow?.webContents.send('download:task-progress', taskId, progress)
      })
      downloadManager.on('task-completed', (task) => {
        mainWindow?.webContents.send('download:task-completed', task)
      })
      downloadManager.on('task-error', (taskId, error) => {
        mainWindow?.webContents.send('download:task-error', taskId, error)
      })
      downloadManager.on('queue-updated', (queue) => {
        mainWindow?.webContents.send('download:queue-updated', queue)
      })
      downloadManager.on('all-completed', () => {
        mainWindow?.webContents.send('download:all-completed')
      })
    } else {
      downloadManager.updateOptions(exportOptions, contentSelection)
    }

    return downloadManager.addToQueue(threads, guildName, channelName)
  })

  ipcMain.handle('download:get-queue', async () => {
    return downloadManager?.getQueue() || []
  })

  // IPC: Expose persisted download history to renderer.
  // What: returns recent entries from `download_history` table (created by migration v3).
  // Why: allows the UI to show an audit/history view without scanning directories.
  // How: calls the DB helper and always returns an array; non-fatal on error.
  ipcMain.handle('download:get-history', async (_event, limit = 50, offset = 0) => {
    try {
      return db.getDownloadHistory(limit, offset)
    } catch (e) {
      console.warn('[IPC] download:get-history failed:', (e as Error).message)
      return []
    }
  })

  ipcMain.handle('download:pause-all', async () => {
    downloadManager?.pauseAll()
    return { success: true }
  })

  ipcMain.handle('download:resume-all', async () => {
    downloadManager?.resumeAll()
    return { success: true }
  })

  ipcMain.handle('download:cancel', async (_event, taskId: string) => {
    downloadManager?.cancelTask(taskId)
    return { success: true }
  })

  ipcMain.handle('download:cancel-all', async () => {
    downloadManager?.cancelAll()
    return { success: true }
  })

  ipcMain.handle('download:clear-completed', async () => {
    downloadManager?.clearCompleted()
    return { success: true }
  })

  ipcMain.handle('download:retry', async (_event, taskId: string) => {
    await downloadManager?.retryTask(taskId)
    return { success: true }
  })

  ipcMain.handle('download:set-concurrency', async (_event, concurrency: number) => {
    downloadManager?.setConcurrency(concurrency)
    return { success: true }
  })

  // --- Settings ---
  ipcMain.handle('settings:pick-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Seleccionar carpeta de descarga'
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:get-rate-limiter-stats', async () => {
    return discordClient?.limiter.getStats() || null
  })

  ipcMain.handle('settings:get-db-stats', async () => {
    return db.getDbStats()
  })

  // --- Window ---
  ipcMain.on('window:minimize', () => {
    const s = getStore()
    if (s.get('minimizeToTray')) {
      mainWindow?.hide()
    } else {
      mainWindow?.minimize()
    }
  })

  ipcMain.on('window:toggle-compact', () => {
    if (mainWindow) {
      const [width] = mainWindow.getSize()
      if (width > 350) {
        mainWindow.setSize(320, mainWindow.getSize()[1])
      } else {
        mainWindow.setSize(900, mainWindow.getSize()[1])
      }
    }
  })

  ipcMain.on('window:toggle-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    }
  })

  ipcMain.on('window:close', () => {
    const s = getStore()
    if (s.get('minimizeToTray')) {
      mainWindow?.hide()
    } else {
      isQuitting = true
      app.quit()
    }
  })

  ipcMain.on('window:set-always-on-top', (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(value)
  })

  ipcMain.on('window:set-zoom', (_event, level: number) => {
    mainWindow?.webContents.setZoomLevel(level)
  })

  // --- Token Auto-Detection ---
  ipcMain.handle('token:detect', async () => {
    try {
      const result = await TokenDetector.detectAndValidate()
      return {
        success: true,
        tokens: result.valid.map(v => ({
          source: v.source,
          token: v.token,
          valid: true,
          user: v.user
        }))
      }
    } catch (error: any) {
      return { success: false, tokens: [], error: error.message }
    }
  })

  // --- Folder operations ---
  ipcMain.handle('folder:open', async (_event, folderPath: string) => {
    try {
      await shell.openPath(folderPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('folder:reveal', async (_event, folderPath: string) => {
    shell.showItemInFolder(folderPath)
  })

  // --- Persisted Settings ---
  ipcMain.handle('settings:save-output-dir', async (_event, dir: string) => {
    setOutputDirectory(dir)
  })

  ipcMain.handle('settings:save-all', async (_event, preferences: any) => {
    const s = getStore()
    Object.keys(preferences).forEach((key) => {
      if (key !== 'encryptedToken') {
        s.set(key as any, preferences[key])
      }
    })
    return { success: true }
  })

  ipcMain.handle('settings:get-all', async () => {
    return getAllPreferences()
  })

  // --- Archive Viewer ---
  ipcMain.handle('archive:scan-directory', async (_event, dirPath: string) => {
    const fsModule = await import('fs')
    const pathModule = await import('path')

    // Increase maxDepth to handle deep Discord archives (Guild -> Channel -> Subject -> assets -> ...)
    function scanDir(dir: string, maxDepth = 20, depth = 0): any[] {
      if (depth >= maxDepth) return []
      try {
        if (!fsModule.existsSync(dir)) return []
        const entries = fsModule.readdirSync(dir, { withFileTypes: true })
        return entries
          .filter(e => !e.name.startsWith('.'))
          .sort((a, b) => {
            // dirs first, then alphabetical
            if (a.isDirectory() && !b.isDirectory()) return -1
            if (!a.isDirectory() && b.isDirectory()) return 1
            return a.name.localeCompare(b.name)
          })
          .map(e => {
            const fullPath = pathModule.join(dir, e.name)
            try {
              if (e.isDirectory()) {
                const children = scanDir(fullPath, maxDepth, depth + 1)
                return { name: e.name, path: fullPath, type: 'dir', children }
              }
              const stats = fsModule.statSync(fullPath)
              return { name: e.name, path: fullPath, type: 'file', size: stats.size }
            } catch (err) {
              console.error(`Error scanning entry ${fullPath}:`, err)
              return null
            }
          })
          .filter(Boolean)
      } catch (err) {
        console.error(`Error scanning directory ${dir}:`, err)
        return []
      }
    }

    return scanDir(dirPath)
  })

  ipcMain.handle('archive:read-file', async (_event, filePath: string) => {
    const fsModule = await import('fs')
    try {
      const content = fsModule.readFileSync(filePath, 'utf-8')
      // Limit to 100KB for preview
      return content.length > 100000 ? content.substring(0, 100000) + '\n\n... (truncado)' : content
    } catch {
      return 'Error: no se pudo leer el archivo'
    }
  })

  ipcMain.handle('archive:read-binary-file', async (_event, filePath: string) => {
    const fsModule = await import('fs')
    try {
      return fsModule.readFileSync(filePath)
    } catch {
      return null
    }
  })
}
