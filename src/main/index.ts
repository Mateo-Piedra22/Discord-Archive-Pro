// ============================================================
// Proceso principal de Electron — ciclo de vida, ventana, protocolo
// seguro de archivos, IPC, tray y atajos.
// ============================================================

import {
  app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu,
  nativeImage, shell, protocol, net, screen, session, Notification
} from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { initDatabase, closeDatabase, resetStuckDownloads } from '../core/storage/database'
import {
  initStore, getStore, getToken, setToken, clearToken,
  getWindowBounds, setWindowBounds, getWindowMode, setWindowMode,
  getWindowMaximized, setWindowMaximized,
  setOutputDirectory, getAllPreferences
} from '../core/storage/encrypted-store'
import { DiscordClient } from '../core/discord/api-client'
import { DownloadManager } from '../core/download/download-manager'
import { CacheManager } from '../core/storage/cache-manager'
import { TokenDetector } from '../core/discord/token-detector'
import * as db from '../core/storage/database'
import { isInside, isInsideReal } from './path-guard'
import type {
  ExportOptions, ContentSelection, PersistedQueueItem
} from '../core/discord/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let discordClient: DiscordClient | null = null
let downloadManager: DownloadManager | null = null
let isQuitting = false

const forumFetchCancellation = new Map<string, { cancelled?: boolean }>()

// Los eventos que se emiten durante el arranque (antes de que el renderer
// exista) se pierden. Se encolan hasta `did-finish-load`.
let rendererReady = false
const pendingRendererMessages: { channel: string; args: unknown[] }[] = []

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!rendererReady) {
    pendingRendererMessages.push({ channel, args })
    return
  }
  mainWindow.webContents.send(channel, ...args)
}

function flushRendererMessages(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  while (pendingRendererMessages.length > 0) {
    const message = pendingRendererMessages.shift()
    if (message) mainWindow.webContents.send(message.channel, ...message.args)
  }
}

// ==================== Rutas ====================

/** Ruta a un recurso empaquetado (extraResources → process.resourcesPath). */
function resourcePath(...parts: string[]): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources')
  return path.join(base, ...parts)
}

/** Ruta a un asset dentro del asar (files → app.asar/resources). */
function assetPath(...parts: string[]): string {
  return path.join(app.getAppPath(), 'resources', ...parts)
}

// ==================== Protocolo archive:// ====================
// Permite al renderer mostrar imágenes/PDF/HTML del directorio de salida
// SIN desactivar webSecurity y sin exponer file:// arbitrario.

const ARCHIVE_SCHEME = 'archive'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ARCHIVE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

/** true si `target` está estrictamente dentro de `dir`. */

function outputDir(): string {
  return getAllPreferences().outputDirectory || ''
}

function registerArchiveProtocol(): void {
  protocol.handle(ARCHIVE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // archive://local/<ruta absoluta codificada>
      const encoded = url.pathname.replace(/^\/+/, '')
      const filePath = decodeURIComponent(encoded)
      const root = outputDir()

      if (!isInsideReal(root, filePath)) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 })
      }

      const response = await net.fetch(pathToFileURL(filePath).toString())
      // CSP estricta para HTML archivado: sin scripts, sin red externa.
      const headers = new Headers(response.headers)
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' archive:"
      )
      return new Response(response.body, { status: response.status, headers })
    } catch (error) {
      console.error('[archive] protocol error:', error)
      return new Response('Bad request', { status: 400 })
    }
  })
}

// ==================== CSP (solo en producción) ====================
// En dev, Vite necesita inline scripts y websockets para HMR.
// En producción, la ventana no necesita ejecutar nada inline.

function applyContentSecurityPolicy(): void {
  if (!app.isPackaged) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net archive:",
            "font-src 'self' data:",
            // Los GIF de Discord llegan como vídeo MP4 desde el CDN: sin estos
            // orígenes el reproductor quedaría bloqueado.
            "media-src 'self' archive: https://cdn.discordapp.com https://media.discordapp.net",
            "connect-src 'self' https://discord.com",
            "frame-src archive:",
            "object-src 'none'",
            "base-uri 'none'"
          ].join('; ')
        ]
      }
    })
  })
}

