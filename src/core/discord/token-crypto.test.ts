import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import {
  TOKEN_MARKER,
  decryptTokenValue,
  encryptTokenValue,
  extractEncryptedPayloads
} from './token-crypto'

const KEY = crypto.createHash('sha256').update('clave-de-prueba').digest()
// Se arma en tiempo de ejecución a propósito: un token con forma real escrito
// literalmente hace saltar la protección de secretos de GitHub al publicar.
const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'].join('.')

describe('extractEncryptedPayloads', () => {
  it('decodifica el base64 completo, incluido el relleno final', () => {
    // Este es exactamente el caso que rompía la sincronización: el valor
    // acaba en "=" y recortarlo a múltiplos de 4 perdía bytes.
    const cifrado = encryptTokenValue(KEY, TOKEN)
    const base64 = cifrado.toString('base64')
    expect(base64.endsWith('=')).toBe(true)

    const contenido = `ruido\u0000${TOKEN_MARKER}${base64}\u0000mas ruido`
    const [extraido] = extractEncryptedPayloads(contenido)

    expect(extraido).toBeDefined()
    expect(extraido.equals(cifrado)).toBe(true)
    expect(extraido.length).toBe(cifrado.length)
  })

  it('extrae varios valores del mismo bloque', () => {
    const uno = encryptTokenValue(KEY, TOKEN)
    const dos = encryptTokenValue(KEY, `${TOKEN}2`)
    const contenido = `${TOKEN_MARKER}${uno.toString('base64')}x${TOKEN_MARKER}${dos.toString('base64')}`
    expect(extractEncryptedPayloads(contenido)).toHaveLength(2)
  })

  it('ignora valores demasiado cortos', () => {
    expect(extractEncryptedPayloads(`${TOKEN_MARKER}abc`)).toHaveLength(0)
  })

  it('devuelve vacío si no hay marcador', () => {
    expect(extractEncryptedPayloads('contenido sin token')).toHaveLength(0)
  })
})

describe('decryptTokenValue', () => {
  it('descifra un valor v10 íntegro', () => {
    const cifrado = encryptTokenValue(KEY, TOKEN)
    expect(decryptTokenValue(KEY, cifrado)).toBe(TOKEN)
  })

  it('falla si se recortan bytes (regresión del bug original)', () => {
    const cifrado = encryptTokenValue(KEY, TOKEN)
    const recortado = cifrado.subarray(0, cifrado.length - 3)
    expect(decryptTokenValue(KEY, recortado)).toBeNull()
  })

  it('falla con una clave distinta', () => {
    const otra = crypto.createHash('sha256').update('otra').digest()
    const cifrado = encryptTokenValue(KEY, TOKEN)
    expect(decryptTokenValue(otra, cifrado)).toBeNull()
  })

  it('marca v20 como no soportado', () => {
    const cifrado = encryptTokenValue(KEY, TOKEN, 'v20')
    expect(decryptTokenValue(KEY, cifrado)).toBe('unsupported')
  })

  it('rechaza versiones desconocidas', () => {
    const cifrado = encryptTokenValue(KEY, TOKEN, 'v99')
    expect(decryptTokenValue(KEY, cifrado)).toBeNull()
  })
})
