// ============================================================
// Criptografía del token de Discord — utilidades puras y testeables.
//
// El fallo histórico: recortar el base64 a múltiplos de 4 descartaba
// los últimos caracteres (el valor acaba en "="), el tag GCM dejaba
// de validar y la detección devolvía 0 candidatos. Estas funciones
// fijan el comportamiento correcto con tests.
// ============================================================

import crypto from 'crypto'

/** Marcador que Discord antepone al token cifrado en LevelDB. */
export const TOKEN_MARKER = 'dQw4w9WgXcQ:'

/**
 * Base64 estándar incluyendo relleno. El flag `y` (sticky) obliga a que
 * el valor empiece justo después del marcador.
 */
const BASE64_PATTERN = /[A-Za-z0-9+/]+={0,2}/y

/** Longitud mínima razonable de un token cifrado en base64. */
const MIN_BASE64_LENGTH = 40

/**
 * Extrae todos los valores cifrados que siguen a un marcador dentro de
 * un bloque de LevelDB.
 *
 * Se decodifica el base64 COMPLETO, con su relleno. Si el bloque quedó
 * cortado, se completa el relleno para no perder bytes.
 */
export function extractEncryptedPayloads(content: string): Buffer[] {
  const found: Buffer[] = []
  let searchStart = 0

  while (true) {
    const markerIndex = content.indexOf(TOKEN_MARKER, searchStart)
    if (markerIndex === -1) break
    searchStart = markerIndex + TOKEN_MARKER.length

    BASE64_PATTERN.lastIndex = searchStart
    const match = BASE64_PATTERN.exec(content)
    if (!match) continue

    const base64 = match[0]
    if (base64.length < MIN_BASE64_LENGTH) continue

    const padded = base64.length % 4 === 0 ? base64 : base64 + '='.repeat(4 - (base64.length % 4))
    const buffer = Buffer.from(padded, 'base64')
    if (buffer.length > 20) found.push(buffer)
  }

  return found
}

export type DecryptResult = string | null | 'unsupported'

/**
 * Descifra un valor con AES-256-GCM.
 * Formato: "v10" | "v11" + nonce(12) + cifrado + tag(16).
 * Devuelve `'unsupported'` para `v20` (cifrado ligado a la aplicación).
 */
export function decryptTokenValue(masterKey: Buffer, encryptedValue: Buffer): DecryptResult {
  const version = encryptedValue.subarray(0, 3).toString('utf-8')
  if (version === 'v20') return 'unsupported'
  if (version !== 'v10' && version !== 'v11') return null

  try {
    const iv = encryptedValue.subarray(3, 15)
    const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16)
    const authTag = encryptedValue.subarray(encryptedValue.length - 16)
    if (ciphertext.length < 1 || iv.length !== 12 || authTag.length !== 16) return null

    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const token = decrypted.toString('utf-8')

    // Un token de Discord es ASCII imprimible y contiene puntos.
    if (token.length > 20 && /^[\x20-\x7E]+$/.test(token) && token.includes('.')) return token
    return null
  } catch {
    return null
  }
}

/** Cifra un valor con el mismo formato (solo para pruebas y diagnóstico). */
export function encryptTokenValue(masterKey: Buffer, plaintext: string, version = 'v10'): Buffer {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from(version, 'utf-8'), iv, ciphertext, tag])
}
