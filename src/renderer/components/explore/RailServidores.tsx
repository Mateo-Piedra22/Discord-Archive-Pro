import { Compass, MessageSquare, RefreshCw } from 'lucide-react'
import type { DiscordGuild } from '../../../core/discord/types'

type Servidor = DiscordGuild & { isDM?: boolean }

interface Props {
  servidores: Servidor[]
  seleccionadoId: string | null
  cargando: boolean
  onSeleccionar: (servidor: Servidor) => void
  onAbrirSelector: () => void
  onActualizar: () => void
}

/**
 * Color estable derivado del id: el mismo servidor siempre recibe el mismo
 * tono, sin tabla de colores que mantener.
 */
function colorDeId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  return `hsl(${hash} 32% 34%)`
}

function inicialDe(nombre: string): string {
  return (nombre || '?').trim().charAt(0).toUpperCase() || '?'
}

/** Riel vertical de servidores: siempre visible, con scroll propio. */
export default function RailServidores({
  servidores,
  seleccionadoId,
  cargando,
  onSeleccionar,
  onAbrirSelector,
  onActualizar
}: Props) {
  return (
    <nav className="nav-rail" aria-label="Servidores">
      <button
        type="button"
        className="nav-rail__item"
        onClick={onAbrirSelector}
        title="Todos los servidores (Ctrl+Shift+S)"
        aria-label="Abrir selector de servidores"
      >
        <span className="nav-rail__icono">
          <Compass size={20} strokeWidth={1.8} />
        </span>
      </button>

      <div className="nav-rail__sep" />

      {cargando && servidores.length === 0 ? (
        <div className="col" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : (
        servidores.map((servidor) => {
          const activo = seleccionadoId === servidor.id
          const esDM = servidor.id === '@me' || servidor.isDM === true
          const nombre = servidor.name || 'Servidor'

          return (
            <button
              key={servidor.id}
              type="button"
              className={`nav-rail__item${activo ? ' nav-rail__item--activo' : ''}`}
              onClick={() => onSeleccionar(servidor)}
              title={nombre}
              aria-label={nombre}
              aria-current={activo ? 'true' : undefined}
            >
              {esDM ? (
                <span className="nav-rail__icono">
                  <MessageSquare size={20} strokeWidth={1.8} />
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
            </button>
          )
        })
      )}

      <div className="spacer" />

      <button
        type="button"
        className="nav-rail__item"
        onClick={onActualizar}
        disabled={cargando}
        title="Actualizar servidores"
        aria-label="Actualizar servidores"
      >
        <span className="nav-rail__icono">
          <RefreshCw size={18} strokeWidth={1.8} className={cargando ? 'girar' : undefined} />
        </span>
      </button>
    </nav>
  )
}
