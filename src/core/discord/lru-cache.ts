// ============================================================
// Caché LRU acotada — Mantiene la huella de memoria en O(N)
// usando el orden de inserción nativo de Map en V8 (O(1) real).
// ============================================================

export class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`LruCache maxEntries debe ser un entero >= 1 (recibido: ${maxEntries})`)
    }
  }

  get capacity(): number {
    return this.maxEntries
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    // Reinsertar mueve la clave al final (más recientemente usada).
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey)
      }
    }
    this.map.set(key, value)
    return this
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  values(): IterableIterator<V> {
    return this.map.values()
  }
}
