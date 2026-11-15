// ============================================================
// Visor de documento — Markdown exportado con tipografía de
// lectura: ancho de línea corto, tablas reales, imágenes con
// pie. El bloque de metadatos del export queda plegado.
// ============================================================

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { MouseEvent as EventoRaton, ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, ListTree, Search, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
// @ts-ignore - Soporte para HTML sin procesar en markdown
import rehypeRaw from 'rehype-raw'

const ICONO_TRAZO = 1.8
const ESCALA_MIN = 0.9
const ESCALA_MAX = 1.25
const ESCALA_PASO = 0.05

const CLAVE_ANCHO_DOC = 'dap_doc_width'
const CLAVE_FUENTE_DOC = 'dap_doc_font'

type AnchoColumna = 'normal' | 'ancho' | 'completo'
type TipografiaDoc = 'sans' | 'serif' | 'mono'

const ANCHOS_COLUMNA: Record<AnchoColumna, { etiqueta: string; valor: string }> = {
  normal: { etiqueta: 'Normal', valor: '78ch' },
  ancho: { etiqueta: 'Ancho', valor: '110ch' },
  completo: { etiqueta: 'Completo', valor: '100%' }
}

const TIPOGRAFIAS_DOC: Record<TipografiaDoc, { etiqueta: string; valor: string }> = {
  sans: { etiqueta: 'Sans', valor: 'var(--font-sans)' },
  serif: { etiqueta: 'Serif', valor: 'var(--font-display)' },
  mono: { etiqueta: 'Mono', valor: 'var(--font-mono)' }
}

function leerAnchoInicial(): AnchoColumna {
  try {
    const guardado = window.localStorage.getItem(CLAVE_ANCHO_DOC)
    if (guardado === 'normal' || guardado === 'ancho' || guardado === 'completo') {
      return guardado
    }
  } catch {
    // Sin acceso a localStorage.
  }
  return 'normal'
}

function leerTipografiaInicial(): TipografiaDoc {
  try {
    const guardado = window.localStorage.getItem(CLAVE_FUENTE_DOC)
    if (guardado === 'sans' || guardado === 'serif' || guardado === 'mono') {
      return guardado
    }
  } catch {
    // Sin acceso a localStorage.
  }
  return 'sans'
}

/** Esquemas que no se resuelven como archivo local ni se abren fuera. */
const ESQUEMAS_PERMITIDOS = /^(https?:|archive:|data:|blob:|mailto:|#)/i

interface PropsVisor {
  /** Markdown ya leído del disco. */
  contenido: string
  /** Ruta del archivo, para resolver `assets/...` contra su carpeta. */
  ruta: string
  /** Abre una imagen del documento a pantalla completa. */
  onAmpliar?: (url: string) => void
  /** Consulta inicial propagada desde el buscador global o puente de archivo. */
  consultaInicial?: string
}

/** Resuelve un recurso relativo del markdown contra la carpeta del archivo. */
function resolverAsset(src: string, ruta: string): string {
  if (!src) return ''
  // Anclas internas del documento: no se tocan.
  if (src.startsWith('#')) return src
  // Un esquema explícito solo se acepta si es seguro; el resto se descarta.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return ESQUEMAS_PERMITIDOS.test(src) ? src : ''
  }

  const partes = ruta.split(/[\\/]/)
  const carpeta = partes.slice(0, -1).join('/')
  const limpio = src.replace(/^\.?\//, '')
  // Dentro de /replies/ los assets viven un nivel arriba (raíz del post).
  const base = limpio.startsWith('assets/') && /[\\/]replies[\\/]/i.test(ruta)
    ? partes.slice(0, -2).join('/')
    : carpeta

  return window.api.archive.toUrl(`${base}/${limpio}`.replace(/\\/g, '/'))
}

interface Partido {
  metadatos: string[]
  cuerpo: string
}

/**
 * Separa el bloque de metadatos que escribe el exportador (frontmatter YAML
 * y citas iniciales con autor, fecha, etiquetas y reacciones) del cuerpo real.
 */
function partirDocumento(contenido: string): Partido {
  const lineas = contenido.replace(/\r\n/g, '\n').split('\n')
  const metadatos: string[] = []
  let indice = 0

  // 1. Frontmatter YAML inicial.
  if (lineas[0]?.trim() === '---') {
    const cierre = lineas.indexOf('---', 1)
    if (cierre > 0) {
      metadatos.push(...lineas.slice(1, cierre))
      indice = cierre + 1
    }
  }

  // 2. El título se conserva dentro del cuerpo: es la cabecera del documento.
  const cuerpo: string[] = []
  while (indice < lineas.length && lineas[indice].trim() === '') indice++
  if (lineas[indice]?.startsWith('#')) {
    cuerpo.push(lineas[indice])
    indice++
  }

  // 3. Citas y separadores inmediatamente posteriores al título.
  const bloque: string[] = []
  let siguiente = indice
  while (siguiente < lineas.length) {
    const limpia = lineas[siguiente].trim()
    if (limpia === '' || limpia === '---' || limpia.startsWith('>')) {
      bloque.push(lineas[siguiente])
      siguiente++
      continue
    }
    break
  }

  // Solo es metadatos si de verdad había una cita: si no, era contenido.
  const esMetadatos = bloque.some((linea) => linea.trim().startsWith('>'))
  if (esMetadatos) {
    metadatos.push(...bloque)
    indice = siguiente
  }

  cuerpo.push(...lineas.slice(indice))

  return { metadatos, cuerpo: cuerpo.join('\n').trim() }
}

interface EntradaIndice {
  id: string
  nivel: number
  titulo: string
}

function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function textoPlanoDeNodo(nodo: ReactNode): string {
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo)
  if (Array.isArray(nodo)) return Children.toArray(nodo).map(textoPlanoDeNodo).join('')
  if (isValidElement<{ children?: ReactNode }>(nodo)) return textoPlanoDeNodo(nodo.props.children)
  return ''
}

function lenguajeDeBloque(children: ReactNode): string {
  for (const hijo of Children.toArray(children)) {
    if (isValidElement<{ className?: string }>(hijo)) {
      const cls = hijo.props.className ?? ''
      const match = /language-([^\s]+)/i.exec(cls)
      if (match) return match[1]
    }
  }
  return ''
}

function BloqueCodigo({ children, className }: { children?: ReactNode; className?: string }) {
  const [copiado, setCopiado] = useState(false)
  const temporizadorRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
  }, [])

  const alCopiar = async () => {
    const texto = textoPlanoDeNodo(children)
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      if (temporizadorRef.current !== null) window.clearTimeout(temporizadorRef.current)
      temporizadorRef.current = window.setTimeout(() => setCopiado(false), 1800)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  const lenguaje = lenguajeDeBloque(children)

  return (
    <div
      style={{
        margin: 'var(--sp-3) 0',
        background: 'var(--surface-2)',
        border: '1px solid var(--line-soft)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden'
      }}
    >
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          padding: '4px 8px 4px 12px',
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--line-soft)',
          fontSize: 'var(--text-xs)'
        }}
      >
        <span className="mono dim">{lenguaje}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void alCopiar()}
          title="Copiar código"
          aria-label={copiado ? 'Código copiado' : 'Copiar código'}
          style={{
            height: 22,
            padding: '0 8px',
            fontSize: 'var(--text-xs)',
            color: copiado ? 'var(--ok)' : 'var(--fg-2)'
          }}
        >
          {copiado
            ? <Check size={12} strokeWidth={ICONO_TRAZO} />
            : <Copy size={12} strokeWidth={ICONO_TRAZO} />}
          <span>{copiado ? 'Copiado' : 'Copiar código'}</span>
        </button>
      </div>
      <pre
        className={className}
        style={{
          margin: 0,
          border: 0,
          borderRadius: 0,
          background: 'transparent'
        }}
      >
        {children}
      </pre>
    </div>
  )
}

