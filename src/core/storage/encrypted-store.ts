// ============================================================
// Store de preferencias + token cifrado con safeStorage (DPAPI).
// Archivo JSON plano, portable, sin dependencias ESM.
// ============================================================

import { safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'
import { getDataDir } from './paths'

export interface ContentSelectionPrefs {
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

export interface StoreSchema {
  /** Versión del esquema de preferencias para migraciones puntuales. */
  prefsVersion: number
  encryptedToken: string | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  windowMaximized: boolean
  windowMode: 'expanded' | 'compact' | 'minimized'
  alwaysOnTop: boolean
  outputDirectory: string
  lastGuildId: string | null
  lastChannelId: string | null
  exportFormats: string[]
  folderStructure: 'by-server' | 'flat' | 'by-date'
  namingPattern: string
  includeToc: boolean
  threadMode: 'single' | 'separate' | 'both'
  maxFilenameLength: number
  includeAvatars: boolean
  includeStickers: boolean
  includeCustomEmojis: boolean
  syncMode: 'quick' | 'force'
  maxConcurrent: number
  /** Bytes. 0 = sin límite. */
  maxFileSize: number
  autoOpenFolder: boolean
  preserveFilenames: boolean
  dateFormat: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'YYYYMMDD'
  contentSelection: ContentSelectionPrefs
  minimizeToTray: boolean
  strictChannelFiltering: boolean
}

class JsonStore {
  private data: StoreSchema
  private filePath: string

  constructor(filePath: string, defaults: StoreSchema) {
    this.filePath = filePath
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (fs.existsSync(filePath)) {
      try {
        this.data = { ...defaults, ...JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
      } catch {
        this.data = { ...defaults }
      }
    } else {
      this.data = { ...defaults }
    }
    this.save()
  }

  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this.data[key]
  }

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this.data[key] = value
    this.save()
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Store] Failed to save:', err)
    }
  }
}

let store: JsonStore | null = null

const DEFAULTS: StoreSchema = {
  prefsVersion: 3,
  encryptedToken: null,
  windowBounds: null,
  windowMaximized: false,
  windowMode: 'expanded',
  alwaysOnTop: false,
  outputDirectory: '',
  lastGuildId: null,
  lastChannelId: null,
  exportFormats: ['markdown'],
  folderStructure: 'by-server',
  namingPattern: '{num}_{date}_{title}',
  includeToc: true,
  threadMode: 'both',
  maxFilenameLength: 80,
  includeAvatars: false,
  includeStickers: true,
  includeCustomEmojis: true,
  syncMode: 'quick',
  maxConcurrent: 2,
  maxFileSize: 0,
  autoOpenFolder: true,
  preserveFilenames: true,
  dateFormat: 'YYYY-MM-DD',
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
  minimizeToTray: false,
  strictChannelFiltering: false
}

export function initStore(): JsonStore {
  if (store) return store
  store = new JsonStore(path.join(getDataDir(), 'preferences.json'), DEFAULTS)

  // Migración v1/v2 → v3:
  //  - `alwaysOnTop` venía activado por defecto y la ventana flotaba sobre todo.
  //  - Los límites guardados podían estar fuera de pantalla (x negativo) y la
  //    ventana aparecía cortada. Se descartan una vez.
  const version = (store.get('prefsVersion') as number) || 1
  if (version < 3) {
    store.set('alwaysOnTop', false)
    store.set('windowMaximized', false)
    store.set('windowBounds', null)
    store.set('prefsVersion', 3)
  }

  return store
}

export function getStore(): JsonStore {
  if (!store) throw new Error('Store not initialized. Call initStore() first.')
  return store
}

// ----------- Token -----------
// Formato: "dpapi:<base64>" cuando safeStorage está disponible,
// "plain:<base64>" como último recurso. El prefijo evita el bug de
// intentar descifrar con DPAPI un valor guardado en claro (y perder
// el token silenciosamente en el siguiente arranque).

export function setToken(token: string): void {
  const s = getStore()
  if (safeStorage.isEncryptionAvailable()) {
    s.set('encryptedToken', `dpapi:${safeStorage.encryptString(token).toString('base64')}`)
  } else {
    s.set('encryptedToken', `plain:${Buffer.from(token, 'utf-8').toString('base64')}`)
  }
}

export function getToken(): string | null {
  const stored = getStore().get('encryptedToken')
  if (!stored) return null

  try {
    if (stored.startsWith('dpapi:')) {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(Buffer.from(stored.slice(6), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf-8')
    }
    // Compatibilidad con el formato antiguo (sin prefijo).
    const buffer = Buffer.from(stored, 'base64')
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buffer)
      } catch {
        return buffer.toString('utf-8')
      }
    }
    return buffer.toString('utf-8')
  } catch {
    return null
  }
}

export function clearToken(): void {
  getStore().set('encryptedToken', null)
}

// ----------- Ventana -----------

export function getWindowBounds() {
  return getStore().get('windowBounds')
}

export function setWindowBounds(bounds: { x: number; y: number; width: number; height: number }) {
  getStore().set('windowBounds', bounds)
}

export function getWindowMode() {
  return getStore().get('windowMode')
}

export function setWindowMode(mode: 'expanded' | 'compact' | 'minimized') {
  getStore().set('windowMode', mode)
}

export function getWindowMaximized(): boolean {
  return getStore().get('windowMaximized')
}

export function setWindowMaximized(value: boolean): void {
  getStore().set('windowMaximized', value)
}

// ----------- Salida -----------

export function getOutputDirectory(): string {
  return getStore().get('outputDirectory') || ''
}

export function setOutputDirectory(dir: string): void {
  getStore().set('outputDirectory', dir)
}

// ----------- Preferencias completas -----------

export function getAllPreferences(): Omit<StoreSchema, 'encryptedToken'> {
  const s = getStore()
  return {
    prefsVersion: s.get('prefsVersion'),
    windowBounds: s.get('windowBounds'),
    windowMaximized: s.get('windowMaximized'),
    windowMode: s.get('windowMode'),
    alwaysOnTop: s.get('alwaysOnTop'),
    outputDirectory: s.get('outputDirectory'),
    lastGuildId: s.get('lastGuildId'),
    lastChannelId: s.get('lastChannelId'),
    exportFormats: s.get('exportFormats'),
    folderStructure: s.get('folderStructure'),
    namingPattern: s.get('namingPattern'),
    includeToc: s.get('includeToc'),
    threadMode: s.get('threadMode'),
    maxFilenameLength: s.get('maxFilenameLength'),
    includeAvatars: s.get('includeAvatars'),
    includeStickers: s.get('includeStickers'),
    includeCustomEmojis: s.get('includeCustomEmojis'),
    syncMode: s.get('syncMode'),
    maxConcurrent: s.get('maxConcurrent'),
    maxFileSize: s.get('maxFileSize'),
    autoOpenFolder: s.get('autoOpenFolder'),
    preserveFilenames: s.get('preserveFilenames'),
    dateFormat: s.get('dateFormat'),
    contentSelection: s.get('contentSelection'),
    minimizeToTray: s.get('minimizeToTray'),
    strictChannelFiltering: s.get('strictChannelFiltering')
  }
}
