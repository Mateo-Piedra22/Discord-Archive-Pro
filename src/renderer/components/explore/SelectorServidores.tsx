import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { MessageSquare, Search, X } from 'lucide-react'
import type { DiscordGuild } from '../../../core/discord/types'
import { foldChannelText } from '../../channelFilters'

type Servidor = DiscordGuild & { isDM?: boolean }

interface Props {
  abierto: boolean
  servidores: Servidor[]
  seleccionadoId: string | null
  onSeleccionar: (servidor: Servidor) => void
  onCerrar: () => void
}

function colorDeId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return `hsl(${hash} 32% 34%)`
}

function inicialDe(nombre: string): string {
  return (nombre || '?').trim().charAt(0).toUpperCase() || '?'
}

/**
 * Selector de servidores: rejilla buscable sobre una capa con scrim.
 * Se cierra con Esc, con el botón de cierre o pulsando fuera.
 */
export default function SelectorServidores({
  abierto,
  servidores,
  seleccionadoId,
  onSeleccionar,
  onCerrar
}: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [indiceActivo, setIndiceActivo] = useState(0)
  const campoRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!abierto) return
    setBusqueda('')
    const idxActual = seleccionadoId ? servidores.findIndex((s) => s.id === seleccionadoId) : -1
    setIndiceActivo(idxActual >= 0 ? idxActual : 0)
    campoRef.current?.focus()

    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        onCerrar()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [abierto, onCerrar, seleccionadoId, servidores])

  const filtrados = useMemo(() => {
    const q = foldChannelText(busqueda.trim())
    if (!q) return servidores
    return servidores.filter((s) => foldChannelText(s.name || '').includes(q))
  }, [servidores, busqueda])

  useEffect(() => {
    setIndiceActivo((previo) => {
      if (filtrados.length === 0) return 0
      return Math.min(previo, filtrados.length - 1)
    })
  }, [filtrados.length])

  useEffect(() => {
    if (!abierto) return
    itemsRef.current[indiceActivo]?.scrollIntoView({ block: 'nearest' })
  }, [abierto, indiceActivo, filtrados.length])

  if (!abierto) return null

  const obtenerColumnas = (): number => {
    const grid = gridRef.current
    if (!grid) return 1
    const cols = window.getComputedStyle(grid).gridTemplateColumns
    if (!cols || cols === 'none' || cols.includes('repeat(')) return 1
    const partes = cols.trim().split(/\s+/).filter(Boolean)
    return partes.length > 0 ? partes.length : 1
  }

  const alPulsarTecla = (evento: ReactKeyboardEvent<HTMLDivElement>) => {
    const total = filtrados.length
    if (total === 0) return

    if (evento.key === 'Enter') {
      const elegido = filtrados[indiceActivo]
      if (elegido) {
        evento.preventDefault()
        onSeleccionar(elegido)
      }
      return
    }

    const enInput = evento.target === campoRef.current
    if (enInput && (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight')) {
      const input = campoRef.current
      const vacio = !input || input.value.length === 0
      const enBordeDerecho =
        input &&
        evento.key === 'ArrowRight' &&
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length
      if (!vacio && !enBordeDerecho) return
    }

    const cols = obtenerColumnas()

    if (evento.key === 'ArrowRight') {
      evento.preventDefault()
      setIndiceActivo((previo) => (previo + 1) % total)
    } else if (evento.key === 'ArrowLeft') {
      evento.preventDefault()
      setIndiceActivo((previo) => (previo - 1 + total) % total)
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setIndiceActivo((previo) => {
        if (cols <= 1) return (previo + 1) % total
        if (previo + cols < total) return previo + cols
        const filaActual = Math.floor(previo / cols)
        const ultimaFila = Math.floor((total - 1) / cols)
        if (filaActual < ultimaFila) return total - 1
        return previo % cols
      })
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setIndiceActivo((previo) => {
        if (cols <= 1) return (previo - 1 + total) % total
        if (previo - cols >= 0) return previo - cols
        const col = previo % cols
        const ultimaFila = Math.floor((total - 1) / cols)
        const candidato = ultimaFila * cols + col
        return candidato < total ? candidato : Math.max(0, candidato - cols)
      })
    }
  }

  return (
    <div className="scrim" onClick={onCerrar}>
      <div
        className="dialogo servidores-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Seleccionar servidor"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={alPulsarTecla}
      >
        <div className="row servidores-panel__head">
          <div className="col truncate">
            <strong className="truncate">Servidores</strong>
            <span className="muted truncate">
              {busqueda.trim()
                ? `${filtrados.length} de ${servidores.length} disponibles`
                : `${servidores.length} disponibles`}
            </span>
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onCerrar}
            title="Cerrar (Esc)"
            aria-label="Cerrar selector de servidores"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="search servidores-panel__buscar">
          <Search size={14} strokeWidth={1.8} className="search__icon" />
          <input
            ref={campoRef}
            className="input"
            placeholder="Buscar servidor"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value)
              setIndiceActivo(0)
            }}
            aria-label="Buscar servidor"
          />
        </div>

        {filtrados.length === 0 ? (
          <div className="empty">
            <div className="empty__title">Sin resultados</div>
            <div className="empty__text">Ningún servidor coincide con la búsqueda.</div>
          </div>
        ) : (
          <div className="servidores-panel__grid" ref={gridRef}>
            {filtrados.map((servidor, indice) => {
              const activo = seleccionadoId === servidor.id
              const resaltado = indice === indiceActivo
              const esDM = servidor.id === '@me' || servidor.isDM === true
              const nombre = servidor.name || 'Servidor'
              const miembros =
                typeof servidor.approximate_member_count === 'number'
                  ? servidor.approximate_member_count
                  : null

              return (
                <button
                  key={servidor.id}
                  ref={(nodo) => {
                    itemsRef.current[indice] = nodo
                  }}
                  type="button"
                  className={`servidores-panel__item${activo || resaltado ? ' servidores-panel__item--activo' : ''}`}
                  style={
                    resaltado
                      ? {
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-fg)',
                          boxShadow: 'inset 0 0 0 1px var(--accent-line)'
                        }
                      : undefined
                  }
                  onMouseEnter={() => setIndiceActivo(indice)}
                  onFocus={() => setIndiceActivo(indice)}
                  onClick={() => onSeleccionar(servidor)}
                  aria-current={activo ? 'true' : undefined}
                  data-activo={resaltado ? 'true' : undefined}
                >
                  {esDM ? (
                    <span className="nav-rail__icono">
                      <MessageSquare size={18} strokeWidth={1.8} />
                    </span>
                  ) : servidor.icon ? (
                    <img
                      className="nav-rail__icono"
                      src={`https://cdn.discordapp.com/icons/${servidor.id}/${servidor.icon}.png?size=64`}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="nav-rail__icono"
                      style={{ background: colorDeId(servidor.id) }}
                    >
                      {inicialDe(nombre)}
                    </span>
                  )}
                  <span className="col truncate" style={{ flex: 1, minWidth: 0 }}>
                    <span className="servidores-panel__nombre">{nombre}</span>
                    {miembros !== null && (
                      <span className="muted mono truncate" style={{ fontSize: 'var(--text-2xs)' }}>
                        {miembros.toLocaleString('es')} miembros
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
