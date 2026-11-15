// ============================================================
// Buscador global del archivo local.
// Consulta al proceso principal, que recorre los .md, .html,
// .json, .csv y .txt ya descargados, y muestra cada coincidencia
// con su archivo, su ruta relativa y su número de línea.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertCircle, FolderOpen, History, Loader2, RotateCcw, Search } from 'lucide-react'
import type { SearchHit, SearchResult } from '../../shared/api'
import { useUiStore } from '../stores/uiStore'

/** Mínimo de caracteres para lanzar una consulta. */
const MINIMO = 2
/** Espera antes de consultar: evita golpear el disco en cada tecla. */
const ESPERA_MS = 250
/** Tope de coincidencias que se piden al proceso principal. */
const LIMITE = 80
/** Clave de persistencia y tope para búsquedas recientes exitosas. */
const RECIENTES_KEY = 'estrato_busquedas_recientes'
const MAX_RECIENTES = 6

const FILTROS_EXTENSION = [
  { ext: '', etiqueta: 'Todos' },
  { ext: 'md', etiqueta: 'MD' },
  { ext: 'html', etiqueta: 'HTML' },
  { ext: 'json', etiqueta: 'JSON' },
  { ext: 'csv', etiqueta: 'CSV' },
  { ext: 'txt', etiqueta: 'TXT' }
] as const

function extraerExtensionesConsulta(consulta: string): string[] {
  const exts: string[] = []
  for (const parte of consulta.trim().split(/\s+/)) {
    if (!parte) continue
    const match = /^ext:([a-z0-9.,_-]+)$/i.exec(parte)
    if (!match) continue
    for (const raw of match[1].split(',')) {
      const limpia = raw.trim().toLowerCase().replace(/^\./, '')
      if (limpia && !exts.includes(limpia)) exts.push(limpia)
    }
  }
  return exts
}

function quitarTokensExtension(consulta: string): string {
  return consulta
    .trim()
    .split(/\s+/)
    .filter((parte) => parte && !/^ext:/i.test(parte))
    .join(' ')
}

function aplicarExtensionEnConsulta(consulta: string, ext: string): string {
  const extsActivas = extraerExtensionesConsulta(consulta)
  const sinExt = quitarTokensExtension(consulta)

  if (!ext || (extsActivas.length === 1 && extsActivas[0] === ext)) {
    return sinExt
  }

  return sinExt ? `${sinExt} ext:${ext}` : `ext:${ext} `
}

function leerRecientes(): string[] {
  try {
    const raw = localStorage.getItem(RECIENTES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_RECIENTES)
  } catch {
    return []
  }
}

function guardarRecientes(lista: string[]): void {
  try {
    if (lista.length === 0) {
      localStorage.removeItem(RECIENTES_KEY)
    } else {
      localStorage.setItem(RECIENTES_KEY, JSON.stringify(lista.slice(0, MAX_RECIENTES)))
    }
  } catch {
    // Sin acceso a localStorage.
  }
}

/**
 * Envuelve la primera aparición de un término de `aguja` dentro de `texto`
 * en un `<mark>`, ignorando filtros `ext:...` y diferencias de tildes o mayúsculas.
 */
function plegarConMapa(texto: string): { plegado: string; origPorPos: number[] } {
  let plegado = ''
  const origPorPos: number[] = []
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    for (let j = 0; j < base.length; j++) {
      plegado += base[j]
      origPorPos.push(i)
    }
  }
  return { plegado, origPorPos }
}

