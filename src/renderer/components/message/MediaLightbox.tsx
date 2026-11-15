// ============================================================
// Visor a pantalla completa para imágenes y vídeos del archivo.
// Sin librerías: zoom con rueda y botones, rotación, navegación
// entre elementos y cierre con Esc o fondo.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X
} from 'lucide-react'

const ESCALA_MIN = 0.5
const ESCALA_MAX = 4
const PASO_ZOOM = 0.2

/** Mismos dominios que acepta el proceso principal en `app:open-external`. */
const HOSTS_PERMITIDOS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com'
])

export interface ElementoLightbox {
  url: string
  tipo: 'imagen' | 'video'
  nombre?: string
}

interface PropsLightbox {
  url: string
  tipo: 'imagen' | 'video'
  onClose: () => void
  items?: ElementoLightbox[]
  indiceInicial?: number
}

/** Teclas que desplazan el contenedor y no deben filtrarse al chat de fondo. */
const TECLAS_DE_SCROLL = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

function indiceInicialSeguro(items?: ElementoLightbox[], indiceInicial?: number): number {
  if (!items || items.length === 0) return 0
  const base = indiceInicial ?? 0
  if (!Number.isFinite(base)) return 0
  return Math.max(0, Math.min(items.length - 1, Math.trunc(base)))
}

/** Último segmento de la ruta, decodificado, como nombre visible. */
function nombreDeArchivo(url: string): string {
  try {
    const partes = new URL(url).pathname.split('/')
    const ultimo = partes[partes.length - 1]
    return ultimo ? decodeURIComponent(ultimo) : 'archivo'
  } catch {
    return 'archivo'
  }
}

/**
 * Ancestro más cercano que scrollea por su cuenta. El visor se monta dentro
 * del contenedor de mensajes, así que bloquear solo el body no basta.
 */
function ancestroConScroll(nodo: HTMLElement | null): HTMLElement | null {
  let actual = nodo?.parentElement ?? null
  while (actual) {
    const estilo = window.getComputedStyle(actual)
    const scrollea = estilo.overflowY === 'auto' || estilo.overflowY === 'scroll'
    if (scrollea && actual.scrollHeight > actual.clientHeight) return actual
    actual = actual.parentElement
  }
  return null
}

/** Solo ofrecemos abrir fuera si el main va a aceptar el dominio. */
function sePuedeAbrirFuera(url: string): boolean {
  try {
    const destino = new URL(url)
    if (destino.protocol === 'discord:') return true
    return destino.protocol === 'https:' && HOSTS_PERMITIDOS.has(destino.hostname)
  } catch {
    return false
  }
}