function crearSlugUnico(titulo: string, conteos: Map<string, number>): string {
  const base =
    normalizarTexto(titulo)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'seccion'
  const n = (conteos.get(base) ?? 0) + 1
  conteos.set(base, n)
  return n === 1 ? `doc-${base}` : `doc-${base}-${n}`
}

/** Extrae el índice (H1-H3) y métricas de lectura ignorando bloques de código. */
function analizarLectura(cuerpo: string): {
  indice: EntradaIndice[]
  palabras: number
  minutosLectura: number
} {
  const lineas = cuerpo.split('\n')
  const indice: EntradaIndice[] = []
  const conteos = new Map<string, number>()
  let enCodigo = false
  let palabras = 0

  for (const linea of lineas) {
    const recorte = linea.trim()
    if (recorte.startsWith('```') || recorte.startsWith('~~~')) {
      enCodigo = !enCodigo
      continue
    }
    if (!enCodigo) {
      const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(recorte)
      if (m) {
        const titulo = m[2].replace(/[*_`[\]]/g, '').trim()
        if (titulo) {
          indice.push({
            id: crearSlugUnico(titulo, conteos),
            nivel: m[1].length,
            titulo
          })
        }
      }
    }
    const tokens = recorte.split(/\s+/).filter(Boolean)
    palabras += tokens.length
  }

  return {
    indice,
    palabras,
    minutosLectura: Math.max(1, Math.round(palabras / 200))
  }
}

function contarCoincidencias(texto: string, agujaNorm: string): number {
  if (agujaNorm.length < 2 || !texto) return 0
  const objetivo = normalizarTexto(texto)
  let total = 0
  let desde = 0
  let pos = objetivo.indexOf(agujaNorm)
  while (pos >= 0) {
    total++
    desde = pos + agujaNorm.length
    pos = objetivo.indexOf(agujaNorm, desde)
  }
  return total
}

function filtrarBloquesCoincidentes(cuerpo: string, agujaNorm: string): string {
  if (agujaNorm.length < 2) return cuerpo
  const lineas = cuerpo.split('\n')
  const resultado: string[] = []
  let encabezadoPendiente: string | null = null
  let bloqueActual: string[] = []
  let enCodigo = false

  const vaciarBloque = () => {
    if (bloqueActual.length === 0) return
    const textoBloque = bloqueActual.join('\n')
    if (normalizarTexto(textoBloque).includes(agujaNorm)) {
      if (encabezadoPendiente !== null) {
        resultado.push(encabezadoPendiente)
        encabezadoPendiente = null
      }
      resultado.push(textoBloque)
    }
    bloqueActual = []
  }

  for (const linea of lineas) {
    const recorte = linea.trim()
    if (recorte.startsWith('```') || recorte.startsWith('~~~')) {
      enCodigo = !enCodigo
      bloqueActual.push(linea)
      continue
    }
    if (enCodigo) {
      bloqueActual.push(linea)
      continue
    }
    if (recorte === '') {
      vaciarBloque()
      continue
    }
    if (/^#{1,3}\s+/.test(recorte)) {
      vaciarBloque()
      if (normalizarTexto(recorte).includes(agujaNorm)) {
        resultado.push(linea)
        encabezadoPendiente = null
      } else {
        encabezadoPendiente = linea
      }
      continue
    }
    bloqueActual.push(linea)
  }

  vaciarBloque()
  return resultado.join('\n\n')
}

function resaltarTextoConMark(texto: string, agujaNorm: string): ReactNode {
  if (agujaNorm.length < 2 || !texto) return texto
  const objetivo = normalizarTexto(texto)
  if (objetivo.length !== texto.length) {
    return texto
  }

  const partes: ReactNode[] = []
  let desde = 0
  let pos = objetivo.indexOf(agujaNorm)

  while (pos >= 0) {
    if (pos > desde) partes.push(texto.slice(desde, pos))
    partes.push(
      <mark key={`${pos}-${desde}`} className="visor__mark">
        {texto.slice(pos, pos + agujaNorm.length)}
      </mark>
    )
    desde = pos + agujaNorm.length
    pos = objetivo.indexOf(agujaNorm, desde)
  }

  if (partes.length === 0) return texto
  if (desde < texto.length) partes.push(texto.slice(desde))
  return partes
}

function resaltarNodos(nodo: ReactNode, agujaNorm: string): ReactNode {
  if (agujaNorm.length < 2) return nodo
  if (typeof nodo === 'string') return resaltarTextoConMark(nodo, agujaNorm)
  if (Array.isArray(nodo)) {
    return Children.map(nodo, (hijo) => resaltarNodos(hijo, agujaNorm))
  }
  if (isValidElement<{ children?: ReactNode }>(nodo)) {
    if (nodo.type === 'code' || nodo.type === 'pre' || nodo.type === BloqueCodigo) {
      return nodo
    }
    if (nodo.props.children) {
      return cloneElement(nodo, undefined, resaltarNodos(nodo.props.children, agujaNorm))
    }
  }
  return nodo
}

export default function VisorDocumento({
  contenido,
  ruta,
  onAmpliar,
  consultaInicial
}: PropsVisor) {
  const [metadatosAbiertos, setMetadatosAbiertos] = useState(false)
  const [indiceAbierto, setIndiceAbierto] = useState(false)
  const [escalaTexto, setEscalaTexto] = useState(1)
  const [filtroIndice, setFiltroIndice] = useState('')
  const [busquedaDoc, setBusquedaDoc] = useState(() =>
    consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : ''
  )
  const [soloCoincidentes, setSoloCoincidentes] = useState(false)
  const [anchoColumna, setAnchoColumna] = useState<AnchoColumna>(leerAnchoInicial)
  const [tipografia, setTipografia] = useState<TipografiaDoc>(leerTipografiaInicial)

  useEffect(() => {
    setFiltroIndice('')
  }, [ruta])

  useEffect(() => {
    if (consultaInicial && consultaInicial.trim()) {
      setBusquedaDoc(consultaInicial.trim())
    }
  }, [consultaInicial])

  const cambiarAnchoColumna = useCallback((siguiente: AnchoColumna) => {
    setAnchoColumna(siguiente)
    try {
      window.localStorage.setItem(CLAVE_ANCHO_DOC, siguiente)
    } catch {
      // Sin acceso a localStorage.
    }
  }, [])

  const cambiarTipografia = useCallback((siguiente: TipografiaDoc) => {
    setTipografia(siguiente)
    try {
      window.localStorage.setItem(CLAVE_FUENTE_DOC, siguiente)
    } catch {
      // Sin acceso a localStorage.
    }
  }, [])

  const { metadatos, cuerpo } = useMemo(() => partirDocumento(contenido), [contenido])
  const lectura = useMemo(() => analizarLectura(cuerpo), [cuerpo])

  const agujaDoc = useMemo(() => {
    const limpio = busquedaDoc.trim()
    return limpio.length >= 2 ? normalizarTexto(limpio) : ''
  }, [busquedaDoc])

  const totalCoincidencias = useMemo(
    () => contarCoincidencias(cuerpo, agujaDoc),
    [cuerpo, agujaDoc]
  )

  const cuerpoRenderizado = useMemo(() => {
    if (!agujaDoc || !soloCoincidentes) return cuerpo
    return filtrarBloquesCoincidentes(cuerpo, agujaDoc)
  }, [cuerpo, agujaDoc, soloCoincidentes])

  const indiceFiltrado = useMemo(() => {
    const aguja = normalizarTexto(filtroIndice.trim())
    if (!aguja) return lectura.indice
    return lectura.indice.filter((item) => normalizarTexto(item.titulo).includes(aguja))
  }, [lectura.indice, filtroIndice])

  const transformarUrl = useCallback((url: string) => resolverAsset(url, ruta), [ruta])

  // Se reinicia en cada render para que coincida 1:1 con `analizarLectura`.
  const slugsRender = new Map<string, number>()
  const hacerHeading = (Tag: 'h1' | 'h2' | 'h3') => {
    return ({ children }: { children?: ReactNode }) => {
      const id = crearSlugUnico(textoPlanoDeNodo(children), slugsRender)
      const tamanoPorTag = {
        h1: `calc(var(--text-2xl) * ${escalaTexto})`,
        h2: `calc(var(--text-xl) * ${escalaTexto})`,
        h3: `calc(var(--text-lg) * ${escalaTexto})`
      } as const
      return (
        <Tag id={id} style={escalaTexto === 1 ? undefined : { fontSize: tamanoPorTag[Tag] }}>
          {resaltarNodos(children, agujaDoc)}
        </Tag>
      )
    }
  }

  const componentes: Components = {
    h1: hacerHeading('h1'),
    h2: hacerHeading('h2'),
    h3: hacerHeading('h3'),

    p({ children }) {
      return <p>{resaltarNodos(children, agujaDoc)}</p>
    },

    li({ children }) {
      return <li>{resaltarNodos(children, agujaDoc)}</li>
    },

    blockquote({ children }) {
      return <blockquote>{resaltarNodos(children, agujaDoc)}</blockquote>
    },

    td({ children }) {
      return <td>{resaltarNodos(children, agujaDoc)}</td>
    },

    th({ children }) {
      return <th>{resaltarNodos(children, agujaDoc)}</th>
    },

    pre({ children, className }) {
      return <BloqueCodigo className={className}>{children}</BloqueCodigo>
    },

    // Las imágenes se leen como figuras: borde y pie con el texto alternativo.
    img({ src, alt }) {
      const url = typeof src === 'string' ? src : ''
      return (
        <figure>
          <img
            src={url}
            alt={alt ?? ''}
            loading="lazy"
            onClick={() => onAmpliar?.(url)}
          />
          {alt ? <figcaption className="dim">{alt}</figcaption> : null}
        </figure>
      )
    },

    // Un enlace no debe navegar la ventana de la aplicación.
    a({ href, children }) {
      const alPulsar = (evento: EventoRaton<HTMLAnchorElement>) => {
        evento.preventDefault()
        if (href?.startsWith('#')) {
          const destino =
            document.getElementById(href.slice(1)) ??
            (href.length > 1 ? document.getElementById(`doc-${href.slice(1)}`) : null)
          destino?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        if (href && /^https?:/i.test(href)) void window.api.app.openExternal(href)
      }
      return (
        <a href={href} onClick={alPulsar} title={href}>
          {resaltarNodos(children, agujaDoc)}
        </a>
      )
    }
  }

  return (
    <div
      className="visor__doc"
      style={{
        fontSize: `calc(var(--text-md) * ${escalaTexto})`,
        maxWidth: ANCHOS_COLUMNA[anchoColumna].valor,
        fontFamily: TIPOGRAFIAS_DOC[tipografia].valor
      }}
    >
      <div className="visor__lectura-controles">
        <div className="search" style={{ minWidth: 180, flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={13} strokeWidth={ICONO_TRAZO} className="search__icon" />
          <input
            type="search"
            className="input input--search"
            value={busquedaDoc}
            onChange={(evento) => setBusquedaDoc(evento.target.value)}
            placeholder="Buscar en el documento…"
            aria-label="Buscar en el documento"
          />
        </div>

        {agujaDoc && (
          <>
            <span className="badge mono">
              {totalCoincidencias} {totalCoincidencias === 1 ? 'coincidencia' : 'coincidencias'}
            </span>
            <button
              type="button"
              className={`chip${soloCoincidentes ? ' chip--active' : ''}`}
              onClick={() => setSoloCoincidentes((valor) => !valor)}
            >
              Solo bloques coincidentes
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setBusquedaDoc('')
                setSoloCoincidentes(false)
              }}
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
            >
              <X size={13} strokeWidth={ICONO_TRAZO} />
              Limpiar
            </button>
          </>
        )}

        <span className="spacer" />

        <div className="row" style={{ gap: 2 }} role="group" aria-label="Ancho de columna">
          {(['normal', 'ancho', 'completo'] as const).map((clave) => (
            <button
              key={clave}
              type="button"
              className={`chip${anchoColumna === clave ? ' chip--active' : ''}`}
              onClick={() => cambiarAnchoColumna(clave)}
              title={`Ancho ${ANCHOS_COLUMNA[clave].etiqueta.toLowerCase()}`}
            >
              {ANCHOS_COLUMNA[clave].etiqueta}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 2 }} role="group" aria-label="Tipografía de lectura">
          {(['sans', 'serif', 'mono'] as const).map((clave) => (
            <button
              key={clave}
              type="button"
              className={`chip${tipografia === clave ? ' chip--active' : ''}`}
              onClick={() => cambiarTipografia(clave)}
              title={`Tipografía ${TIPOGRAFIAS_DOC[clave].etiqueta}`}
            >
              {TIPOGRAFIAS_DOC[clave].etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="visor__meta-lectura">
        {metadatos.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMetadatosAbiertos((valor) => !valor)}
            aria-expanded={metadatosAbiertos}
          >
            {metadatosAbiertos
              ? <ChevronDown size={14} strokeWidth={ICONO_TRAZO} />
              : <ChevronRight size={14} strokeWidth={ICONO_TRAZO} />}
            {metadatosAbiertos ? 'Ocultar metadatos' : 'Ver metadatos'}
          </button>
        )}

        {lectura.indice.length >= 2 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setIndiceAbierto((valor) => !valor)}
            aria-expanded={indiceAbierto}
          >
            <ListTree size={14} strokeWidth={ICONO_TRAZO} />
            Índice ({lectura.indice.length})
          </button>
        )}

        <div className="row" style={{ gap: 2 }} role="group" aria-label="Tamaño tipográfico">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setEscalaTexto((valor) =>
                Math.round(Math.max(ESCALA_MIN, valor - ESCALA_PASO) * 100) / 100
              )
            }
            disabled={escalaTexto <= ESCALA_MIN}
            title="Reducir tamaño de texto"
            aria-label="Reducir tamaño de texto"
            style={{ padding: '0 6px' }}
          >
            A-
          </button>
          <span className="mono dim" style={{ minWidth: 34, textAlign: 'center' }}>
            {Math.round(escalaTexto * 100)}%
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setEscalaTexto((valor) =>
                Math.round(Math.min(ESCALA_MAX, valor + ESCALA_PASO) * 100) / 100
              )
            }
            disabled={escalaTexto >= ESCALA_MAX}
            title="Aumentar tamaño de texto"
            aria-label="Aumentar tamaño de texto"
            style={{ padding: '0 6px' }}
          >
            A+
          </button>
        </div>

        <span className="spacer" />
        <span className="mono">{lectura.palabras.toLocaleString('es-AR')} palabras</span>
        <span>·</span>
        <span>~{lectura.minutosLectura} min de lectura</span>
      </div>

      {metadatosAbiertos && metadatos.length > 0 && (
        <pre className="mono">
          {metadatos
            .map((linea) => linea.replace(/^>\s?/, '').replace(/^-{3}$/, '').trimEnd())
            .filter((linea) => linea.length > 0)
            .join('\n')}
        </pre>
      )}

      {indiceAbierto && lectura.indice.length >= 2 && (
        <nav className="visor__toc" aria-label="Índice del documento">
          {lectura.indice.length > 5 && (
            <div className="search" style={{ marginBottom: 4 }}>
              <Search size={12} strokeWidth={ICONO_TRAZO} className="search__icon" />
              <input
                type="search"
                className="input input--search"
                style={{ height: 26, fontSize: 'var(--text-xs)' }}
                value={filtroIndice}
                onChange={(evento) => setFiltroIndice(evento.target.value)}
                placeholder="Filtrar encabezados…"
                aria-label="Filtrar encabezados"
              />
            </div>
          )}

          {indiceFiltrado.length > 0 ? (
            indiceFiltrado.map((item) => (
              <button
                key={item.id}
                type="button"
                className="visor__toc-item"
                style={{ paddingLeft: `${8 + (item.nivel - 1) * 14}px` }}
                onClick={() => {
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                {item.titulo}
              </button>
            ))
          ) : (
            <span className="dim" style={{ padding: '4px 6px', fontSize: 'var(--text-xs)' }}>
              Sin encabezados que coincidan
            </span>
          )}
        </nav>
      )}

      {agujaDoc && soloCoincidentes && !cuerpoRenderizado.trim() ? (
        <div className="empty">
          <div className="empty__title">Sin bloques coincidentes</div>
          <div className="empty__text">
            Ningún párrafo o sección coincide con «{busquedaDoc}».
          </div>
        </div>
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          urlTransform={transformarUrl}
          components={componentes}
        >
          {cuerpoRenderizado}
        </ReactMarkdown>
      )}
    </div>
  )
}
