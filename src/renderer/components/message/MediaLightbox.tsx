// ============================================================
// Visor a pantalla completa para imágenes y vídeos del archivo.
// Sin librerías: zoom con rueda y botones, cierre con Esc o fondo.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Check, Copy, ExternalLink, Minus, Plus, RotateCcw, X } from 'lucide-react'

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

interface PropsLightbox {
  url: string
  tipo: 'imagen' | 'video'
  onClose: () => void
}

/** Teclas que desplazan el contenedor y no deben filtrarse al chat de fondo. */
const TECLAS_DE_SCROLL = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

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

export default function MediaLightbox({ url, tipo, onClose }: PropsLightbox) {
  const [escala, setEscala] = useState(1)
  const [copiado, setCopiado] = useState(false)

  const capaRef = useRef<HTMLDivElement>(null)
  const temporizadorRef = useRef<number | null>(null)

  const nombre = nombreDeArchivo(url)

  const ajustar = useCallback((delta: number) => {
    setEscala((actual) => {
      const siguiente = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, actual + delta))
      return Math.round(siguiente * 100) / 100
    })
  }, [])

  // Cerrar con Esc.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onClose])

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

  // Las teclas de desplazamiento no deben mover el chat que queda detrás.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      const destino = evento.target as HTMLElement | null
      if (destino && /^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName)) return
      if (TECLAS_DE_SCROLL.has(evento.key)) evento.preventDefault()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])

  // Limpia el aviso de «Copiado» si se cierra antes de tiempo.
  useEffect(() => {
    return () => {
      if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
    }
  }, [])

  const copiarEnlace = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
      temporizadorRef.current = window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin permiso de portapapeles: no hay nada que avisar.
    }
  }, [url])

  /** Cierra solo cuando el clic cae en el fondo, no en el contenido. */
  const alPulsarFondo = useCallback(
    (evento: ReactMouseEvent<HTMLDivElement>) => {
      if (evento.target === evento.currentTarget) onClose()
    },
    [onClose]
  )

  const abrirFuera = sePuedeAbrirFuera(url)

  return (
    <div
      className="lightbox"
      ref={capaRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor de ${tipo}: ${nombre}`}
      onMouseDown={alPulsarFondo}
    >
      <div className="lightbox__barra">
        <span className="lightbox__nombre truncate" title={nombre}>
          {nombre}
        </span>

        <div className="lightbox__acciones">
          {tipo === 'imagen' && (
            <>
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => ajustar(-PASO_ZOOM)}
                title="Alejar"
                aria-label="Alejar"
                disabled={escala <= ESCALA_MIN}
              >
                <Minus size={14} strokeWidth={1.8} />
              </button>
              <span className="lightbox__escala mono">{Math.round(escala * 100)}%</span>
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => ajustar(PASO_ZOOM)}
                title="Acercar"
                aria-label="Acercar"
                disabled={escala >= ESCALA_MAX}
              >
                <Plus size={14} strokeWidth={1.8} />
              </button>
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setEscala(1)}
                title="Restablecer zoom"
                aria-label="Restablecer zoom"
                disabled={escala === 1}
              >
                <RotateCcw size={14} strokeWidth={1.8} />
              </button>
            </>
          )}

          <button
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => void copiarEnlace()}
            title="Copiar enlace"
            aria-label="Copiar enlace"
          >
            {copiado ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
          </button>

          {abrirFuera && (
            <button
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => void window.api.app.openExternal(url)}
              title="Abrir en el navegador"
              aria-label="Abrir en el navegador"
            >
              <ExternalLink size={14} strokeWidth={1.8} />
            </button>
          )}

          <button
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
        {tipo === 'imagen' ? (
          <img
            className="lightbox__media"
            src={url}
            alt={nombre}
            style={{ transform: `scale(${escala})` }}
            draggable={false}
          />
        ) : (
          <video
            className="lightbox__media"
            src={url}
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