// ==================== Instancia única ====================

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

// ==================== Ciclo de vida ====================

app.whenReady().then(async () => {
  if (!gotTheSingleInstanceLock) return

  initStore()
  initDatabase()
  resetStuckDownloads()
  registerArchiveProtocol()
  applyContentSecurityPolicy()
  applySessionHardening()

  // Identificador para que las notificaciones de Windows se agrupen bien.
  if (process.platform === 'win32') app.setAppUserModelId('com.estrato.app')

  createMainWindow()
  createTray()
  registerShortcuts()
  setupIpcHandlers()

  // Restaurar la cola persistente para que la UI la muestre al arrancar.
  const token = getToken()
  if (token) {
    try {
      discordClient = new DiscordClient(token)
      await discordClient.validateToken()
      ensureManager()
      sendToRenderer('auth:auto-connected', true)
    } catch (error) {
      // Solo un 401 invalida el token. Un 429 o un fallo de red son
      // transitorios: borrar la sesión por ellos obliga a reautenticarse
      // sin motivo.
      const estado = (error as { status?: number }).status
      if (estado === 401) clearToken()
      discordClient = null
      sendToRenderer('auth:auto-connected', false)
    }
  }
})

app.on('before-quit', () => {
  isQuitting = true
  downloadManager?.destroy()
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

// ==================== Ventana ====================

function sanitizeBounds(
  bounds: { x: number; y: number; width: number; height: number } | null
): { x: number; y: number; width: number; height: number } | null {
  if (!bounds) return null

  const display = screen.getDisplayMatching({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  })
  const area = display.workArea

  // Nunca más grande que el área de trabajo disponible.
  const width = Math.max(360, Math.min(Math.round(bounds.width), area.width))
  const height = Math.max(480, Math.min(Math.round(bounds.height), area.height))

  // Si la ventana no cabe entera (x/y negativos o se sale por la derecha),
  // se centra: es preferible a aparecer cortada o invisible.
  const entra =
    bounds.x >= area.x &&
    bounds.y >= area.y &&
    bounds.x + width <= area.x + area.width &&
    bounds.y + height <= area.y + area.height

  if (!entra) {
    return {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height
    }
  }

  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }
}

function createMainWindow(): void {
  const savedBounds = sanitizeBounds(getWindowBounds())
  const savedMode = getWindowMode()
  const width = savedMode === 'compact' ? 360 : 1180

  mainWindow = new BrowserWindow({
    title: 'Estrato',
    icon: assetPath('icon.png'),
    width: savedBounds?.width || width,
    height: savedBounds?.height || 760,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 360,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: false,
    alwaysOnTop: getAllPreferences().alwaysOnTop,
    skipTaskbar: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    show: false,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // El preload solo usa contextBridge + ipcRenderer: puede ir aislado.
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  // Se muestra sin forzar maximizado: si el usuario lo dejó maximizado, se
  // restaura ese estado; si no, se respeta el tamaño guardado.
  mainWindow.once('ready-to-show', () => {
    if (getWindowMaximized()) mainWindow?.maximize()
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true
    flushRendererMessages()
  })

  mainWindow.on('maximize', () => {
    setWindowMaximized(true)
    sendToRenderer('window:state', { maximized: true })
  })

  mainWindow.on('unmaximize', () => {
    setWindowMaximized(false)
    sendToRenderer('window:state', { maximized: false })
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && getStore().get('minimizeToTray')) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Guardado con debounce: arrastrar la ventana no debe escribir el JSON
  // cientos de veces por segundo.
  let boundsTimer: NodeJS.Timeout | null = null
  const persistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized() || mainWindow.isMinimized()) return
      setWindowBounds(mainWindow.getBounds())
    }, 400)
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ==================== Endurecimiento de webContents ====================

/**
 * Bloquea navegación externa, ventanas emergentes y permisos del sistema.
 * El renderer es una SPA local: no necesita ninguna de esas capacidades.
 */
function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    const current = contents.getURL()
    // Solo se permite la recarga de la propia app (dev server incluido).
    if (url !== current && !url.startsWith('devtools://')) {
      event.preventDefault()
    }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function applySessionHardening(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents)
  })
}