export default function MediaLightbox({
  url,
  tipo,
  onClose,
  items,
  indiceInicial
}: PropsLightbox) {
  const [indiceActual, setIndiceActual] = useState(() =>
    indiceInicialSeguro(items, indiceInicial)
  )
  const [escala, setEscala] = useState(1)
  const [rotacion, setRotacion] = useState(0)
  const [copiado, setCopiado] = useState(false)

  const capaRef = useRef<HTMLDivElement>(null)
  const temporizadorRef = useRef<number | null>(null)

  const totalItems = items?.length ?? 0
  const tieneItems = totalItems > 0
  const puedeNavegar = totalItems > 1
  const indiceActivo = tieneItems ? Math.max(0, Math.min(totalItems - 1, indiceActual)) : 0
  const elementoActivo = tieneItems ? items![indiceActivo] : null

  const urlActual = elementoActivo?.url ?? url
  const tipoActual = elementoActivo?.tipo ?? tipo
  const nombre = elementoActivo?.nombre || nombreDeArchivo(urlActual)

  useEffect(() => {
    setIndiceActual(indiceInicialSeguro(items, indiceInicial))
    setEscala(1)
    setRotacion(0)
  }, [url, tipo, indiceInicial, totalItems])

  useEffect(() => {
    setEscala(1)
    setRotacion(0)
    setCopiado(false)
    if (temporizadorRef.current !== null) {
      window.clearTimeout(temporizadorRef.current)
      temporizadorRef.current = null
    }
  }, [indiceActivo, urlActual, tipoActual])

  const ajustar = useCallback((delta: number) => {
    setEscala((actual) => {
      const siguiente = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, actual + delta))
      return Math.round(siguiente * 100) / 100
    })
  }, [])

  const rotar = useCallback(() => {
    setRotacion((actual) => (actual + 90) % 360)
  }, [])

  const restablecer = useCallback(() => {
    setEscala(1)
    setRotacion(0)
  }, [])

  const alternarZoom = useCallback(() => {
    setEscala((actual) => (actual === 1 ? 2 : 1))
  }, [])

  const irAnterior = useCallback(() => {
    if (totalItems <= 1) return
    setIndiceActual((actual) => {
      const base = Math.max(0, Math.min(totalItems - 1, actual))
      return (base - 1 + totalItems) % totalItems
    })
    setEscala(1)
    setRotacion(0)
  }, [totalItems])

  const irSiguiente = useCallback(() => {
    if (totalItems <= 1) return
    setIndiceActual((actual) => {
      const base = Math.max(0, Math.min(totalItems - 1, actual))
      return (base + 1) % totalItems
    })
    setEscala(1)
    setRotacion(0)
  }, [totalItems])

  // Bloquear el scroll de la página y del contenedor que scrollea de verdad.
  // En la vista de canal ese contenedor es `.chat__scroll`, no el body.
  useEffect(() => {
    const anteriorBody = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const contenedor = ancestroConScroll(capaRef.current)
    const anteriorContenedor = contenedor?.style.overflow ?? ''
    if (contenedor) contenedor.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = anteriorBody
      if (contenedor) contenedor.style.overflow = anteriorContenedor
    }
  }, [])

  // La rueda necesita un listener no pasivo para poder cancelar el scroll.
  useEffect(() => {
    const nodo = capaRef.current
    if (!nodo) return

    const alRodar = (evento: WheelEvent) => {
      evento.preventDefault()
      ajustar(evento.deltaY < 0 ? PASO_ZOOM : -PASO_ZOOM)
    }

    nodo.addEventListener('wheel', alRodar, { passive: false })
    return () => nodo.removeEventListener('wheel', alRodar)
  }, [ajustar])

  // Atajos de teclado: Esc, navegación, rotación, zoom y bloqueo de scroll del chat de fondo.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        onClose()
        return
      }

      const destino = evento.target as HTMLElement | null
      if (destino && (/^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName) || destino.isContentEditable)) {
        return
      }

      if (evento.ctrlKey || evento.metaKey || evento.altKey) return

      if (evento.key === 'ArrowLeft') {
        if (puedeNavegar) {
          evento.preventDefault()
          irAnterior()
        }
        return
      }

      if (evento.key === 'ArrowRight') {
        if (puedeNavegar) {
          evento.preventDefault()
          irSiguiente()
        }
        return
      }

      if (tipoActual === 'imagen') {
        if (evento.key === 'r' || evento.key === 'R') {
          rotar()
          return
        }
        if (evento.key === '+' || evento.key === '=') {
          evento.preventDefault()
          ajustar(PASO_ZOOM)
          return
        }
        if (evento.key === '-') {
          evento.preventDefault()
          ajustar(-PASO_ZOOM)
          return
        }
        if (evento.key === '0') {
          evento.preventDefault()
          restablecer()
          return
        }
      }

      if (TECLAS_DE_SCROLL.has(evento.key)) evento.preventDefault()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onClose, puedeNavegar, irAnterior, irSiguiente, tipoActual, rotar, ajustar, restablecer])

  // Limpia el aviso de «Copiado» si se cierra antes de tiempo.
  useEffect(() => {
    return () => {
      if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
    }
  }, [])

  const copiarEnlace = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(urlActual)
      setCopiado(true)
      if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
      temporizadorRef.current = window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin permiso de portapapeles: no hay nada que avisar.
    }
  }, [urlActual])

  /** Cierra solo cuando el clic cae en el fondo, no en el contenido. */
  const alPulsarFondo = useCallback(
    (evento: ReactMouseEvent<HTMLDivElement>) => {
      if (evento.target === evento.currentTarget) onClose()
    },
    [onClose]
  )

  const abrirFuera = sePuedeAbrirFuera(urlActual)

  return (
    <div
      className="lightbox"
      ref={capaRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor de ${tipoActual}: ${nombre}`}
      onMouseDown={alPulsarFondo}
    >
      <div className="lightbox__barra">
        <span className="lightbox__nombre truncate" title={nombre}>
          {nombre}
        </span>

        <div className="lightbox__acciones">
          {puedeNavegar && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={irAnterior}
                title="Anterior (←)"
                aria-label="Anterior"
              >
                <ChevronLeft size={14} strokeWidth={1.8} />
              </button>
              <span
                className="lightbox__escala mono"
                style={{ width: 'auto', minWidth: 44, padding: '0 4px' }}
              >
                {indiceActivo + 1} / {totalItems}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={irSiguiente}
                title="Siguiente (→)"
                aria-label="Siguiente"
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
            </>
          )}

          {tipoActual === 'imagen' && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => ajustar(-PASO_ZOOM)}
                title="Alejar (-)"
                aria-label="Alejar"
                disabled={escala <= ESCALA_MIN}
              >
                <Minus size={14} strokeWidth={1.8} />
              </button>
              <span className="lightbox__escala mono">{Math.round(escala * 100)}%</span>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => ajustar(PASO_ZOOM)}
                title="Acercar (+)"
                aria-label="Acercar"
                disabled={escala >= ESCALA_MAX}
              >
                <Plus size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={rotar}
                title="Rotar 90° (R)"
                aria-label="Rotar 90°"
              >
                <RotateCw size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={restablecer}
                title="Restablecer zoom y rotación (0)"
                aria-label="Restablecer zoom"
                disabled={escala === 1 && rotacion === 0}
              >
                <RotateCcw size={14} strokeWidth={1.8} />
              </button>
            </>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => void copiarEnlace()}
            title="Copiar enlace"
            aria-label="Copiar enlace"
          >
            {copiado ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
          </button>

          {abrirFuera && (
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => void window.api.app.openExternal(urlActual)}
              title="Abrir en el navegador"
              aria-label="Abrir en el navegador"
            >
              <ExternalLink size={14} strokeWidth={1.8} />
            </button>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
            autoFocus
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="lightbox__lienzo" onMouseDown={alPulsarFondo}>
        {tipoActual === 'imagen' ? (
          <img
            key={`${indiceActivo}-${urlActual}`}
            className="lightbox__media"
            src={urlActual}
            alt={nombre}
            style={{ transform: `scale(${escala}) rotate(${rotacion}deg)` }}
            onDoubleClick={alternarZoom}
            draggable={false}
          />
        ) : (
          <video
            key={`${indiceActivo}-${urlActual}`}
            className="lightbox__media"
            src={urlActual}
            controls
            autoPlay
            loop
            muted
            playsInline
          />
        )}
      </div>
    </div>
  )
}
