// ============================================================
// Archivo — La carpeta de salida se entiende sola.
// Al entrar se detectan las colecciones (carpetas con post.md,
// thread.md o index.md) y se muestran como tarjetas. Dentro de
// una colección: documento, galería y árbol de archivos.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  ExternalLink,
  File,
  FileAudio,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert
} from 'lucide-react'
import ePub, { Rendition, Location } from 'epubjs'// @ts-ignore - Resaltado de sintaxis para las vistas de código
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// @ts-ignore - Tema oscuro de VSCode para un aspecto profesional
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useDownloadStore } from '../stores/downloadStore'
import { useUiStore } from '../stores/uiStore'
import type { ArchiveFileEntry } from '../../shared/api'
import MediaLightbox from './message/MediaLightbox'
import Colecciones, {
  EXT_IMAGEN,
  detectarColecciones,
  etiquetaCanal,
  formatearBytes,
  normalizar,
  textoFecha
} from './archive/Colecciones'
import type { Coleccion } from './archive/Colecciones'
import Galeria from './archive/Galeria'
import VisorDocumento from './archive/VisorDocumento'

const ICONO_TRAZO = 1.8

const EXT_VIDEO = ['mp4', 'webm', 'mov', 'mkv', 'm4v']
const EXT_AUDIO = ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'opus']
const EXT_TEXTO = ['md', 'txt', 'json', 'css', 'log', 'xml', 'csv', 'js', 'ts', 'yml', 'yaml', 'sql']
const EXT_BINARIO = ['zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'iso', 'exe', 'dmg', 'apk']

const LENGUAJE_POR_EXT: Record<string, string> = {
  md: 'markdown',
  html: 'markup',
  css: 'css',
  json: 'json',
  js: 'javascript',
  ts: 'typescript',
  xml: 'markup',
  log: 'bash',
  txt: 'text',
  csv: 'csv',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml'
}

const ESTILO_CODIGO: CSSProperties = {
  margin: 0,
  padding: '16px 20px',
  background: 'transparent',
  fontSize: 'var(--text-md)',
  lineHeight: 1.6,
  fontFamily: 'var(--font-mono)'
}

const TEMAS_EPUB: Record<'light' | 'sepia' | 'dark', { etiqueta: string; body: { background: string; color: string } }> = {
  light: { etiqueta: 'Claro', body: { background: '#ffffff', color: '#1a1a1a' } },
  sepia: { etiqueta: 'Sepia', body: { background: '#f4ecd8', color: '#5b4636' } },
  dark: { etiqueta: 'Oscuro', body: { background: '#12151b', color: '#e8e9ec' } }
}

type Pestana = 'documento' | 'galeria' | 'archivos'
type TipoAmpliado = 'imagen' | 'video'

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : ''
}

/** Filtra el árbol por nombre, conservando las carpetas con coincidencias. */
function filtrarArbol(entradas: ArchiveFileEntry[], consulta: string): ArchiveFileEntry[] {
  if (!consulta) return entradas
  const aguja = normalizar(consulta)

  return entradas.reduce<ArchiveFileEntry[]>((salida, entrada) => {
    if (normalizar(entrada.name).includes(aguja)) {
      salida.push(entrada)
      return salida
    }
    if (entrada.type === 'dir') {
      const hijos = filtrarArbol(entrada.children ?? [], consulta)
      if (hijos.length > 0) salida.push({ ...entrada, children: hijos })
    }
    return salida
  }, [])
}

/** Envuelve en `<mark>` cada coincidencia del nombre, sin distinguir acentos. */
function resaltar(nombre: string, consulta: string): ReactNode {
  const aguja = normalizar(consulta)
  if (!aguja) return nombre

  const objetivo = normalizar(nombre)
  const partes: ReactNode[] = []
  let desde = 0
  let posicion = objetivo.indexOf(aguja)

  while (posicion >= 0) {
    if (posicion > desde) partes.push(nombre.slice(desde, posicion))
    partes.push(<mark key={`${posicion}-${nombre}`}>{nombre.slice(posicion, posicion + aguja.length)}</mark>)
    desde = posicion + aguja.length
    posicion = objetivo.indexOf(aguja, desde)
  }

  if (partes.length === 0) return nombre
  if (desde < nombre.length) partes.push(nombre.slice(desde))
  return partes
}

/** La navegación entre vistas la resuelve el armazón (App) escuchando este evento. */
function irA(vista: 'ajustes' | 'explorar'): void {
  window.dispatchEvent(new CustomEvent('dap:navigate', { detail: vista }))
}

