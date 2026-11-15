import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressTracker, TaskTracker } from './progress-tracker'

describe('TaskTracker y ProgressTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exige una ventana mínima de 0.05s antes de reportar velocidad', () => {
    const tracker = new TaskTracker()
    tracker.update({ bytesDownloaded: 0, bytesTotal: 10_000 })
    expect(tracker.getSpeed()).toBe(0)

    vi.advanceTimersByTime(20)
    tracker.update({ bytesDownloaded: 500 })
    expect(tracker.getSpeed()).toBe(0)

    vi.advanceTimersByTime(40) // 60ms acumulados (>= 0.05s)
    tracker.update({ bytesDownloaded: 1200 })
    expect(tracker.getSpeed()).toBeCloseTo(1200 / 0.06, 2)
  })

  it('poda muestras más antiguas de 8000ms al registrar nuevas muestras en update()', () => {
    const tracker = new TaskTracker()

    // Ráfaga inicial rápida: 100 KB/s
    tracker.update({ bytesDownloaded: 0 })
    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 100_000 })
    expect(tracker.getSpeed()).toBeCloseTo(100_000, 2)

    // Exactamente a los 8000ms desde t=0 (t=8000): t=0 aún sigue dentro de la ventana.
    vi.advanceTimersByTime(7000)
    tracker.update({ bytesDownloaded: 107_000 })
    expect(tracker.getSpeed()).toBeGreaterThan(0)

    // Avanzar 8001ms deja todas las muestras previas fuera de la ventana (>8000ms).
    vi.advanceTimersByTime(8001)
    tracker.update({ bytesDownloaded: 107_000 })
    expect(tracker.getSpeed()).toBe(0)

    // Nueva ventana limpia de 1s a 1000 B/s sin arrastre de la ráfaga podada.
    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 108_000 })
    expect(tracker.getSpeed()).toBeCloseTo(1000, 2)
  })

  it('aplica suavizado EMA (alpha = 0.35) en getSpeed() y mantiene idempotencia entre lecturas', () => {
    const tracker = new TaskTracker()

    tracker.update({ bytesDownloaded: 0 })
    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 1000 }) // primer valor válido = 1000 B/s
    expect(tracker.getSpeed()).toBeCloseTo(1000, 5)

    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 5000 }) // instantáneo de ventana [0..2s] = 2500 B/s
    // EMA = 0.35 * 2500 + 0.65 * 1000 = 1525 B/s
    expect(tracker.getSpeed()).toBeCloseTo(1525, 5)
    expect(tracker.getSpeed()).toBeCloseTo(1525, 5)

    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 9000 }) // instantáneo de ventana [0..3s] = 3000 B/s
    // EMA = 0.35 * 3000 + 0.65 * 1525 = 2041.25 B/s
    expect(tracker.getSpeed()).toBeCloseTo(2041.25, 5)
  })

  it('calcula getEta() por bytes restantes cuando bytesTotal > 0', () => {
    const tracker = new TaskTracker()
    tracker.update({ bytesTotal: 10_000, bytesDownloaded: 0 })
    expect(tracker.getEta()).toBe(0)

    vi.advanceTimersByTime(1000)
    tracker.update({ bytesDownloaded: 2000 }) // 2000 B/s, faltan 8000 B -> 4s
    expect(tracker.getEta()).toBe(4)

    vi.advanceTimersByTime(4000)
    tracker.update({ bytesDownloaded: 10_000 })
    expect(tracker.getEta()).toBe(0)
  })

  it('estima getEta() por ritmo de archivos cuando bytesTotal === 0 y assetsTotal > 0', () => {
    const tracker = new TaskTracker()

    // La fase previa de mensajes no debe distorsionar el ritmo de descarga de archivos.
    tracker.update({ phase: 'fetching' })
    vi.advanceTimersByTime(10_000)

    tracker.update({
      phase: 'downloading_assets',
      bytesTotal: 0,
      assetsTotal: 10,
      assetsDownloaded: 0
    })
    expect(tracker.getEta()).toBe(0)

    vi.advanceTimersByTime(4000)
    tracker.update({ assetsDownloaded: 2 }) // 2 archivos en 4s = 0.5/s; faltan 8 -> 16s
    expect(tracker.getEta()).toBe(16)

    vi.advanceTimersByTime(4000)
    tracker.update({ assetsDownloaded: 4 }) // 4 archivos en 8s = 0.5/s; faltan 6 -> 12s
    expect(tracker.getEta()).toBe(12)

    tracker.update({ assetsDownloaded: 10 })
    expect(tracker.getEta()).toBe(0)
  })

  it('ProgressTracker administra múltiples trackers y permite eliminarlos o limpiarlos', () => {
    const manager = new ProgressTracker()
    const t1 = manager.createTracker('task-1')
    const t2 = manager.createTracker('task-2')

    expect(manager.getTracker('task-1')).toBe(t1)
    expect(manager.getTracker('inexistente')).toBeUndefined()

    t1.update({ bytesTotal: 5000, bytesDownloaded: 0 })
    vi.advanceTimersByTime(1000)
    t1.update({ bytesDownloaded: 1000 })

    expect(manager.getSpeed('task-1')).toBeCloseTo(1000, 2)
    expect(manager.getEta('task-1')).toBe(4)
    expect(manager.getSpeed('task-2')).toBe(0)
    expect(manager.getEta('inexistente')).toBe(0)

    manager.remove('task-1')
    expect(manager.getTracker('task-1')).toBeUndefined()
    expect(manager.getTracker('task-2')).toBe(t2)

    manager.clear()
    expect(manager.getTracker('task-2')).toBeUndefined()
  })
})
