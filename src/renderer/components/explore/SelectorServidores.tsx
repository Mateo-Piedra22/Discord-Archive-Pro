import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search, X } from 'lucide-react'
import type { DiscordGuild } from '../../../core/discord/types'

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
  const campoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!abierto) return
    setBusqueda('')
    campoRef.current?.focus()

    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        onCerrar()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [abierto, onCerrar])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return servidores
    return servidores.filter((s) => (s.name || '').toLowerCase().includes(q))
  }, [servidores, busqueda])

  if (!abierto) return null

  return (
    <div className="scrim" onClick={onCerrar}>
      <div
        className="dialogo servidores-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Seleccionar servidor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row servidores-panel__head">
          <div className="col truncate">
            <strong className="truncate">Servidores</strong>
            <span className="muted truncate">{servidores.length} disponibles</span>
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
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar servidor"
          />
        </div>

        {filtrados.length === 0 ? (
          <div className="empty">
            <div className="empty__title">Sin resultados</div>
            <div className="empty__text">Ningún servidor coincide con la búsqueda.</div>
          </div>
        ) : (
          <div className="servidores-panel__grid">
            {filtrados.map((servidor) => {
              const activo = seleccionadoId === servidor.id
              const esDM = servidor.id === '@me' || servidor.isDM === true
              const nombre = servidor.name || 'Servidor'

              return (
                <button
                  key={servidor.id}
                  type="button"
                  className={`servidores-panel__item${activo ? ' servidores-panel__item--activo' : ''}`}
                  onClick={() => onSeleccionar(servidor)}
                  aria-current={activo ? 'true' : undefined}
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
                  <span className="servidores-panel__nombre">{nombre}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