interface ArchivoAbierto {
  path: string
  name: string
  tipo: string
  contenido: string
  truncado: boolean
  bytes: number
  error?: boolean
}

interface Documento {
  contenido: string
  ruta: string
  truncado: boolean
}

export default function ArchiveViewer() {
  const outputDir = useDownloadStore((estado) => estado.outputDir)
  const pickDirectory = useDownloadStore((estado) => estado.pickDirectory)
  const openOutputFolder = useDownloadStore((estado) => estado.openOutputFolder)
  const archivoPedido = useUiStore((estado) => estado.archivoInicial)
  const consumirArchivoInicial = useUiStore((estado) => estado.consumirArchivoInicial)

  const [arbol, setArbol] = useState<ArchiveFileEntry[]>([])
  const [colecciones, setColecciones] = useState<Coleccion[]>([])
  const [cargando, setCargando] = useState(true)
  const [rutaActiva, setRutaActiva] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('documento')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaArbol, setBusquedaArbol] = useState('')
  const [documento, setDocumento] = useState<Documento | null>(null)
  const [leyendoDoc, setLeyendoDoc] = useState(false)
  const [archivo, setArchivo] = useState<ArchivoAbierto | null>(null)
  const [leyendoArchivo, setLeyendoArchivo] = useState(false)
  const [ampliado, setAmpliado] = useState<{ url: string; tipo: TipoAmpliado } | null>(null)
  const [anchoArbol, setAnchoArbol] = useState(268)
  const [rutaCopiada, setRutaCopiada] = useState(false)

  const arrastreRef = useRef<AbortController | null>(null)
  const completadasRef = useRef(0)
  const copiaRef = useRef<number | null>(null)

  const coleccion = useMemo(
    () => colecciones.find((item) => item.ruta === rutaActiva) ?? null,
    [colecciones, rutaActiva]
  )

  const coleccionesFiltradas = useMemo(() => {
    if (!busqueda.trim()) return colecciones
    const aguja = normalizar(busqueda)
    return colecciones.filter((item) =>
      normalizar(`${item.titulo} ${item.canal} ${item.servidor}`).includes(aguja)
    )
  }, [colecciones, busqueda])

  const totalBytes = useMemo(
    () => colecciones.reduce((suma, item) => suma + item.bytes, 0),
    [colecciones]
  )

  // Aborta el arrastre del divisor si el componente se desmonta a mitad de gesto.
  useEffect(() => () => arrastreRef.current?.abort(), [])

  // Limpia el aviso de «Copiada» si la vista se cierra antes de tiempo.
  useEffect(() => () => {
    if (copiaRef.current !== null) window.clearTimeout(copiaRef.current)
  }, [])

  const onDivisorAbajo = useCallback((evento: ReactMouseEvent<HTMLDivElement>) => {
    evento.preventDefault()
    arrastreRef.current?.abort()
    const controlador = new AbortController()
    arrastreRef.current = controlador
    const { signal } = controlador
    const inicioX = evento.clientX
    const inicioAncho = anchoArbol

    window.addEventListener('mousemove', (movimiento) => {
      setAnchoArbol(Math.max(180, Math.min(460, inicioAncho + movimiento.clientX - inicioX)))
    }, { signal })
    window.addEventListener('mouseup', () => controlador.abort(), { signal })
  }, [anchoArbol])

  const cargar = useCallback(async () => {
    if (!outputDir) {
      setArbol([])
      setColecciones([])
      setCargando(false)
      return
    }

    setCargando(true)
    try {
      const entradas = await window.api.archive.scanDirectory(outputDir)
      const lista = entradas ?? []
      setArbol(lista)
      setColecciones(detectarColecciones(lista, outputDir))
    } catch (error) {
      console.error('No se pudo leer el archivo:', error)
      setArbol([])
      setColecciones([])
    } finally {
      setCargando(false)
    }
  }, [outputDir])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Refresca al terminar una descarga, agrupando ráfagas.
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const desuscribir = window.api.download.onQueueUpdated((cola) => {
      const terminadas = cola.filter((tarea) => tarea.status === 'done').length
      if (terminadas <= completadasRef.current) return
      completadasRef.current = terminadas
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(() => { void cargar() }, 800)
    })

    return () => {
      desuscribir()
      if (temporizador) clearTimeout(temporizador)
    }
  }, [cargar])

  // Documento principal de la colección abierta: se lee solo al abrirla.
  useEffect(() => {
    const principal = coleccion?.principal
    setDocumento(null)
    setArchivo(null)
    if (!principal) return

    let vigente = true
    setLeyendoDoc(true)

    window.api.archive.readFile(principal.path)
      .then((resultado) => {
        if (!vigente) return
        setDocumento({ contenido: resultado.content, ruta: principal.path, truncado: resultado.truncated })
      })
      .catch(() => {
        if (vigente) setDocumento({ contenido: '', ruta: principal.path, truncado: false })
      })
      .finally(() => {
        if (vigente) setLeyendoDoc(false)
      })

    return () => { vigente = false }
  }, [coleccion?.ruta, coleccion?.principal])

  const abrirArchivo = useCallback(async (entrada: ArchiveFileEntry) => {
    if (entrada.type === 'dir') return
    const ext = extensionDe(entrada.name)

    if (!EXT_TEXTO.includes(ext)) {
      setArchivo({
        path: entrada.path,
        name: entrada.name,
        tipo: ext,
        contenido: '',
        truncado: false,
        bytes: entrada.size ?? 0
      })
      return
    }

    setLeyendoArchivo(true)
    try {
      const resultado = await window.api.archive.readFile(entrada.path)
      setArchivo({
        path: entrada.path,
        name: entrada.name,
        tipo: ext,
        contenido: resultado.content,
        truncado: resultado.truncated,
        bytes: resultado.size
      })
    } catch {
      setArchivo({
        path: entrada.path,
        name: entrada.name,
        tipo: ext,
        contenido: '',
        truncado: false,
        bytes: entrada.size ?? 0,
        error: true
      })
    } finally {
      setLeyendoArchivo(false)
    }
  }, [])

  // Al entrar en «Archivos» se abre el documento principal: el panel nunca arranca vacío.
  useEffect(() => {
    if (pestana !== 'archivos' || archivo || leyendoArchivo) return
    if (!coleccion?.principal) return
    void abrirArchivo(coleccion.principal)
  }, [pestana, archivo, leyendoArchivo, coleccion, abrirArchivo])

  const abrirColeccion = useCallback((item: Coleccion) => {
    setRutaActiva(item.ruta)
    setPestana('documento')
    setBusquedaArbol('')
    // Se limpia antes de leer: evita mostrar el documento de la colección anterior.
    setDocumento(null)
    setArchivo(null)
    setLeyendoDoc(Boolean(item.principal))
  }, [])

  const volver = useCallback(() => {
    setRutaActiva(null)
    setDocumento(null)
    setArchivo(null)
    setBusquedaArbol('')
  }, [])

  // La búsqueda global puede pedir un archivo concreto: se abre la colección
  // que lo contiene y se deja el documento listo, sin salir de la app.
  useEffect(() => {
    if (!archivoPedido || colecciones.length === 0) return
    const objetivo = archivoPedido.replace(/\\/g, '/').toLowerCase()
    const item = colecciones.find((c) =>
      objetivo.startsWith(c.ruta.replace(/\\/g, '/').toLowerCase())
    )
    if (item) abrirColeccion(item)
    consumirArchivoInicial()
  }, [archivoPedido, colecciones, abrirColeccion, consumirArchivoInicial])

  const copiarRuta = useCallback(async () => {
    if (!coleccion) return
    try {
      await navigator.clipboard.writeText(coleccion.ruta)
      setRutaCopiada(true)
      if (copiaRef.current !== null) window.clearTimeout(copiaRef.current)
      copiaRef.current = window.setTimeout(() => setRutaCopiada(false), 1600)
    } catch {
      // Sin permiso de portapapeles: no hay nada que avisar.
    }
  }, [coleccion])

  const ampliar = useCallback((url: string, tipo: TipoAmpliado) => {
    setAmpliado({ url, tipo })
  }, [])

  // ---------- Estado sin carpeta de salida ----------
  if (!outputDir) {
    return (
      <>
        <header className="workspace__header">
          <div className="workspace__titles">
            <h1 className="workspace__title">Archivo</h1>
            <div className="workspace__subtitle">Sin carpeta de salida</div>
          </div>
        </header>

        <div className="workspace__body">
          <div className="view-pad">
            <div className="empty">
              <div className="empty__icon">
                <FolderPlus size={20} strokeWidth={ICONO_TRAZO} />
              </div>
              <div className="empty__title">Elige dónde vive tu archivo</div>
              <div className="empty__text">
                Estrato guarda cada publicación descargada en una carpeta con su markdown, sus
                imágenes y sus respuestas. Indica una carpeta y aquí aparecerán todas las
                colecciones detectadas, sin abrir nada por tu cuenta.
              </div>
              <div className="row">
                <button className="btn btn--primary btn--sm" onClick={() => void pickDirectory()}>
                  <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
                  Elegir carpeta
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => irA('ajustes')}>
                  <Settings2 size={14} strokeWidth={ICONO_TRAZO} />
                  Ir a Ajustes
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ---------- Colección abierta ----------
  if (coleccion) {
    const canal = etiquetaCanal(coleccion.canal)
    const hijos = coleccion.nodo.children ?? []
    const arbolVisible = filtrarArbol(hijos, busquedaArbol)

    return (
      <>
        <header className="workspace__header">
          <div className="workspace__titles">
            <div className="visor__migas">
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={volver}
                title="Volver a las colecciones"
                aria-label="Volver a las colecciones"
              >
                <ChevronLeft size={16} strokeWidth={ICONO_TRAZO} />
              </button>
              <span className="dim">Archivo</span>
              <span className="dim">/</span>
              {coleccion.servidor && (
                <>
                  <span className="muted truncate">{coleccion.servidor}</span>
                  <span className="dim">/</span>
                </>
              )}
              <span className="truncate">{canal || 'Sin canal'}</span>
            </div>

            <h1 className="workspace__title">{coleccion.titulo}</h1>
            <div className="workspace__subtitle">
              {textoFecha(coleccion.fecha)} · {coleccion.mensajes} mensajes ·{' '}
              {coleccion.imagenes.length} imágenes · {formatearBytes(coleccion.bytes)}
            </div>
          </div>

          <div className="workspace__actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void window.api.settings.openFolder(coleccion.ruta)}
              title="Abrir la carpeta en el sistema"
            >
              <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
              Abrir carpeta
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => irA('explorar')}
              title="Volver a descargar esta publicación"
            >
              <RefreshCw size={14} strokeWidth={ICONO_TRAZO} />
              Exportar de nuevo
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => void copiarRuta()} title={coleccion.ruta}>
              {rutaCopiada
                ? <Check size={14} strokeWidth={ICONO_TRAZO} />
                : <Copy size={14} strokeWidth={ICONO_TRAZO} />}
              {rutaCopiada ? 'Ruta copiada' : 'Copiar ruta'}
            </button>
          </div>
        </header>

        <div className="workspace__body workspace__body--flush">
          <div className="visor">
            <div className="visor__barra">
              <button
                className={`btn btn--sm${pestana === 'documento' ? '' : ' btn--ghost'}`}
                onClick={() => setPestana('documento')}
              >
                Documento
              </button>
              <button
                className={`btn btn--sm${pestana === 'galeria' ? '' : ' btn--ghost'}`}
                onClick={() => setPestana('galeria')}
              >
                Galería
                <span className="dim mono">{coleccion.imagenes.length}</span>
              </button>
              <button
                className={`btn btn--sm${pestana === 'archivos' ? '' : ' btn--ghost'}`}
                onClick={() => setPestana('archivos')}
              >
                Archivos
                <span className="dim mono">{hijos.length}</span>
              </button>

              <span className="spacer" />

              {documento?.truncado && pestana === 'documento' && (
                <span className="badge badge--warn" title="Vista parcial del documento">
                  <TriangleAlert size={11} strokeWidth={2} />
                  Truncado
                </span>
              )}
            </div>

            {pestana === 'documento' && (
              leyendoDoc ? (
                <div className="split__body">
                  <div className="col">
                    <div className="skeleton skeleton--row" />
                    <div className="skeleton skeleton--row" />
                    <div className="skeleton skeleton--row" />
                  </div>
                </div>
              ) : documento && documento.contenido ? (
                <VisorDocumento
                  contenido={documento.contenido}
                  ruta={documento.ruta}
                  onAmpliar={(url) => ampliar(url, 'imagen')}
                />
              ) : (
                <div className="empty">
                  <div className="empty__icon">
                    <FileText size={20} strokeWidth={ICONO_TRAZO} />
                  </div>
                  <div className="empty__title">Esta colección no tiene documento</div>
                  <div className="empty__text">
                    No se encontró post.md, thread.md ni index.md dentro de la carpeta. Revisa la
                    pestaña Archivos para ver qué se descargó.
                  </div>
                  <button className="btn btn--sm" onClick={() => setPestana('archivos')}>
                    <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
                    Ver archivos
                  </button>
                </div>
              )
            )}

            {pestana === 'galeria' && (
              coleccion.imagenes.length > 0 ? (
                <Galeria
                  imagenes={coleccion.imagenes}
                  onAbrir={(indice) => {
                    const imagen = coleccion.imagenes[indice]
                    if (imagen) ampliar(window.api.archive.toUrl(imagen.path), 'imagen')
                  }}
                />
              ) : (
                <div className="empty">
                  <div className="empty__icon">
                    <FileImage size={20} strokeWidth={ICONO_TRAZO} />
                  </div>
                  <div className="empty__title">Sin imágenes</div>
                  <div className="empty__text">
                    Esta publicación no descargó archivos de imagen. Puedes repetir la descarga
                    incluyendo imágenes desde Explorar.
                  </div>
                </div>
              )
            )}

            {pestana === 'archivos' && (
              <div className="split">
                <aside className="split__side" style={{ width: anchoArbol }}>
                  <div className="split__head">
                    <div className="search spacer">
                      <Search size={14} strokeWidth={ICONO_TRAZO} className="search__icon" />
                      <input
                        className="input input--search"
                        type="search"
                        placeholder="Filtrar archivos"
                        value={busquedaArbol}
                        onChange={(evento) => setBusquedaArbol(evento.target.value)}
                      />
                    </div>
                  </div>

                  {arbolVisible.length > 0 ? (
                    <div className="arbol">
                      <Arbol
                        entradas={arbolVisible}
                        activo={archivo?.path ?? null}
                        consulta={busquedaArbol}
                        onAbrir={(entrada) => void abrirArchivo(entrada)}
                      />
                    </div>
                  ) : (
                    <div className="empty">
                      <Search size={16} strokeWidth={ICONO_TRAZO} className="dim" />
                      <span className="muted">Sin coincidencias</span>
                    </div>
                  )}
                </aside>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={onDivisorAbajo}
                  style={{ width: 5, cursor: 'col-resize', background: 'var(--line-soft)', flexShrink: 0 }}
                />

                <section className="split__main">
                  <div className="split__head">
                    {archivo
                      ? <IconoDeArchivo nombre={archivo.name} />
                      : <Archive size={15} strokeWidth={ICONO_TRAZO} className="dim" />}
                    <span className="truncate">{archivo?.name ?? 'Sin archivo seleccionado'}</span>
                    <span className="spacer" />
                    {archivo && (
                      <button
                        className="btn btn--ghost btn--icon btn--sm"
                        onClick={() => void window.api.settings.revealFolder(archivo.path)}
                        title="Mostrar en el sistema"
                      >
                        <ExternalLink size={15} strokeWidth={ICONO_TRAZO} />
                      </button>
                    )}
                  </div>

                  {leyendoArchivo ? (
                    <div className="split__body">
                      <div className="col">
                        <div className="skeleton skeleton--row" />
                        <div className="skeleton skeleton--row" />
                        <div className="skeleton skeleton--row" />
                      </div>
                    </div>
                  ) : archivo ? (
                    <VistaPrevia archivo={archivo} onAmpliar={ampliar} />
                  ) : (
                    <div className="empty">
                      <div className="empty__icon">
                        <FileText size={20} strokeWidth={ICONO_TRAZO} />
                      </div>
                      <div className="empty__title">Elige un archivo</div>
                      <div className="empty__text">
                        El árbol muestra solo esta colección: su documento, las respuestas y los
                        recursos descargados.
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>

        {ampliado && (
          <MediaLightbox
            url={ampliado.url}
            tipo={ampliado.tipo}
            onClose={() => setAmpliado(null)}
          />
        )}
      </>
    )
  }

  // ---------- Listado de colecciones ----------
  const subtitulo = cargando
    ? 'Leyendo la carpeta de salida'
    : `${colecciones.length} ${colecciones.length === 1 ? 'colección' : 'colecciones'} · ${formatearBytes(totalBytes)}`

  return (
    <>
      <header className="workspace__header">
        <div className="workspace__titles">
          <h1 className="workspace__title">Archivo</h1>
          <div className="workspace__subtitle">{subtitulo}</div>
        </div>

        <div className="workspace__actions">
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => void cargar()}
            title="Volver a detectar colecciones"
            disabled={cargando}
          >
            <RefreshCw size={16} strokeWidth={ICONO_TRAZO} />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={openOutputFolder}
            title="Abrir la carpeta en el sistema"
          >
            <FolderOpen size={16} strokeWidth={ICONO_TRAZO} />
          </button>
        </div>
      </header>

      <div className="workspace__body workspace__body--flush">
        <div className="visor">
          {cargando ? (
            <div className="colecciones">
              {[0, 1, 2, 3, 4, 5].map((fila) => (
                <div key={fila} className="skeleton skeleton--card" />
              ))}
            </div>
          ) : colecciones.length === 0 ? (
            arbol.length === 0 ? (
              <div className="empty">
                <div className="empty__icon">
                  <Archive size={20} strokeWidth={ICONO_TRAZO} />
                </div>
                <div className="empty__title">La carpeta está vacía</div>
                <div className="empty__text">
                  Cada descarga crea una carpeta con post.md, thread.md, replies/ y assets/. Abre
                  Explorar, elige un canal y descarga su primera publicación: aparecerá aquí como
                  una colección con portada, documento y galería.
                </div>
                <div className="row">
                  <button className="btn btn--primary btn--sm" onClick={() => irA('explorar')}>
                    <Globe size={14} strokeWidth={ICONO_TRAZO} />
                    Explorar canales
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => void cargar()}>
                    <RefreshCw size={14} strokeWidth={ICONO_TRAZO} />
                    Refrescar
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty">
                <div className="empty__icon">
                  <Folder size={20} strokeWidth={ICONO_TRAZO} />
                </div>
                <div className="empty__title">No se detectaron colecciones</div>
                <div className="empty__text">
                  Hay archivos en la carpeta, pero ninguna carpeta contiene post.md, thread.md ni
                  index.md. Estrato reconoce una colección por esos documentos: si acabas de mover
                  archivos a mano, refresca la detección.
                </div>
                <button className="btn btn--sm" onClick={() => void cargar()}>
                  <RefreshCw size={14} strokeWidth={ICONO_TRAZO} />
                  Refrescar
                </button>
              </div>
            )
          ) : (
            <>
              <div className="visor__barra">
                <div className="search spacer">
                  <Search size={14} strokeWidth={ICONO_TRAZO} className="search__icon" />
                  <input
                    className="input input--search"
                    type="search"
                    placeholder="Buscar por título, canal o servidor"
                    value={busqueda}
                    onChange={(evento) => setBusqueda(evento.target.value)}
                  />
                </div>
                {busqueda.trim() && (
                  <span className="muted mono">
                    {coleccionesFiltradas.length} de {colecciones.length}
                  </span>
                )}
              </div>

              {coleccionesFiltradas.length > 0 ? (
                <Colecciones colecciones={coleccionesFiltradas} onAbrir={abrirColeccion} />
              ) : (
                <div className="empty">
                  <Search size={16} strokeWidth={ICONO_TRAZO} className="dim" />
                  <div className="empty__title">Sin coincidencias</div>
                  <div className="empty__text">
                    Ninguna colección coincide con «{busqueda}». Prueba con el nombre del canal o
                    del servidor.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** Icono por extensión: monocromo para no competir con el contenido. */
function IconoDeArchivo({ nombre }: { nombre: string }) {
  const ext = extensionDe(nombre)
  const props = { size: 15, strokeWidth: ICONO_TRAZO, className: 'dim' } as const

  if (EXT_IMAGEN.includes(ext)) return <FileImage {...props} />
  if (EXT_VIDEO.includes(ext)) return <FileVideo {...props} />
  if (EXT_AUDIO.includes(ext)) return <FileAudio {...props} />
  if (ext === 'json') return <FileJson {...props} />
  if (ext === 'html' || ext === 'htm') return <Globe {...props} />
  if (ext === 'pdf' || ext === 'epub') return <BookOpen {...props} />
  if (EXT_TEXTO.includes(ext)) return <FileText {...props} />
  return <File {...props} />
}

interface PropsArbol {
  entradas: ArchiveFileEntry[]
  activo: string | null
  consulta: string
  onAbrir: (entrada: ArchiveFileEntry) => void
  profundidad?: number
}

function Arbol({ entradas, activo, consulta, onAbrir, profundidad = 0 }: PropsArbol) {
  return (
    <>
      {entradas.map((entrada) => (
        <Rama
          key={entrada.path}
          entrada={entrada}
          activo={activo}
          consulta={consulta}
          onAbrir={onAbrir}
          profundidad={profundidad}
        />
      ))}
    </>
  )
}

interface PropsRama {
  entrada: ArchiveFileEntry
  activo: string | null
  consulta: string
  onAbrir: (entrada: ArchiveFileEntry) => void
  profundidad: number
}

function Rama({ entrada, activo, consulta, onAbrir, profundidad }: PropsRama) {
  const [abierta, setAbierta] = useState(profundidad === 0)
  const esCarpeta = entrada.type === 'dir'
  const hijos = entrada.children ?? []
  // Con una búsqueda activa las carpetas se abren solas para mostrar la coincidencia.
  const desplegada = consulta.trim() ? true : abierta

  const alPulsar = () => {
    if (esCarpeta) setAbierta((valor) => !valor)
    else onAbrir(entrada)
  }

  return (
    <>
      <div
        className={`arbol__fila${activo === entrada.path ? ' arbol__fila--activo' : ''}`}
        style={{ paddingLeft: 10 + profundidad * 14 }}
        onClick={alPulsar}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter' || evento.key === ' ') {
            evento.preventDefault()
            alPulsar()
          }
        }}
        role="button"
        tabIndex={0}
        title={entrada.path}
      >
        {esCarpeta
          ? desplegada
            ? <FolderOpen size={15} strokeWidth={ICONO_TRAZO} className="muted" />
            : <Folder size={15} strokeWidth={ICONO_TRAZO} className="muted" />
          : <IconoDeArchivo nombre={entrada.name} />}

        <span className="truncate">{resaltar(entrada.name, consulta)}</span>
        <span className="spacer" />

        {esCarpeta
          ? hijos.length > 0 && <span className="mono dim">{hijos.length}</span>
          : !!entrada.size && <span className="mono dim">{formatearBytes(entrada.size)}</span>}
      </div>

      {esCarpeta && desplegada && hijos.length > 0 && (
        <Arbol
          entradas={hijos}
          activo={activo}
          consulta={consulta}
          onAbrir={onAbrir}
          profundidad={profundidad + 1}
        />
      )}
    </>
  )
}

interface PropsPrevia {
  archivo: ArchivoAbierto
  onAmpliar: (url: string, tipo: TipoAmpliado) => void
}

function VistaPrevia({ archivo, onAmpliar }: PropsPrevia) {
  const ext = archivo.tipo
  const url = window.api.archive.toUrl(archivo.path)

  if (archivo.error) {
    return (
      <div className="empty">
        <div className="empty__icon">
          <TriangleAlert size={20} strokeWidth={ICONO_TRAZO} />
        </div>
        <div className="empty__title">No se pudo leer el archivo</div>
        <div className="empty__text">
          El archivo existe en la carpeta pero no se pudo abrir. Puede estar en uso o sin permisos.
        </div>
        <button className="btn btn--sm" onClick={() => void window.api.settings.revealFolder(archivo.path)}>
          <ExternalLink size={14} strokeWidth={ICONO_TRAZO} />
          Mostrar en el sistema
        </button>
      </div>
    )
  }

  if (EXT_IMAGEN.includes(ext)) {
    return (
      <div className="split__body">
        <div className="empty">
          <img src={url} alt={archivo.name} onClick={() => onAmpliar(url, 'imagen')} />
        </div>
      </div>
    )
  }

  if (EXT_VIDEO.includes(ext)) {
    return (
      <div className="split__body">
        <div className="empty">
          <video src={url} controls playsInline />
          <button className="btn btn--ghost btn--sm" onClick={() => onAmpliar(url, 'video')}>
            <Expand size={14} strokeWidth={ICONO_TRAZO} />
            Ampliar
          </button>
        </div>
      </div>
    )
  }

  if (EXT_AUDIO.includes(ext)) {
    return (
      <div className="empty">
        <div className="empty__icon">
          <FileAudio size={20} strokeWidth={ICONO_TRAZO} />
        </div>
        <div className="empty__title truncate">{archivo.name}</div>
        <audio src={url} controls />
      </div>
    )
  }

  if (ext === 'epub') return <EpubViewer path={archivo.path} />

  if (ext === 'pdf') {
    return (
      <iframe
        className="workspace__body"
        src={`${url}#view=FitH&toolbar=1`}
        title={`PDF · ${archivo.name}`}
        frameBorder={0}
      />
    )
  }

  if (ext === 'html' || ext === 'htm') {
    // archive:// es la única vía para cargar archivos locales con webSecurity activo.
    // sandbox vacío: el HTML exportado funciona sin JS (el toggle de tema es CSS puro).
    return (
      <iframe
        className="workspace__body"
        src={url}
        title={`HTML · ${archivo.name}`}
        sandbox=""
        referrerPolicy="no-referrer"
        frameBorder={0}
      />
    )
  }

  if (ext === 'md') {
    return (
      <VisorDocumento
        contenido={archivo.contenido}
        ruta={archivo.path}
        onAmpliar={(imagen) => onAmpliar(imagen, 'imagen')}
      />
    )
  }

  if (ext === 'json') {
    return <VistaJson contenido={archivo.contenido} truncado={archivo.truncado} />
  }

  if (EXT_TEXTO.includes(ext)) {
    return <VistaCodigo contenido={archivo.contenido} lenguaje={LENGUAJE_POR_EXT[ext] ?? 'text'} />
  }

  return (
    <div className="empty">
      <div className="empty__icon">
        <File size={20} strokeWidth={ICONO_TRAZO} />
      </div>
      <div className="empty__title truncate">{archivo.name}</div>
      <div className="empty__text">
        {EXT_BINARIO.includes(ext)
          ? 'Este tipo de archivo no se puede previsualizar dentro de la aplicación.'
          : 'No hay un visor para esta extensión.'}
      </div>
      <button className="btn btn--sm" onClick={() => void window.api.settings.openFolder(archivo.path)}>
        <ExternalLink size={14} strokeWidth={ICONO_TRAZO} />
        Abrir con la aplicación del sistema
      </button>
    </div>
  )
}

/** Vista de código reutilizada por el visor JSON y por los archivos de texto. */
function VistaCodigo({ contenido, lenguaje }: { contenido: string; lenguaje: string }) {
  return (
    <div className="split__body">
      <SyntaxHighlighter
        language={lenguaje}
        style={vscDarkPlus}
        showLineNumbers
        customStyle={ESTILO_CODIGO}
      >
        {contenido}
      </SyntaxHighlighter>
    </div>
  )
}

function VistaJson({ contenido, truncado }: { contenido: string; truncado: boolean }) {
  // Si el archivo llegó truncado el JSON es inválido por definición: no se intenta parsear.
  const formateado = useMemo(() => {
    if (truncado) return contenido
    try {
      return JSON.stringify(JSON.parse(contenido), null, 2)
    } catch {
      return contenido
    }
  }, [contenido, truncado])

  return (
    <div className="split__body">
      <SyntaxHighlighter language="json" style={vscDarkPlus} customStyle={ESTILO_CODIGO}>
        {formateado}
      </SyntaxHighlighter>
    </div>
  )
}

function EpubViewer({ path }: { path: string }) {
  const visorRef = useRef<HTMLDivElement | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [titulo, setTitulo] = useState('')
  const [posicion, setPosicion] = useState('')
  const [tema, setTema] = useState<'light' | 'sepia' | 'dark'>('light')
  const [tamano, setTamano] = useState(100)

  const aplicarTema = useCallback((siguiente: 'light' | 'sepia' | 'dark') => {
    const rendition = renditionRef.current
    if (!rendition) return
    for (const nombre of ['light', 'sepia', 'dark'] as const) {
      rendition.themes.register(nombre, { body: TEMAS_EPUB[nombre].body })
    }
    rendition.themes.select(siguiente)
    setTema(siguiente)
  }, [])

  useEffect(() => {
    const host = visorRef.current
    if (!host) return

    const libro = ePub(window.api.archive.toUrl(path))
    void libro.loaded.metadata.then((meta) => setTitulo(meta.title || ''))

    const rendition = libro.renderTo(host, { width: '100%', height: '100%', flow: 'paginated' })
    renditionRef.current = rendition

    void rendition.display().then(() => aplicarTema('light'))

    rendition.on('relocated', (ubicacion: Location) => {
      const pagina = ubicacion.start?.displayed?.page
      const total = ubicacion.start?.displayed?.total
      if (pagina && total) setPosicion(`${pagina} / ${total}`)
    })

    return () => {
      renditionRef.current = null
      libro.destroy()
    }
  }, [path, aplicarTema])

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${tamano}%`)
  }, [tamano])

  return (
    <>
      <div className="split__head">
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => { void renditionRef.current?.prev() }}
          title="Página anterior"
        >
          <ChevronLeft size={16} strokeWidth={ICONO_TRAZO} />
        </button>
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => { void renditionRef.current?.next() }}
          title="Página siguiente"
        >
          <ChevronRight size={16} strokeWidth={ICONO_TRAZO} />
        </button>

        <div className="col truncate">
          <span className="truncate">{titulo || 'Libro sin título'}</span>
          <span className="mono dim">{posicion || 'Abriendo…'}</span>
        </div>

        <div className="spacer" />

        {(['light', 'sepia', 'dark'] as const).map((nombre) => (
          <button
            key={nombre}
            className={`btn btn--sm${tema === nombre ? '' : ' btn--ghost'}`}
            onClick={() => aplicarTema(nombre)}
            title={`Tema ${TEMAS_EPUB[nombre].etiqueta.toLowerCase()}`}
          >
            {TEMAS_EPUB[nombre].etiqueta}
          </button>
        ))}

        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => setTamano((valor) => Math.max(50, valor - 10))}
          title="Reducir fuente"
        >
          <Minus size={14} strokeWidth={ICONO_TRAZO} />
        </button>
        <span className="mono dim">{tamano}%</span>
        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => setTamano((valor) => Math.min(200, valor + 10))}
          title="Aumentar fuente"
        >
          <Plus size={14} strokeWidth={ICONO_TRAZO} />
        </button>
      </div>

      <div ref={visorRef} className="workspace__body" />
    </>
  )
}
