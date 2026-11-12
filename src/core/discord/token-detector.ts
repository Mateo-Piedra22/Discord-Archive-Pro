// ============================================================
// Detector de tokens — localiza y descifra la sesión de Discord
// en el almacén LevelDB del cliente de escritorio y de los
// navegadores, y valida el token contra la API oficial.
//
// Cadena completa:
//   1. Local State → os_crypt.encrypted_key (DPAPI, prefijo "DPAPI")
//   2. Descifrado de esa clave con DPAPI vía PowerShell (asíncrono)
//   3. LevelDB → valores "dQw4w9WgXcQ:" + base64
//   4. AES-256-GCM: "v10" | "v11" + nonce(12) + cifrado + tag(16)
//   5. Validación contra /users/@me
// ============================================================

import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { extractEncryptedPayloads, decryptTokenValue } from './token-crypto'

const execFileAsync = promisify(execFile)

export interface TokenCandidate {
  source: string
  token: string
  path: string
}

export interface DetectionDiagnostic {
  /** Nombre visible: "Discord", "Chrome (Default)", … */
  source: string
  /** 'discord' | 'browser' */
  kind: 'discord' | 'browser'
  /** ¿Se encontró el almacén? */
  found: boolean
  /** ¿Se pudo descifrar algo? */
  decrypted: boolean
  /** Mensaje en español listo para mostrar al usuario. */
  detail: string
}

export interface DetectResult {
  candidates: TokenCandidate[]
  valid: { source: string; token: string; user: unknown }[]
  diagnostics: DetectionDiagnostic[]
}

/** Marcador y criptografía viven en token-crypto.ts (con tests propios). */

const DISCORD_APPS: { name: string; folder: string }[] = [
  { name: 'Discord', folder: 'discord' },
  { name: 'Discord PTB', folder: 'discordptb' },
  { name: 'Discord Canary', folder: 'discordcanary' },
  { name: 'Discord Development', folder: 'discorddevelopment' }
]

export class TokenDetector {
  /**
   * Detección completa: busca candidatos, los valida y devuelve un
   * diagnóstico por fuente para que la UI pueda explicar qué pasó.
   */
  static async detectAndValidate(): Promise<DetectResult> {
    const { candidates, diagnostics } = await TokenDetector.detectAll()
    const valid: { source: string; token: string; user: unknown }[] = []

    for (const candidate of candidates) {
      const result = await TokenDetector.validateToken(candidate.token)
      if (!result.valid || !result.user) continue
      const user = result.user as { id: string }
      if (valid.some((v) => (v.user as { id: string }).id === user.id)) continue
      valid.push({ source: candidate.source, token: candidate.token, user: result.user })
    }

    return { candidates, valid, diagnostics }
  }