function resaltar(texto: string, aguja: string) {
  const terminos = aguja
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/^ext:/i.test(t))
    .map((t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
    .filter(Boolean)

  if (terminos.length === 0) return texto

  const { plegado, origPorPos } = plegarConMapa(texto)
  let mejorPos = -1
  let mejorLen = 0
  for (const termino of terminos) {
    const idx = plegado.indexOf(termino)
    if (idx !== -1 && (mejorPos === -1 || idx < mejorPos)) {
      mejorPos = idx
      mejorLen = termino.length
    }
  }
  if (mejorPos === -1 || mejorPos >= origPorPos.length) return texto

  const inicioOrig = origPorPos[mejorPos]
  const finIdx = Math.min(origPorPos.length - 1, mejorPos + mejorLen - 1)
  const finOrig = origPorPos[finIdx] + 1

  return (
    <>
      {texto.slice(0, inicioOrig)}
      <mark>{texto.slice(inicioOrig, finOrig)}</mark>
      {texto.slice(finOrig)}
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
  const [recientes, setRecientes] = useState<string[]>(() => leerRecientes())

  // Contador de peticiones: descarta respuestas que llegan tarde y que
  // corresponden a una consulta que el usuario ya cambió.
  const peticion = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const registrarReciente = useCallback((terminoBuscado: string) => {
    const limpio = terminoBuscado.trim()
    if (limpio.length < MINIMO) return
    setRecientes((prev) => {
      const sinDuplicado = prev.filter((item) => item.toLowerCase() !== limpio.toLowerCase())
      const siguiente = [limpio, ...sinDuplicado].slice(0, MAX_RECIENTES)
      guardarRecientes(siguiente)
      return siguiente
    })
  }, [])

  const limpiarRecientes = useCallback(() => {
    setRecientes([])
    guardarRecientes([])
  }, [])

  const buscar = useCallback(
    async (termino: string) => {
      const id = ++peticion.current
      setCargando(true)
      setError(null)

      try {
        const datos = await window.api.archive.search(termino, LIMITE)
        if (id !== peticion.current) return
        setResultado(datos)
        setIndice(0)
        if (datos.hits.length > 0) {
          registrarReciente(termino)
        }
      } catch (fallo) {
        if (id !== peticion.current) return
        setResultado(null)
        setError(fallo instanceof Error ? fallo.message : 'No se pudo completar la búsqueda.')
      } finally {
        if (id === peticion.current) setCargando(false)
      }
    },
    [registrarReciente]
  )

  // Cada apertura arranca limpia y con el foco en el campo.
  useEffect(() => {
    if (!abierta) return
    peticion.current++
    setConsulta('')
    setResultado(null)
    setError(null)
    setCargando(false)
    setIndice(0)
    setRecientes(leerRecientes())
  }, [abierta])

  // Consulta con retardo. El temporizador se limpia en cada tecla para que
  // solo se dispare la última escritura.
  useEffect(() => {
    if (!abierta) return

    const termino = consulta.trim()
    const terminoSinExt = quitarTokensExtension(consulta)
    if (termino.length < MINIMO || terminoSinExt.length === 0) {
      peticion.current++
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
      // Se abre dentro del visor de la app y propaga el término limpio para
      // que el visor integrado resalte y filtre las coincidencias al instante.
      const terminoLimpio = quitarTokensExtension(consulta)
      abrirArchivo(hit.path, terminoLimpio)
      setBusqueda(false)
    },
    [abrirArchivo, consulta, setBusqueda]
  )

  const cerrar = useCallback(() => setBusqueda(false), [setBusqueda])

  const seleccionarExtension = useCallback((ext: string) => {
    setConsulta((actual) => aplicarExtensionEnConsulta(actual, ext))
    inputRef.current?.focus()
  }, [])

  const termino = consulta.trim()
  const terminoSinExt = quitarTokensExtension(consulta)
  const extensionesActivas = extraerExtensionesConsulta(consulta)
  const extensionUnica = extensionesActivas.length === 1 ? extensionesActivas[0] : ''
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
              ref={inputRef}
              className="input input--search"
              type="text"
              value={consulta}
              onChange={(evento) => setConsulta(evento.target.value)}
              onKeyDown={alPulsarTecla}
              placeholder="Buscar en el archivo… (ej. guía ext:md)"
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

        {/* ---------- Filtros rápidos por extensión ---------- */}
        <div
          className="row"
          role="group"
          aria-label="Filtrar por extensión"
          style={{ padding: '0 var(--sp-3) var(--sp-2)', gap: 'var(--sp-1)', flexWrap: 'wrap' }}
        >
          {FILTROS_EXTENSION.map((filtro) => {
            const activa =
              filtro.ext === ''
                ? extensionesActivas.length === 0
                : extensionUnica === filtro.ext
            return (
              <button
                key={filtro.etiqueta}
                type="button"
                className={`chip${activa ? ' chip--active' : ''}`}
                aria-pressed={activa}
                onClick={() => seleccionarExtension(filtro.ext)}
              >
                {filtro.etiqueta}
              </button>
            )
          })}
        </div>

        <hr className="divider" />

        {/* ---------- Resultados ---------- */}
        <div
          className="list"
          role={hits.length > 0 ? 'listbox' : undefined}
          aria-label={hits.length > 0 ? 'Coincidencias' : undefined}
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
            recientes.length > 0 ? (
              <div className="col" style={{ gap: 'var(--sp-1)', padding: 'var(--sp-1)' }}>
                <div className="row" style={{ padding: 'var(--sp-1) var(--sp-2)' }}>
                  <span className="section__title">Búsquedas recientes</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={limpiarRecientes}
                    style={{ height: 24, fontSize: 'var(--text-xs)' }}
                  >
                    Limpiar recientes
                  </button>
                </div>

                {recientes.map((reciente) => (
                  <button
                    key={reciente}
                    type="button"
                    className="list__row"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => {
                      setConsulta(reciente)
                      inputRef.current?.focus()
                    }}
                  >
                    <History size={14} strokeWidth={1.8} className="dim" />
                    <span className="list__name">{reciente}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="empty__icon">
                  <Search size={18} strokeWidth={1.8} />
                </div>
                <span className="empty__title">Buscar en el archivo</span>
                <p className="empty__text">
                  Escribe al menos {MINIMO} caracteres. Búsqueda sin tildes, multipalabra y con filtro{' '}
                  <code>ext:md,html,json,csv,txt</code>.
                </p>
              </div>
            )
          )}

          {!error && termino.length >= MINIMO && terminoSinExt.length === 0 && (
            <div className="empty">
              <div className="empty__icon">
                <Search size={18} strokeWidth={1.8} />
              </div>
              <span className="empty__title">Filtro de extensión activo</span>
              <p className="empty__text">
                Escribe al menos una palabra junto al filtro para buscar dentro de esos archivos.
              </p>
            </div>
          )}

          {!error && termino.length >= MINIMO && terminoSinExt.length > 0 && cargando && !resultado && (
            <div className="empty">
              <Loader2 size={18} strokeWidth={1.8} className="busqueda-girando muted" />
              <span className="empty__text">Buscando…</span>
            </div>
          )}

          {!error && termino.length >= MINIMO && terminoSinExt.length > 0 && !cargando && resultado && hits.length === 0 && (
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
                title="Abrir y resaltar en el visor"
                onMouseEnter={() => setIndice(posicion)}
                onClick={() => void abrir(hit)}
              >
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <span className="list__name truncate">{hit.name}</span>
                    <span className="spacer" />
                    <span className="list__meta">Abrir y resaltar en el visor</span>
                    <span className="list__meta mono">L{hit.line}</span>
                  </div>

                  <span className="dim truncate" style={{ fontSize: 'var(--text-xs)' }}>
                    {hit.relative}
                  </span>

                  <span className="muted truncate" style={{ fontSize: 'var(--text-xs)' }}>
                    {resaltar(hit.excerpt, termino)}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  title="Mostrar en carpeta"
                  aria-label={`Mostrar ${hit.name} en carpeta`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.api.settings.revealFolder(hit.path)
                  }}
                  style={{ flexShrink: 0, height: 24, padding: '0 8px', fontSize: 'var(--text-xs)' }}
                >
                  <FolderOpen size={13} strokeWidth={1.8} />
                  <span>Mostrar en carpeta</span>
                </button>
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
          {resultado?.durationMs !== undefined && (
            <>
              <span className="dim">·</span>
              <span className="dim mono">{resultado.durationMs} ms</span>
            </>
          )}

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