// ==================== Tray ====================

function createTray(): void {
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(assetPath('icon.png'))
  } catch {
    icon = nativeImage.createEmpty()
  }
  if (icon.isEmpty()) {
    // Alternativa 16x16 transparente: Tray lanza si recibe un buffer vacío.
    icon = nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4), { width: 16, height: 16 })
  }

  tray = new Tray(icon)

  const toggleWindow = () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mostrar/Ocultar', click: toggleWindow },
    { type: 'separator' },
    {
      label: 'Siempre Arriba',
      type: 'checkbox',
      checked: getAllPreferences().alwaysOnTop,
      click: (item) => {
        mainWindow?.setAlwaysOnTop(item.checked)
        getStore().set('alwaysOnTop', item.checked)
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

  tray.setToolTip('Estrato')
  tray.setContextMenu(contextMenu)
  tray.on('click', toggleWindow)
}

// ==================== Atajos ====================

function toggleWindowVisibility(): void {
  if (mainWindow?.isVisible()) mainWindow.hide()
  else {
    mainWindow?.show()
    mainWindow?.focus()
  }
}

function toggleCompactMode(): void {
  if (!mainWindow) return
  const [width, height] = mainWindow.getSize()
  const compact = width > 500
  mainWindow.setSize(compact ? 420 : 1180, height)
  setWindowMode(compact ? 'compact' : 'expanded')
  mainWindow.webContents.send('window-mode-changed', compact ? 'compact' : 'expanded')
}

function registerShortcuts(): void {
  globalShortcut.register('Ctrl+Shift+F', toggleWindowVisibility)
  globalShortcut.register('Ctrl+Shift+M', toggleCompactMode)
}

// ==================== Gestor de descargas ====================

function prefsToExportOptions(prefs: ReturnType<typeof getAllPreferences>): ExportOptions {
  return {
    formats: (prefs.exportFormats as ExportOptions['formats']) || ['markdown'],
    outputDir: prefs.outputDirectory || '',
    folderStructure: prefs.folderStructure as ExportOptions['folderStructure'],
    namingPattern: prefs.namingPattern,
    includeToc: prefs.includeToc,
    threadMode: prefs.threadMode as ExportOptions['threadMode'],
    maxFilenameLength: prefs.maxFilenameLength,
    includeAvatars: prefs.includeAvatars,
    includeStickers: prefs.includeStickers,
    includeCustomEmojis: prefs.includeCustomEmojis,
    maxFileSize: prefs.maxFileSize,
    preserveFilenames: prefs.preserveFilenames,
    dateFormat: prefs.dateFormat,
    syncMode: prefs.syncMode === 'force' ? 'force' : 'quick'
  }
}

function wireManagerEvents(manager: DownloadManager): void {
  const send = (channel: string, ...args: unknown[]) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  }
  manager.on('task-started', (task) => send('download:task-started', task))
  manager.on('task-progress', (taskId, progress) => send('download:task-progress', taskId, progress))
  manager.on('task-completed', (task) => send('download:task-completed', task))
  manager.on('task-error', (taskId, error) => send('download:task-error', taskId, error))
  manager.on('queue-updated', (queue) => send('download:queue-updated', queue))
  manager.on('all-completed', () => {
    send('download:all-completed')
    if (getAllPreferences().autoOpenFolder) {
      const dir = outputDir()
      if (dir && fs.existsSync(dir)) void shell.openPath(dir)
    }
    if (Notification.isSupported()) {
      new Notification({
        title: 'Archivado completado',
        body: 'Todos los elementos de la cola han terminado.'
      }).show()
    }
  })
}

