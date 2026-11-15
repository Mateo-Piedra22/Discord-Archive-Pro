import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, mockSafeStorage, mockGetDataDir } = vi.hoisted(() => {
  const testState = {
    dataDir: '',
    encryptionAvailable: true
  }

  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => testState.encryptionAvailable),
    encryptString: vi.fn((text: string) => Buffer.from(`dpapi-enc:${text}`, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => {
      const decoded = buf.toString('utf-8')
      if (!decoded.startsWith('dpapi-enc:')) {
        throw new Error('Failed to decrypt')
      }
      return decoded.slice('dpapi-enc:'.length)
    })
  }

  const getDataDir = vi.fn(() => testState.dataDir)

  return { state: testState, mockSafeStorage: safeStorage, mockGetDataDir: getDataDir }
})

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage
}))

vi.mock('./paths', () => ({
  getDataDir: mockGetDataDir
}))

async function loadStoreModule() {
  vi.resetModules()
  return await import('./encrypted-store')
}

beforeEach(() => {
  state.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrato-store-'))
  state.encryptionAvailable = true
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  if (state.dataDir && fs.existsSync(state.dataDir)) {
    fs.rmSync(state.dataDir, { recursive: true, force: true })
  }
})

describe('encrypted-store', () => {
  it('crea preferences.json con DEFAULTS al inicializar el store', async () => {
    const { initStore, DEFAULTS, getAllPreferences } = await loadStoreModule()

    const store = initStore()
    const filePath = path.join(state.dataDir, 'preferences.json')

    expect(fs.existsSync(filePath)).toBe(true)
    expect(store.get('prefsVersion')).toBe(DEFAULTS.prefsVersion)

    const { encryptedToken: _omitted, ...expectedPrefs } = DEFAULTS
    expect(getAllPreferences()).toEqual(expectedPrefs)

    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(onDisk).toEqual(DEFAULTS)
  })

  it('se recupera con DEFAULTS si el archivo JSON existente está corrupto', async () => {
    const filePath = path.join(state.dataDir, 'preferences.json')
    fs.writeFileSync(filePath, '{corrupted-json:::', 'utf-8')

    const { JsonStore, DEFAULTS } = await loadStoreModule()
    const store = new JsonStore(filePath, DEFAULTS)

    expect(store.get('prefsVersion')).toBe(DEFAULTS.prefsVersion)
    expect(store.get('threadMode')).toBe(DEFAULTS.threadMode)

    const repaired = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(repaired).toEqual(DEFAULTS)
  })

  it('persiste de forma atómica sin dejar archivos .tmp residuales incluso si renameSync falla', async () => {
    const { JsonStore, DEFAULTS } = await loadStoreModule()
    const filePath = path.join(state.dataDir, 'preferences.json')
    const tmpPath = `${filePath}.tmp`

    const renameSpy = vi.spyOn(fs, 'renameSync')
    const store = new JsonStore(filePath, DEFAULTS)
    store.set('maxConcurrent', 4)

    expect(renameSpy).toHaveBeenCalledWith(tmpPath, filePath)
    expect(fs.existsSync(tmpPath)).toBe(false)
    expect(fs.readdirSync(state.dataDir)).toEqual(['preferences.json'])
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).maxConcurrent).toBe(4)

    // Simular fallo de renameSync (p. ej. bloqueo en Windows) → fallback y limpieza de .tmp
    renameSpy.mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted')
    })
    store.set('outputDirectory', 'C:\\Exports\\Discord')

    expect(fs.existsSync(tmpPath)).toBe(false)
    expect(fs.readdirSync(state.dataDir)).toEqual(['preferences.json'])
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).outputDirectory).toBe(
      'C:\\Exports\\Discord'
    )
  })

  it('setMany y setManyPreferences fusionan múltiples preferencias y guardan una sola vez', async () => {
    const { initStore, setManyPreferences, JsonStore, DEFAULTS } = await loadStoreModule()

    const filePath = path.join(state.dataDir, 'direct.json')
    const store = new JsonStore(filePath, DEFAULTS)

    const renameSpy = vi.spyOn(fs, 'renameSync')
    const writeSpy = vi.spyOn(fs, 'writeFileSync')

    store.setMany({
      includeToc: false,
      threadMode: 'single',
      maxConcurrent: 5,
      alwaysOnTop: undefined
    })

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(store.get('includeToc')).toBe(false)
    expect(store.get('threadMode')).toBe('single')
    expect(store.get('maxConcurrent')).toBe(5)
    expect(store.get('alwaysOnTop')).toBe(DEFAULTS.alwaysOnTop)

    initStore()
    writeSpy.mockClear()
    renameSpy.mockClear()

    setManyPreferences({
      autoOpenFolder: false,
      dateFormat: 'DD-MM-YYYY',
      minimizeToTray: true
    })

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(renameSpy).toHaveBeenCalledTimes(1)

    const reloaded = new JsonStore(path.join(state.dataDir, 'preferences.json'), DEFAULTS)
    expect(reloaded.get('autoOpenFolder')).toBe(false)
    expect(reloaded.get('dateFormat')).toBe('DD-MM-YYYY')
    expect(reloaded.get('minimizeToTray')).toBe(true)
  })

  it('completa el ciclo setToken / getToken / clearToken en modo dpapi:', async () => {
    state.encryptionAvailable = true
    const { initStore, setToken, getToken, clearToken } = await loadStoreModule()

    const store = initStore()
    setToken('mfa.secret-token-value')

    const rawStored = store.get('encryptedToken')
    expect(rawStored).toBeTypeOf('string')
    expect(rawStored?.startsWith('dpapi:')).toBe(true)
    expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('mfa.secret-token-value')

    expect(getToken()).toBe('mfa.secret-token-value')

    clearToken()
    expect(store.get('encryptedToken')).toBeNull()
    expect(getToken()).toBeNull()
  })

  it('completa el ciclo setToken / getToken / clearToken en modo plain:', async () => {
    state.encryptionAvailable = false
    const { initStore, setToken, getToken, clearToken } = await loadStoreModule()

    const store = initStore()
    setToken('plain.token.12345')

    const rawStored = store.get('encryptedToken')
    expect(rawStored).toBe(`plain:${Buffer.from('plain.token.12345', 'utf-8').toString('base64')}`)
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled()

    expect(getToken()).toBe('plain.token.12345')

    clearToken()
    expect(store.get('encryptedToken')).toBeNull()
    expect(getToken()).toBeNull()
  })

  it('devuelve null en getToken cuando el token es dpapi: pero safeStorage no está disponible', async () => {
    state.encryptionAvailable = true
    const { initStore, setToken, getToken } = await loadStoreModule()

    initStore()
    setToken('token-protegido')
    expect(getToken()).toBe('token-protegido')

    state.encryptionAvailable = false
    expect(getToken()).toBeNull()
  })
})