  /** Recorre las instalaciones de Discord y, opcionalmente, los navegadores. */
  static async detectAll(): Promise<{
    candidates: TokenCandidate[]
    diagnostics: DetectionDiagnostic[]
  }> {
    const candidates: TokenCandidate[] = []
    const diagnostics: DetectionDiagnostic[] = []

    if (process.platform !== 'win32') {
      return {
        candidates,
        diagnostics: [
          {
            source: 'Sistema',
            kind: 'discord',
            found: false,
            decrypted: false,
            detail: 'La detección automática solo está implementada para Windows.'
          }
        ]
      }
    }

    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    let anyDiscordInstalled = false

    for (const app of DISCORD_APPS) {
      const basePath = path.join(appData, app.folder)
      if (!fs.existsSync(basePath)) continue
      anyDiscordInstalled = true

      const diagnostic: DetectionDiagnostic = {
        source: app.name,
        kind: 'discord',
        found: true,
        decrypted: false,
        detail: ''
      }

      try {
        const leveldbPath = path.join(basePath, 'Local Storage', 'leveldb')
        if (!fs.existsSync(leveldbPath)) {
          diagnostic.detail = 'Instalado, pero sin almacén local (nunca se inició sesión).'
          diagnostics.push(diagnostic)
          continue
        }

        const masterKey = await TokenDetector.getMasterKey(basePath, diagnostic)
        if (!masterKey) {
          // Sin clave: puede que el token esté en claro (versiones antiguas).
          const plain = await TokenDetector.scanForUnencryptedTokens(leveldbPath)
          if (plain.length > 0) {
            for (const token of plain) {
              candidates.push({ source: app.name, token, path: leveldbPath })
            }
            diagnostic.decrypted = true
            diagnostic.detail = 'Token en claro encontrado (formato antiguo).'
          } else if (!diagnostic.detail) {
            diagnostic.detail = 'No se pudo obtener la clave de cifrado.'
          }
          diagnostics.push(diagnostic)
          continue
        }

        const encrypted = await TokenDetector.findEncryptedTokens(leveldbPath)
        if (encrypted.length === 0) {
          diagnostic.detail = 'No hay ningún token guardado (cierra sesión y vuelve a entrar en Discord).'
          diagnostics.push(diagnostic)
          continue
        }

        let decryptedCount = 0
        let unsupported = 0
        for (const value of encrypted) {
          const decrypted = TokenDetector.decryptValue(masterKey, value)
          if (decrypted === 'unsupported') {
            unsupported++
            continue
          }
          if (!decrypted) continue
          decryptedCount++
          if (!candidates.some((c) => c.token === decrypted)) {
            candidates.push({ source: app.name, token: decrypted, path: leveldbPath })
          }
        }

        diagnostic.decrypted = decryptedCount > 0
        if (decryptedCount > 0) {
          diagnostic.detail = `Token descifrado (${decryptedCount} sesión/es).`
        } else if (unsupported > 0) {
          diagnostic.detail =
            'Discord usa cifrado ligado a la aplicación (v20), que no se puede descifrar desde fuera.'
        } else {
          diagnostic.detail = 'El token existe pero no se pudo descifrar.'
        }
      } catch (error) {
        diagnostic.detail = `Error al leer el almacén: ${(error as Error).message}`
      }

      diagnostics.push(diagnostic)
    }

    if (!anyDiscordInstalled) {
      diagnostics.push({
        source: 'Discord',
        kind: 'discord',
        found: false,
        decrypted: false,
        detail: 'No se encontró ninguna instalación de Discord en este equipo.'
      })
    }

    // Navegadores: mejor esfuerzo (Chrome 127+ usa v20 y no se puede descifrar).
    const browserResult = await TokenDetector.scanBrowserProfiles()
    candidates.push(...browserResult.candidates)
    diagnostics.push(...browserResult.diagnostics)

    return { candidates, diagnostics }
  }

  // ===== Paso 1-2: clave maestra =====

  /**
   * Lee `Local State` y descifra `os_crypt.encrypted_key` con DPAPI.
   * Deja el motivo exacto del fallo en el diagnóstico.
   */
  private static async getMasterKey(
    basePath: string,
    diagnostic?: DetectionDiagnostic
  ): Promise<Buffer | null> {
    const localStatePath = path.join(basePath, 'Local State')
    if (!fs.existsSync(localStatePath)) {
      if (diagnostic) diagnostic.detail = 'No existe «Local State».'
      return null
    }

    let state: { os_crypt?: Record<string, string> }
    try {
      state = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'))
    } catch {
      if (diagnostic) diagnostic.detail = '«Local State» ilegible o corrupto.'
      return null
    }

    if (state.os_crypt?.app_bound_encrypted_key) {
      if (diagnostic) {
        diagnostic.detail =
          'Cifrado ligado a la aplicación (App-Bound Encryption). No se puede descifrar desde fuera.'
      }
      return null
    }

    const encryptedKeyB64 = state.os_crypt?.encrypted_key
    if (!encryptedKeyB64) {
      if (diagnostic) diagnostic.detail = '«Local State» no contiene ninguna clave.'
      return null
    }

    try {
      const encryptedKey = Buffer.from(encryptedKeyB64, 'base64')
      if (encryptedKey.subarray(0, 5).toString('utf-8') !== 'DPAPI') {
        if (diagnostic) diagnostic.detail = 'La clave no está protegida con DPAPI.'
        return null
      }
      return await TokenDetector.dpapiDecrypt(encryptedKey.subarray(5), diagnostic)
    } catch (error) {
      if (diagnostic) diagnostic.detail = `Clave inválida: ${(error as Error).message}`
      return null
    }
  }

