// ============================================================
// Hoja de atajos: el mapa completo del teclado, en un solo sitio.
// Se abre con Ctrl+/ y se cierra con Esc.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { Keyboard, Search, X } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'

interface Atajo {
  accion: string
  /** Teclas de la combinación, en orden o alternativas. */
  teclas: string[]
  /** Separador visual entre teclas (por defecto '+'). */
  separador?: string
}

const ATAJOS: Atajo[] = [
  { accion: 'Abrir la paleta de comandos', teclas: ['Ctrl', 'K'] },
  { accion: 'Buscar en el archivo local', teclas: ['Ctrl', 'F'] },
  { accion: 'Ver esta hoja de atajos', teclas: ['Ctrl', '/'] },
  { accion: 'Ir al panel', teclas: ['Ctrl', '1'] },
  { accion: 'Ir a explorar', teclas: ['Ctrl', '2'] },
  { accion: 'Ir a la cola de descargas', teclas: ['Ctrl', '3'] },
  { accion: 'Ir al archivo', teclas: ['Ctrl', '4'] },
  { accion: 'Ir a ajustes', teclas: ['Ctrl', '5'] },
  { accion: 'Ir a legal', teclas: ['Ctrl', '6'] },
  { accion: 'Colección anterior o siguiente en el visor', teclas: ['Alt', '←', '→'], separador: ' / ' },
  { accion: 'Cambiar entre Documento, Galería y Archivos', teclas: ['Alt', '1 / 2 / 3'] },
  { accion: 'Abrir o cerrar el selector de servidores (en Explorar)', teclas: ['Ctrl', 'Shift', 'S'] },
  { accion: 'Volver, limpiar filtro activo o cerrar la capa superior', teclas: ['Esc'] },
  { accion: 'Compactar o expandir la ventana', teclas: ['Ctrl', 'Shift', 'M'] },
  { accion: 'Mostrar u ocultar la ventana', teclas: ['Ctrl', 'Shift', 'F'] },
  { accion: 'Maximizar o restaurar la ventana (en barra de título)', teclas: ['Doble clic'] },
  { accion: 'Seleccionar rango de publicaciones', teclas: ['Shift', 'Clic'] },
  { accion: 'Elemento anterior o siguiente en el visor multimedia', teclas: ['←', '→'], separador: '/' },
  { accion: 'Rotar imagen 90° en el visor multimedia', teclas: ['R'] },
  { accion: 'Acercar, alejar o restablecer zoom en el visor', teclas: ['+', '-', '0'], separador: '/' },
  { accion: 'Alternar zoom 100% / 200% sobre la imagen', teclas: ['Doble clic'] }
]

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export default function ShortcutsSheet() {
  const atajosAbiertos = useUiStore((s) => s.atajosAbiertos)
  const setAtajos = useUiStore((s) => s.setAtajos)
  const [filtro, setFiltro] = useState('')

  // Esc cierra la hoja mientras esté visible; al abrir se limpia el buscador.
  useEffect(() => {
    if (!atajosAbiertos) return
    setFiltro('')
    const alPulsar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        setAtajos(false)
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [atajosAbiertos, setAtajos])

  const atajosVisibles = useMemo(() => {
    const aguja = normalizar(filtro.trim())
    if (!aguja) return ATAJOS
    return ATAJOS.filter((atajo) => {
      const combinacion = atajo.teclas.join(` ${atajo.separador ?? '+'} `)
      return (
        normalizar(atajo.accion).includes(aguja) ||
        normalizar(combinacion).includes(aguja)
      )
    })
  }, [filtro])

  if (!atajosAbiertos) return null

  const cerrar = () => setAtajos(false)

  return (
    <div className="scrim scrim--centro" onClick={cerrar}>
      <div
        className="dialogo"
        role="dialog"
        aria-modal="true"
        aria-label="Atajos de teclado"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="paleta__campo">
          <Keyboard size={16} strokeWidth={1.8} className="muted" />
          <span className="truncate">Atajos de teclado</span>
          <span className="spacer" />
          <div className="search" style={{ width: 210 }}>
            <Search size={14} strokeWidth={1.8} className="search__icon" />
            <input
              className="input input--search"
              type="search"
              placeholder="Filtrar atajos…"
              aria-label="Filtrar atajos"
              value={filtro}
              onChange={(evento) => setFiltro(evento.target.value)}
            />
          </div>
          <button className="btn btn--ghost btn--icon" type="button" title="Cerrar" onClick={cerrar}>
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        <div className="paleta__lista">
          <table className="table">
            <thead>
              <tr>
                <th>Acción</th>
                <th>Combinación</th>
              </tr>
            </thead>
            <tbody>
              {atajosVisibles.length > 0 ? (
                atajosVisibles.map((atajo) => (
                  <tr key={atajo.accion}>
                    <td>{atajo.accion}</td>
                    <td>
                      <span className="row">
                        {atajo.teclas.map((tecla, indice) => (
                          <span key={tecla} className="row">
                            {indice > 0 && <span className="dim">{atajo.separador ?? '+'}</span>}
                            <span className="kbd">{tecla}</span>
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>
                    Ningún atajo coincide con «{filtro}».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="row paleta__campo" style={{ flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Operadores de filtro: <span className="mono">de:usuario</span> ·{' '}
            <span className="mono">has:embed</span> · <span className="mono">has:pinned</span> ·{' '}
            <span className="mono">ext:csv</span>
          </span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>Cerrar</span>
          <span className="kbd">Esc</span>
        </div>
      </div>
    </div>
  )
}
