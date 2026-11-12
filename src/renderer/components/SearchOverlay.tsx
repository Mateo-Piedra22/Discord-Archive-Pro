// ============================================================
// Buscador global del archivo local.
// Consulta al proceso principal, que recorre los .md, .html,
// .json, .csv y .txt ya descargados, y muestra cada coincidencia
// con su archivo, su ruta relativa y su número de línea.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertCircle, Loader2, RotateCcw, Search } from 'lucide-react'
import type { SearchHit, SearchResult } from '../../shared/api'
import { useUiStore } from '../stores/uiStore'

/** Mínimo de caracteres para lanzar una consulta. */
const MINIMO = 2
/** Espera antes de consultar: evita golpear el disco en cada tecla. */
const ESPERA_MS = 250
/** Tope de coincidencias que se piden al proceso principal. */
const LIMITE = 80

/**
 * Envuelve la primera aparición de `aguja` dentro de `texto` en un <mark>.
 * La comparación ignora mayúsculas para que el resaltado coincida con la
 * búsqueda real, pero el texto mostrado conserva su forma original.
 */
function resaltar(texto: string, aguja: string) {
  const limpia = aguja.trim()
  if (!limpia) return texto

  const posicion = texto.toLowerCase().indexOf(limpia.toLowerCase())
  if (posicion === -1) return texto

  return (
    <>
      {texto.slice(0, posicion)}
      <mark>{texto.slice(posicion, posicion + limpia.length)}</mark>
      {texto.slice(posicion + limpia.length)}
    </>
  )
}

