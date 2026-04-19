// ============================================================
// Encrypted Store — Token and preferences storage using
// Electron's safeStorage (Windows DPAPI). Portable.
// Uses a simple JSON file store (no ESM dependency issues).
// ============================================================

import { safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

interface StoreSchema {
  encryptedToken: string | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  windowMode: 'expanded' | 'compact' | 'minimized'
  alwaysOnTop: boolean
  outputDirectory: string
  lastGuildId: string | null
  lastChannelId: string | null
  exportFormats: string[]
  folderStructure: string
  namingPattern: string
  imageQuality: string
  includeToc: boolean
  threadMode: string
  maxFilenameLength: number
  includeAvatars: boolean
  includeStickers: boolean
  includeCustomEmojis: boolean
  syncMode: 'quick' | 'deep' | 'full' | 'force'
  maxConcurrent: number
  maxFileSize: number
  autoOpenFolder: boolean
  preserveFilenames: boolean
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
  minimizeToTray: boolean
  strictChannelFiltering: boolean
}

// Simple JSON file store — no ESM issues, portable, reliable
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

function getStorePath(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'data')
  }
  return path.join(app.getAppPath(), 'data')
}

const DEFAULTS: StoreSchema = {
  encryptedToken: null,
  windowBounds: null,
  windowMode: 'expanded',
  alwaysOnTop: true,
  outputDirectory: '',
  lastGuildId: null,
  lastChannelId: null,
  exportFormats: ['markdown'],
  folderStructure: 'by-server',
  namingPattern: '{num}_{date}_{title}',
  imageQuality: 'original',
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
  strictChannelFiltering: true
}

export function initStore(): JsonStore {
  if (store) return store
  const filePath = path.join(getStorePath(), 'preferences.json')
  store = new JsonStore(filePath, DEFAULTS)
  return store
}

export function getStore(): JsonStore {
  if (!store) throw new Error('Store not initialized. Call initStore() first.')
  return store
}

// ----------- Token Management (Encrypted) -----------

export function setToken(token: string): void {
  const s = getStore()
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token)
    s.set('encryptedToken', encrypted.toString('base64'))
  } else {
    // Fallback: store as-is (less secure but functional)
    s.set('encryptedToken', Buffer.from(token).toString('base64'))
  }
}

export function getToken(): string | null {
  const s = getStore()
  const stored = s.get('encryptedToken')
  if (!stored) return null

  try {
    const buffer = Buffer.from(stored, 'base64')
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer)
    }
    return buffer.toString('utf-8')
  } catch {
    return null
  }
}

export function clearToken(): void {
  getStore().set('encryptedToken', null)
}

// ----------- Window State -----------

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

// ----------- Preferences -----------

export function getOutputDirectory(): string {
  return getStore().get('outputDirectory') || ''
}

export function setOutputDirectory(dir: string): void {
  getStore().set('outputDirectory', dir)
}

export function getExportFormats(): string[] {
  return getStore().get('exportFormats')
}

export function setExportFormats(formats: string[]): void {
  getStore().set('exportFormats', formats)
}

export function getContentSelection() {
  return getStore().get('contentSelection')
}

export function setContentSelection(selection: StoreSchema['contentSelection']): void {
  getStore().set('contentSelection', selection)
}

export function getSyncMode(): string {
  return getStore().get('syncMode')
}

export function setSyncMode(mode: 'quick' | 'deep' | 'full' | 'force'): void {
  getStore().set('syncMode', mode)
}

export function getAllPreferences(): StoreSchema {
  const s = getStore()
  return {
    encryptedToken: null, // Never expose
    windowBounds: s.get('windowBounds'),
    windowMode: s.get('windowMode'),
    alwaysOnTop: s.get('alwaysOnTop'),
    outputDirectory: s.get('outputDirectory'),
    lastGuildId: s.get('lastGuildId'),
    lastChannelId: s.get('lastChannelId'),
    exportFormats: s.get('exportFormats'),
    folderStructure: s.get('folderStructure'),
    namingPattern: s.get('namingPattern'),
    imageQuality: s.get('imageQuality'),
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
    contentSelection: s.get('contentSelection'),
    minimizeToTray: s.get('minimizeToTray'),
    strictChannelFiltering: s.get('strictChannelFiltering')
  }
}
