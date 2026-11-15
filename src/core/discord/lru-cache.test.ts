import { describe, expect, it } from 'vitest'
import { LruCache } from './lru-cache'

describe('LruCache', () => {
  it('rechaza capacidades inválidas con RangeError', () => {
    expect(() => new LruCache(0)).toThrow(RangeError)
    expect(() => new LruCache(-3)).toThrow(RangeError)
    expect(() => new LruCache(1.5)).toThrow(RangeError)
    expect(() => new LruCache(Number.NaN)).toThrow(RangeError)
  })

  it('almacena, consulta, elimina y limpia entradas respetando capacity/size', () => {
    const cache = new LruCache<string, number>(3)
    expect(cache.capacity).toBe(3)
    expect(cache.size).toBe(0)

    cache.set('a', 1).set('b', 2)
    expect(cache.size).toBe(2)
    expect(cache.has('a')).toBe(true)
    expect(cache.get('a')).toBe(1)
    expect([...cache.values()]).toEqual([2, 1])

    expect(cache.delete('b')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.size).toBe(1)

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('desaloja la entrada menos usada recientemente al superar la capacidad', () => {
    const cache = new LruCache<string, string>(2)
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')

    // Leer k1 la promueve sobre k2
    expect(cache.get('k1')).toBe('v1')

    cache.set('k3', 'v3')
    expect(cache.has('k2')).toBe(false)
    expect(cache.get('k1')).toBe('v1')
    expect(cache.get('k3')).toBe('v3')
  })

  it('reemplazar una clave existente la renueva en el orden LRU', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // renueva 'a'
    cache.set('c', 3) // debe expulsar 'b'

    expect(cache.has('b')).toBe(false)
    expect(cache.get('a')).toBe(10)
    expect(cache.get('c')).toBe(3)
  })
})