  /**
   * Descifra un buffer con DPAPI usando PowerShell (asíncrono para no
   * congelar la interfaz). Prueba `powershell` y luego `pwsh`.
   */
  private static async dpapiDecrypt(
    encryptedData: Buffer,
    diagnostic?: DetectionDiagnostic
  ): Promise<Buffer | null> {
    const script = [
      'Add-Type -AssemblyName System.Security',
      `$e=[Convert]::FromBase64String('${encryptedData.toString('base64')}')`,
      '$d=[System.Security.Cryptography.ProtectedData]::Unprotect($e,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Convert]::ToBase64String($d)'
    ].join('\n')
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')

    for (const exe of ['powershell', 'pwsh']) {
      try {
        const { stdout } = await execFileAsync(
          exe,
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
          { windowsHide: true, timeout: 15000 }
        )
        const trimmed = String(stdout).trim()
        if (!trimmed) continue
        return Buffer.from(trimmed, 'base64')
      } catch {
        // Se prueba el siguiente ejecutable.
      }
    }

    if (diagnostic) {
      diagnostic.detail = 'No se pudo descifrar la clave con DPAPI (PowerShell no disponible).'
    }
    return null
  }

  // ===== Paso 3: localizar valores cifrados =====

  /**
   * Busca en LevelDB los valores con el marcador de Discord.
   *
   * Importante: el base64 se decodifica COMPLETO, con su relleno. Recortar
   * a múltiplos de 4 descarta los últimos bytes y hace que el tag GCM no
   * valide (era el fallo que dejaba la detección en 0 candidatos).
   */
  private static async findEncryptedTokens(leveldbPath: string): Promise<Buffer[]> {
    const found: Buffer[] = []

    let files: string[]
    try {
      files = fs
        .readdirSync(leveldbPath)
        .filter((f) => f.endsWith('.ldb') || f.endsWith('.log') || f.endsWith('.sst'))
    } catch {
      return found
    }

    for (const file of files) {
      const content = await TokenDetector.readLevelDbFile(path.join(leveldbPath, file))
      if (!content) continue
      found.push(...extractEncryptedPayloads(content))
    }

    const unique: Buffer[] = []
    const seen = new Set<string>()
    for (const buffer of found) {
      const key = buffer.toString('base64')
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(buffer)
    }
    return unique
  }

  /**
   * Lee un archivo de LevelDB. En Windows el `.log` puede estar bloqueado
   * por Discord: se intenta copiar a un temporal antes de rendirse.
   */
  private static async readLevelDbFile(filePath: string): Promise<string | null> {
    try {
      return (await fs.promises.readFile(filePath)).toString('latin1')
    } catch {
      // Bloqueado: se copia a un temporal (algunos bloqueos permiten copia).
      const tmp = path.join(os.tmpdir(), `dap-ldb-${crypto.randomUUID()}`)
      try {
        await fs.promises.copyFile(filePath, tmp)
        const content = await fs.promises.readFile(tmp)
        return content.toString('latin1')
      } catch {
        return null
      } finally {
        fs.promises.unlink(tmp).catch(() => undefined)
      }
    }
  }

  // ===== Paso 4: descifrado =====

  /**
   * Descifra un valor con AES-256-GCM delegando en token-crypto.ts.
   * Devuelve el token, `null` si falla, o `'unsupported'` para v20.
   */
  private static decryptValue(masterKey: Buffer, encryptedValue: Buffer): string | null | 'unsupported' {
    return decryptTokenValue(masterKey, encryptedValue)
  }

  // ===== Respaldo: tokens en claro =====