/** Crea el manager bajo demanda y restaura la cola persistente una sola vez. */
function ensureManager(): DownloadManager | null {
  if (!discordClient) return null
  if (downloadManager) {
    downloadManager.setClient(discordClient)
    return downloadManager
  }

  const prefs = getAllPreferences()
  downloadManager = new DownloadManager(discordClient, {
    concurrency: prefs.maxConcurrent,
    exportOptions: prefsToExportOptions(prefs),
    contentSelection: prefs.contentSelection
  })
  wireManagerEvents(downloadManager)

  const restored = db.getQueueItems(['queued', 'downloading', 'paused']) as unknown as PersistedQueueItem[]
  if (restored.length > 0) downloadManager.restoreQueue(restored)

  return downloadManager
}

// ==================== IPC ====================

function setupIpcHandlers(): void {
  const requireClient = (): DiscordClient => {
    if (!discordClient) throw new Error('No autenticado')
    return discordClient
  }

  // --- Autenticación ---
  ipcMain.handle('auth:set-token', async (_event, token: string) => {
    try {
      const client = new DiscordClient(token)
      const user = await client.validateToken()
      setToken(token)
      discordClient = client
      ensureManager()
      return { success: true, user }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('auth:validate', async () => {
    const token = getToken()
    if (!token) return { success: false, error: 'No hay token guardado' }
    try {
      if (!discordClient) discordClient = new DiscordClient(token)
      const user = await discordClient.validateToken()
      ensureManager()
      return { success: true, user }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('auth:clear', async () => {
    clearToken()
    downloadManager?.destroy()
    downloadManager = null
    discordClient?.destroy()
    discordClient = null
  })

  // --- Discord ---
  ipcMain.handle('discord:get-guilds', async () => requireClient().getGuilds())
  ipcMain.handle('discord:get-guild', async (_event, guildId: string) => requireClient().getGuild(guildId))
  ipcMain.handle('discord:get-channels', async (_event, guildId: string) => requireClient().getChannels(guildId))
  ipcMain.handle('discord:get-channel-info', async (_event, channelId: string) => requireClient().getChannel(channelId))

  ipcMain.handle('discord:get-forum-posts', async (_event, channelId: string, offset?: number) => {
    return requireClient().searchForumThreads(channelId, {
      sort_by: 'creation_time',
      sort_order: 'desc',
      offset: offset || 0,
      limit: 25
    })
  })

  ipcMain.handle('discord:get-all-forum-posts', async (_event, channelId: string) => {
    const client = requireClient()
    const token = { cancelled: false }
    forumFetchCancellation.set(channelId, token)
    try {
      return await client.getAllForumPosts(channelId, (count, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('forum-posts-progress', { count, total })
        }
      }, token)
    } catch (err) {
      if ((err as Error).message === 'fetch_cancelled') throw new Error('cancelled')
      throw err
    } finally {
      forumFetchCancellation.delete(channelId)
    }
  })

  ipcMain.handle('discord:cancel-get-all-forum-posts', async (_event, channelId: string) => {
    const token = forumFetchCancellation.get(channelId)
    if (!token) return { success: false, error: 'no_active_fetch' }
    token.cancelled = true
    return { success: true }
  })

  ipcMain.handle('discord:get-thread-messages', async (_event, threadId: string) => {
    return requireClient().getAllThreadMessages(threadId)
  })

  ipcMain.handle('discord:get-message-page', async (_event, threadId: string, before?: string, limit?: number) => {
    return requireClient().getMessagePage(threadId, before, limit ?? 50)
  })

  ipcMain.handle('discord:get-guild-icon', async (_event, guildId: string, hash: string | null) => {
    return requireClient().getGuildIconUrl(guildId, hash)
  })

  // --- Caché ---
  ipcMain.handle('cache:check-post', async (_event, threadId: string) => db.getCachedPost(threadId))
  ipcMain.handle('cache:check-status', async (_event, threadId: string) => CacheManager.getPostStatus(threadId))
  ipcMain.handle('cache:get-cached-posts', async (_event, channelId: string) => db.getCachedPostsByChannel(channelId))

  ipcMain.handle('cache:clear', async () => {
    try {
      if (downloadManager && downloadManager.getActiveCount() > 0) {
        return { success: false, error: 'Hay descargas en curso. Detenlas antes de purgar la caché.' }
      }
      db.clearAllCache()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // --- Descargas ---
  ipcMain.handle('download:start', async (
    _event,
    threads: { thread: unknown; tags: unknown[] }[],
    guildName: string,
    channelName: string,
    exportOptions: ExportOptions,
    contentSelection: ContentSelection
  ) => {
    requireClient()
    const manager = ensureManager()
    if (!manager) throw new Error('No autenticado')
    manager.updateOptions(exportOptions, contentSelection)
    return manager.addToQueue(threads as never, guildName, channelName)
  })

  ipcMain.handle('download:get-queue', async () => ensureManager()?.getQueue() || [])
  ipcMain.handle('download:get-history', async (_event, limit = 50, offset = 0) => db.getDownloadHistory(limit, offset))

  ipcMain.handle('download:pause-all', async () => {
    ensureManager()?.pauseAll()
    return { success: true }
  })
  ipcMain.handle('download:resume-all', async () => {
    ensureManager()?.resumeAll()
    return { success: true }
  })
  ipcMain.handle('download:cancel', async (_event, taskId: string) => {
    ensureManager()?.cancelTask(taskId)
    return { success: true }
  })
  ipcMain.handle('download:cancel-all', async () => {
    ensureManager()?.cancelAll()
    return { success: true }
  })
  ipcMain.handle('download:clear-completed', async () => {
    ensureManager()?.clearCompleted()
    return { success: true }
  })
  ipcMain.handle('download:retry', async (_event, taskId: string) => {
    await ensureManager()?.retryTask(taskId)
    return { success: true }
  })
  ipcMain.handle('download:set-concurrency', async (_event, concurrency: number) => {
    ensureManager()?.setConcurrency(concurrency)
    return { success: true }
  })

  // --- Ajustes ---
  ipcMain.handle('settings:pick-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleccionar carpeta de descarga'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:get-rate-limiter-stats', async () => discordClient?.limiter.getStats() || null)
  ipcMain.handle('settings:get-db-stats', async () => db.getDbStats())
  ipcMain.handle('settings:save-output-dir', async (_event, dir: string) => setOutputDirectory(dir))

  // Lista blanca explícita: el renderer no puede escribir claves arbitrarias.
  const PREFERENCE_KEYS = new Set([
    'alwaysOnTop', 'outputDirectory', 'exportFormats', 'folderStructure',
    'namingPattern', 'imageQuality', 'includeToc', 'threadMode',
    'maxFilenameLength', 'includeAvatars', 'includeStickers',
    'includeCustomEmojis', 'syncMode', 'maxConcurrent', 'maxFileSize',
    'autoOpenFolder', 'preserveFilenames', 'contentSelection',
    'minimizeToTray', 'strictChannelFiltering', 'dateFormat', 'lastGuildId', 'lastChannelId'
  ])

  ipcMain.handle('settings:save-all', async (_event, preferences: Record<string, unknown>) => {
    const store = getStore()
    for (const [key, value] of Object.entries(preferences || {})) {
      if (PREFERENCE_KEYS.has(key)) {
        store.set(key as never, value as never)
      }
    }
    if (downloadManager && typeof preferences?.maxConcurrent === 'number') {
      downloadManager.setConcurrency(preferences.maxConcurrent)
    }
    return { success: true }
  })

  ipcMain.handle('settings:get-all', async () => getAllPreferences())

  // --- Token auto-detección ---
  ipcMain.handle('token:detect', async () => {
    try {
      const result = await TokenDetector.detectAndValidate()
      return {
        success: true,
        tokens: result.valid.map((v) => ({
          source: v.source,
          token: v.token,
          valid: true,
          user: v.user
        })),
        diagnostics: result.diagnostics
      }
    } catch (error) {
      return { success: false, tokens: [], diagnostics: [], error: (error as Error).message }
    }
  })

  // --- Carpetas ---
  ipcMain.handle('folder:open', async (_event, folderPath: string) => {
    try {
      const root = outputDir()
      const permitido =
        path.resolve(folderPath) === path.resolve(root) || isInsideReal(root, folderPath)
      if (!permitido) return false
      const error = await shell.openPath(folderPath)
      return error === ''
    } catch {
      return false
    }
  })

  ipcMain.handle('folder:reveal', async (_event, folderPath: string) => {
    const root = outputDir()
    const permitido =
      path.resolve(folderPath) === path.resolve(root) || isInsideReal(root, folderPath)
    if (!permitido) return
    shell.showItemInFolder(folderPath)
  })

  // --- Archivo (solo dentro del directorio de salida) ---
  ipcMain.handle('archive:scan-directory', async (_event, dirPath: string) => {
    const root = outputDir()
    const esLaRaiz = path.resolve(dirPath) === path.resolve(root)
    if (!esLaRaiz && !isInsideReal(root, dirPath)) {
      throw new Error('Ruta fuera del directorio de salida')
    }
    return scanDirectory(dirPath)
  })

  ipcMain.handle('archive:read-file', async (_event, filePath: string) => {
    const root = outputDir()
    if (!isInsideReal(root, filePath)) {
      return { content: 'Ruta fuera del directorio de salida', truncated: false, size: 0 }
    }
    try {
      const stat = fs.statSync(filePath)
      const MAX = 4 * 1024 * 1024
      const fd = fs.openSync(filePath, 'r')
      try {
        const bytes = Math.min(stat.size, MAX)
        const buffer = Buffer.alloc(bytes)
        fs.readSync(fd, buffer, 0, bytes, 0)
        return {
          content: buffer.toString('utf-8'),
          truncated: stat.size > MAX,
          size: stat.size
        }
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return { content: 'Error: no se pudo leer el archivo', truncated: false, size: 0 }
    }
  })

  ipcMain.handle('archive:search', async (_event, query: string, limit = 120) => {
    const root = outputDir()
    if (!root || !query || query.trim().length < 2) {
      return { hits: [], scanned: 0, truncated: false }
    }
    return searchArchive(root, query.trim(), limit)
  })

  // --- Métricas del archivo ---
  ipcMain.handle('app:get-stats', async () => db.getArchiveStats(outputDir()))

  // --- Enlaces externos (solo Discord) ---
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    try {
      const destino = new URL(url)
      const hostsPermitidos = new Set([
        'discord.com',
        'discordapp.com',
        'ptb.discord.com',
        'canary.discord.com',
        // Vídeos incrustados en mensajes: se abren fuera porque su política
        // de incrustación rechaza el origen de una app de escritorio.
        'www.youtube.com',
        'youtube.com',
        'youtu.be',
        'vimeo.com',
        'player.vimeo.com'
      ])
      const permitido =
        destino.protocol === 'discord:' ||
        (destino.protocol === 'https:' && hostsPermitidos.has(destino.hostname))
      if (!permitido) return false
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })

  // --- Ventana ---
  ipcMain.on('window:minimize', () => {
    if (getStore().get('minimizeToTray')) mainWindow?.hide()
    else mainWindow?.minimize()
  })

  ipcMain.on('window:toggle-compact', toggleCompactMode)

  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })

  ipcMain.on('window:close', () => {
    if (getStore().get('minimizeToTray')) {
      mainWindow?.hide()
    } else {
      isQuitting = true
      app.quit()
    }
  })

  ipcMain.on('window:set-always-on-top', (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(value)
    getStore().set('alwaysOnTop', value)
  })

  ipcMain.on('window:set-zoom', (_event, factor: number) => {
    const safe = Math.min(2, Math.max(0.8, Number(factor) || 1))
    mainWindow?.webContents.setZoomFactor(safe)
  })

  ipcMain.handle('window:get-state', async () => ({
    maximized: mainWindow?.isMaximized() ?? false,
    minimized: mainWindow?.isMinimized() ?? false,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false
  }))

  // Devuelve la ventana a un estado usable (centrada, tamaño por defecto).
  ipcMain.handle('window:reset-state', async () => {
    if (!mainWindow) return { success: false }
    mainWindow.unmaximize()
    setWindowMaximized(false)
    const display = screen.getPrimaryDisplay().workArea
    const width = Math.min(1180, display.width - 80)
    const height = Math.min(760, display.height - 80)
    mainWindow.setSize(width, height)
    mainWindow.center()
    mainWindow.show()
    mainWindow.focus()
    setWindowBounds({ x: 0, y: 0, width, height })
    return { success: true }
  })
}

// ==================== Escaneo de directorios (async) ====================

interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size?: number
  children?: FileEntry[]
}

async function scanDirectory(dirPath: string): Promise<FileEntry[]> {
  let budget = 20000 // techo de entradas para no colgar el proceso

  async function walk(dir: string, depth: number): Promise<FileEntry[]> {
    if (depth > 12 || budget <= 0) return []
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    const out: FileEntry[] = []
    for (const entry of entries) {
      if (budget-- <= 0) break
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: full, type: 'dir', children: await walk(full, depth + 1) })
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = (await fs.promises.stat(full)).size
        } catch { /* ignorar */ }
        out.push({ name: entry.name, path: full, type: 'file', size })
      }
    }
    return out
  }

  return walk(dirPath, 0)
}

// ==================== Búsqueda en el archivo local ====================

const EXTENSIONES_BUSCABLES = new Set(['.md', '.txt', '.html', '.json', '.csv'])

interface SearchHit {
  path: string
  name: string
  relative: string
  line: number
  excerpt: string
}

/**
 * Busca texto en los archivos del archivo local, sin salir de la app.
 * Se ignoran `assets/`, los directorios ocultos y los archivos grandes.
 */
async function searchArchive(
  root: string,
  query: string,
  limit: number
): Promise<{ hits: SearchHit[]; scanned: number; truncated: boolean }> {
  const aguja = query.toLowerCase()
  const hits: SearchHit[] = []
  const pendientes: string[] = [root]
  let scanned = 0
  let truncated = false

  const MAX_ARCHIVOS = 4000
  const MAX_BYTES = 2 * 1024 * 1024

  while (pendientes.length > 0 && hits.length < limit) {
    const dir = pendientes.shift()
    if (!dir) break

    let entradas: fs.Dirent[]
    try {
      entradas = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entrada of entradas) {
      if (entrada.name.startsWith('.') || entrada.name === 'assets') continue
      // No se siguen enlaces simbólicos: podrían apuntar fuera del archivo.
      if (entrada.isSymbolicLink()) continue
      const ruta = path.join(dir, entrada.name)

      if (entrada.isDirectory()) {
        pendientes.push(ruta)
        continue
      }
      if (!EXTENSIONES_BUSCABLES.has(path.extname(entrada.name).toLowerCase())) continue

      scanned++
      if (scanned > MAX_ARCHIVOS) {
        truncated = true
        break
      }

      let contenido: string
      try {
        const stat = await fs.promises.stat(ruta)
        if (stat.size > MAX_BYTES) continue
        contenido = await fs.promises.readFile(ruta, 'utf-8')
      } catch {
        continue
      }

      const indice = contenido.toLowerCase().indexOf(aguja)
      if (indice === -1) continue

      const inicioLinea = contenido.lastIndexOf('\n', indice) + 1
      const finLinea = contenido.indexOf('\n', indice)
      const fin = finLinea === -1 ? contenido.length : finLinea
      const desde = Math.max(inicioLinea, indice - 60)
      const hasta = Math.min(fin, indice + 140)

      hits.push({
        path: ruta,
        name: entrada.name,
        relative: path.relative(root, ruta).split(path.sep).join('/'),
        line: contenido.slice(0, indice).split('\n').length,
        excerpt: contenido.slice(desde, hasta).replace(/\s+/g, ' ').trim()
      })

      if (hits.length >= limit) {
        truncated = true
        break
      }
    }
  }

  return { hits, scanned, truncated }
}