export default function SearchOverlay() {
  const abierta = useUiStore((estado) => estado.busquedaAbierta)
  const setBusqueda = useUiStore((estado) => estado.setBusqueda)
  const abrirArchivo = useUiStore((estado) => estado.abrirArchivo)

  const [consulta, setConsulta] = useState('')
  const [resultado, setResultado] = useState<SearchResult | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [indice, setIndice] = useState(0)

  // Contador de peticiones: descarta respuestas que llegan tarde y que
  // corresponden a una consulta que el usuario ya cambió.
  const peticion = useRef(0)

  const buscar = useCallback(async (termino: string) => {
    const id = ++peticion.current
    setCargando(true)
    setError(null)

    try {
      const datos = await window.api.archive.search(termino, LIMITE)
      if (id !== peticion.current) return
      setResultado(datos)
      setIndice(0)
    } catch (fallo) {
      if (id !== peticion.current) return
      setResultado(null)
      setError(fallo instanceof Error ? fallo.message : 'No se pudo completar la búsqueda.')
    } finally {
      if (id === peticion.current) setCargando(false)
    }
  }, [])

  // Cada apertura arranca limpia y con el foco en el campo.
  useEffect(() => {
    if (!abierta) return
    peticion.current++
    setConsulta('')
    setResultado(null)
    setError(null)
    setCargando(false)
    setIndice(0)
  }, [abierta])

  // Consulta con retardo. El temporizador se limpia en cada tecla para que
  // solo se dispare la última escritura.
  useEffect(() => {
    if (!abierta) return

    const termino = consulta.trim()
    if (termino.length < MINIMO) {
      setResultado(null)
      setError(null)
      setCargando(false)
      return
    }

    const temporizador = setTimeout(() => {
      void buscar(termino)
    }, ESPERA_MS)

    return () => clearTimeout(temporizador)
  }, [consulta, abierta, buscar])

  const abrir = useCallback(
    async (hit: SearchHit) => {
      // Se abre dentro del visor de la app: sacar al usuario al programa del
      // sistema rompía el flujo de lectura.
      abrirArchivo(hit.path)
      setBusqueda(false)
    },
    [abrirArchivo, setBusqueda]
  )

  const cerrar = useCallback(() => setBusqueda(false), [setBusqueda])

  const termino = consulta.trim()
  const hits = resultado?.hits ?? []
  const activo = hits.length > 0 ? Math.min(indice, hits.length - 1) : 0

  function alPulsarTecla(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Escape') {
      evento.preventDefault()
      cerrar()
      return
    }

    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setIndice((previo) => (hits.length === 0 ? 0 : Math.min(previo + 1, hits.length - 1)))
      return
    }

    if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setIndice((previo) => Math.max(previo - 1, 0))
      return
    }

    if (evento.key === 'Enter') {
      evento.preventDefault()
      const elegido = hits[activo]
      if (elegido) void abrir(elegido)
    }
  }

  if (!abierta) return null

  return (
    <div
      className="scrim"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) cerrar()
      }}
    >
      {/* Animación del indicador y resaltado de coincidencias. */}
      <style>{`
        @keyframes busqueda-girar { to { transform: rotate(360deg); } }
        .busqueda-girando { animation: busqueda-girar 900ms linear infinite; }
        .dialogo mark {
          background: var(--accent-line);
          color: var(--fg);
          border-radius: 3px;
          padding: 0 2px;
          font-weight: 600;
        }
      `}</style>

      <div
        className="dialogo"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en el archivo"
        style={{ width: 'min(760px, calc(100vw - 48px))' }}
      >
        {/* ---------- Campo de búsqueda ---------- */}
        <div className="row" style={{ padding: 'var(--sp-3)', gap: 'var(--sp-3)' }}>
          <div className="search" style={{ flex: 1 }}>
            <Search size={15} strokeWidth={1.8} className="search__icon" />
            <input
              className="input input--search"
              type="text"
              value={consulta}
              onChange={(evento) => setConsulta(evento.target.value)}
              onKeyDown={alPulsarTecla}
              placeholder="Buscar en el archivo…"
              aria-label="Buscar en el archivo"
              autoFocus
              spellCheck={false}
            />
          </div>

          {cargando && (
            <span className="row dim" style={{ gap: 6, fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
              <Loader2 size={14} strokeWidth={1.8} className="busqueda-girando" />
              Buscando…
            </span>
          )}
        </div>

        <hr className="divider" />

        {/* ---------- Resultados ---------- */}
        <div
          className="list"
          role="listbox"
          aria-label="Coincidencias"
          style={{ overflowY: 'auto', padding: 'var(--sp-2)', minHeight: 0, maxHeight: '52vh' }}
        >
          {error && (
            <div className="empty">
              <div className="empty__icon">
                <AlertCircle size={18} strokeWidth={1.8} />
              </div>
              <span className="empty__title">No se pudo buscar</span>
              <p className="empty__text">{error}</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void buscar(termino)}>
                <RotateCcw size={14} strokeWidth={1.8} />
                Reintentar
              </button>
            </div>
          )}

          {!error && termino.length < MINIMO && (
            <div className="empty">
              <div className="empty__icon">
                <Search size={18} strokeWidth={1.8} />
              </div>
              <span className="empty__title">Buscar en el archivo</span>
              <p className="empty__text">
                Escribe al menos {MINIMO} caracteres. Se revisan los archivos .md, .html, .json, .csv y .txt
                descargados.
              </p>
            </div>
          )}

          {!error && termino.length >= MINIMO && cargando && !resultado && (
            <div className="empty">
              <Loader2 size={18} strokeWidth={1.8} className="busqueda-girando muted" />
              <span className="empty__text">Buscando…</span>
            </div>
          )}

          {!error && termino.length >= MINIMO && !cargando && resultado && hits.length === 0 && (
            <div className="empty">
              <div className="empty__icon">
                <Search size={18} strokeWidth={1.8} />
              </div>
              <span className="empty__title">Sin coincidencias</span>
              <p className="empty__text">Ningún archivo del archivo contiene «{termino}».</p>
            </div>
          )}

          {!error &&
            hits.map((hit, posicion) => (
              <div
                key={`${hit.path}:${hit.line}`}
                role="option"
                aria-selected={posicion === activo}
                className={posicion === activo ? 'list__row list__row--active' : 'list__row'}
                onMouseEnter={() => setIndice(posicion)}
                onClick={() => void abrir(hit)}
              >
                <div className="col" style={{ flex: 1, gap: 2 }}>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <span className="list__name truncate">{hit.name}</span>
                    <span className="spacer" />
                    <span className="list__meta mono">L{hit.line}</span>
                  </div>

                  <span className="dim truncate" style={{ fontSize: 'var(--text-xs)' }}>
                    {hit.relative}
                  </span>

                  <span className="muted truncate" style={{ fontSize: 'var(--text-xs)' }}>
                    {resaltar(hit.excerpt, termino)}
                  </span>
                </div>
              </div>
            ))}
        </div>

        {/* ---------- Pie ---------- */}
        <hr className="divider" />

        <div
          className="row"
          style={{ padding: 'var(--sp-2) var(--sp-3)', gap: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}
        >
          <span className="dim">
            {hits.length} {hits.length === 1 ? 'coincidencia' : 'coincidencias'}
          </span>
          <span className="dim">·</span>
          <span className="dim">{resultado?.scanned ?? 0} archivos escaneados</span>

          {resultado?.truncated && <span className="badge badge--warn">Resultados truncados</span>}

          <span className="spacer" />

          <span className="kbd">↑</span>
          <span className="kbd">↓</span>
          <span className="dim">mover</span>
          <span className="kbd">Enter</span>
          <span className="dim">abrir</span>
          <span className="kbd">Esc</span>
          <span className="dim">cerrar</span>
        </div>
      </div>
    </div>
  )
}
