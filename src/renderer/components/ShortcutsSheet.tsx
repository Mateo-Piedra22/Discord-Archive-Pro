// ============================================================
// Hoja de atajos: el mapa completo del teclado, en un solo sitio.
// Se abre con Ctrl+/ y se cierra con Esc.
// ============================================================

import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'

interface Atajo {
  accion: string
  /** Teclas de la combinación, en orden. */
  teclas: string[]
}

const ATAJOS: Atajo[] = [
  { accion: 'Abrir la paleta de comandos', teclas: ['Ctrl', 'K'] },
  { accion: 'Buscar en el archivo', teclas: ['Ctrl', 'F'] },
  { accion: 'Ver esta hoja de atajos', teclas: ['Ctrl', '/'] },
  { accion: 'Ir al panel', teclas: ['Ctrl', '1'] },
  { accion: 'Ir a explorar', teclas: ['Ctrl', '2'] },
  { accion: 'Ir a la cola de descargas', teclas: ['Ctrl', '3'] },
  { accion: 'Ir al archivo', teclas: ['Ctrl', '4'] },
  { accion: 'Ir a ajustes', teclas: ['Ctrl', '5'] },
  { accion: 'Ir a legal', teclas: ['Ctrl', '6'] },
  { accion: 'Volver o cerrar la capa superior', teclas: ['Esc'] },
  { accion: 'Compactar o expandir la ventana', teclas: ['Ctrl', 'Shift', 'M'] },
  { accion: 'Mostrar u ocultar la ventana', teclas: ['Ctrl', 'Shift', 'F'] },
  { accion: 'Maximizar o restaurar', teclas: ['Doble clic'] }
]

export default function ShortcutsSheet() {
  const atajosAbiertos = useUiStore((s) => s.atajosAbiertos)
  const setAtajos = useUiStore((s) => s.setAtajos)

  // Esc cierra la hoja mientras esté visible.
  useEffect(() => {
    if (!atajosAbiertos) return
    const alPulsar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        setAtajos(false)
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [atajosAbiertos, setAtajos])

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
              {ATAJOS.map((atajo) => (
                <tr key={atajo.accion}>
                  <td>{atajo.accion}</td>
                  <td>
                    <span className="row">
                      {atajo.teclas.map((tecla, indice) => (
                        <span key={tecla} className="row">
                          {indice > 0 && <span className="dim">+</span>}
                          <span className="kbd">{tecla}</span>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row paleta__campo">
          <span className="muted">Pulsa Esc para cerrar</span>
          <span className="spacer" />
          <span className="kbd">Esc</span>
        </div>
      </div>
    </div>
  )
}