  /** Versiones antiguas guardaban el token sin cifrar. */
  private static async scanForUnencryptedTokens(leveldbPath: string): Promise<string[]> {
    const tokens: string[] = []
    if (!fs.existsSync(leveldbPath)) return tokens

    const patterns = [/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, /mfa\.[\w-]{84,}/g]
    let files: string[] = []
    try {
      files = fs.readdirSync(leveldbPath).filter((f) => f.endsWith('.ldb') || f.endsWith('.log'))
    } catch {
      return tokens
    }

    for (const file of files) {
      const content = await TokenDetector.readLevelDbFile(path.join(leveldbPath, file))
      if (!content) continue
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags)
        let match = regex.exec(content)
        while (match) {
          if (match[0].length >= 50 && !tokens.includes(match[0])) tokens.push(match[0])
          match = regex.exec(content)
        }
      }
    }
    return tokens
  }

  // ===== Navegadores (mejor esfuerzo) =====

  private static async scanBrowserProfiles(): Promise<{
    candidates: TokenCandidate[]
    diagnostics: DetectionDiagnostic[]
  }> {
    const candidates: TokenCandidate[] = []
    const diagnostics: DetectionDiagnostic[] = []
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

    const browsers: { name: string; basePath: string; profiles: string[] }[] = [
      { name: 'Chrome', basePath: path.join(localAppData, 'Google', 'Chrome', 'User Data'), profiles: ['Default', 'Profile 1', 'Profile 2'] },
      { name: 'Edge', basePath: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'), profiles: ['Default', 'Profile 1', 'Profile 2'] },
      { name: 'Brave', basePath: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'), profiles: ['Default', 'Profile 1'] },
      { name: 'Opera', basePath: path.join(appData, 'Opera Software', 'Opera Stable'), profiles: [''] },
      { name: 'Opera GX', basePath: path.join(appData, 'Opera Software', 'Opera GX Stable'), profiles: [''] }
    ]

    for (const browser of browsers) {
      if (!fs.existsSync(browser.basePath)) continue

      let reported = false
      for (const profile of browser.profiles) {
        const profilePath = profile ? path.join(browser.basePath, profile) : browser.basePath
        const leveldbPath = path.join(profilePath, 'Local Storage', 'leveldb')
        if (!fs.existsSync(leveldbPath)) continue

        const source = profile ? `${browser.name} (${profile})` : browser.name
        const diagnostic: DetectionDiagnostic = {
          source,
          kind: 'browser',
          found: true,
          decrypted: false,
          detail: ''
        }

        const masterKey = await TokenDetector.getMasterKey(browser.basePath, diagnostic)
        if (!masterKey) {
          diagnostic.detail ||= 'Sin clave utilizable (cifrado moderno del navegador).'
          diagnostics.push(diagnostic)
          reported = true
          continue
        }

        const encrypted = await TokenDetector.findEncryptedTokens(leveldbPath)
        let count = 0
        for (const value of encrypted) {
          const token = TokenDetector.decryptValue(masterKey, value)
          if (!token || token === 'unsupported') continue
          count++
          if (!candidates.some((c) => c.token === token)) {
            candidates.push({ source, token, path: leveldbPath })
          }
        }
        diagnostic.decrypted = count > 0
        diagnostic.detail = count > 0 ? `Token descifrado (${count}).` : 'Sin tokens de Discord en este perfil.'
        diagnostics.push(diagnostic)
        reported = true
        if (browser.name.startsWith('Opera')) break
      }

      if (!reported) {
        diagnostics.push({
          source: browser.name,
          kind: 'browser',
          found: false,
          decrypted: false,
          detail: 'Instalado, sin perfiles accesibles.'
        })
      }
    }

    return { candidates, diagnostics }
  }

  // ===== Validación =====

  /** Comprueba el token contra la API oficial. */
  static async validateToken(token: string): Promise<{ valid: boolean; user?: unknown }> {
    try {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      if (!response.ok) return { valid: false }
      return { valid: true, user: await response.json() }
    } catch {
      return { valid: false }
    }
  }
}
