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
  Code,
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
  Table,
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
import type { ElementoLightbox } from './message/MediaLightbox'
import Colecciones, {
  EXT_AUDIO as EXT_AUDIO_COLECCION,
  EXT_IMAGEN,
  EXT_VIDEO as EXT_VIDEO_COLECCION,
  detectarColecciones,
  etiquetaCanal,
  formatearBytes,
  normalizar,
  textoFecha
} from './archive/Colecciones'
import type { Coleccion } from './archive/Colecciones'
import Galeria from './archive/Galeria'
import VisorDocumento from './archive/VisorDocumento'
import {
  extractJsonThreadMessages,
  filterAndSortCsvRows,
  formatCsvRows,
  parseCsvTable,
  summarizeArchiveJson
} from './archive/csvViewerUtils'

const ICONO_TRAZO = 1.8

const EXT_VIDEO = [...EXT_VIDEO_COLECCION, 'm4v']
const EXT_AUDIO = [...EXT_AUDIO_COLECCION, 'opus']
const EXT_TEXTO = [
  'md',
  'txt',
  'json',
  'css',
  'log',
  'xml',
  'csv',
  'html',
  'htm',
  'js',
  'ts',
  'yml',
  'yaml',
  'sql',
  'py',
  'sh',
  'bash',
  'bat',
  'ps1',
  'c',
  'cpp',
  'h',
  'rs',
  'go',
  'java',
  'kt',
  'cs',
  'php',
  'rb',
  'lua',
  'ini',
  'toml',
  'conf',
  'jsx',
  'tsx',
  'scss',
  'less',
  'svg'
]
const EXT_BINARIO = ['zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'iso', 'exe', 'dmg', 'apk']

const LENGUAJE_POR_EXT: Record<string, string> = {
  md: 'markdown',
  html: 'markup',
  htm: 'markup',
  svg: 'markup',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  log: 'bash',
  txt: 'text',
  csv: 'csv',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  bat: 'batch',
  ps1: 'powershell',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  lua: 'lua',
  ini: 'ini',
  toml: 'toml',
  conf: 'ini'
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
type FiltroMultimedia = 'todos' | 'imagen' | 'video' | 'audio'

const ETIQUETAS_FORMATO: Record<string, string> = {
  'post.md': 'Markdown',
  'thread.md': 'Hilo MD',
  'index.md': 'Índice MD',
  'post.html': 'HTML',
  'post.json': 'JSON',
  'post.csv': 'Tabla CSV',
  'messages.csv': 'Tabla CSV',
  'export.pdf': 'PDF',
  'export.epub': 'EPUB'
}

function etiquetaFormatoDoc(entrada: ArchiveFileEntry, todos: ArchiveFileEntry[]): string {
  const nombre = entrada.name.toLowerCase()
  if (nombre === 'messages.csv' && todos.some((f) => f.name.toLowerCase() === 'post.csv')) {
    return 'Mensajes CSV'
  }
  return ETIQUETAS_FORMATO[nombre] ?? entrada.name
}

function normalizarRutaArchivo(ruta: string): string {
  return ruta.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function buscarEntradaPorRuta(entradas: ArchiveFileEntry[], objetivoNormalizado: string): ArchiveFileEntry | null {
  for (const entrada of entradas) {
    if (normalizarRutaArchivo(entrada.path) === objetivoNormalizado) return entrada
    if (entrada.type === 'dir' && entrada.children?.length) {
      const dentro = buscarEntradaPorRuta(entrada.children, objetivoNormalizado)
      if (dentro) return dentro
    }
  }
  return null
}

function buscarPrimerArchivo(entradas: ArchiveFileEntry[]): ArchiveFileEntry | null {
  for (const entrada of entradas) {
    if (entrada.type !== 'dir') return entrada
    if (entrada.children?.length) {
      const dentro = buscarPrimerArchivo(entrada.children)
      if (dentro) return dentro
    }
  }
  return null
}

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
  const consultaInicial = useUiStore((estado) => estado.consultaInicial)
  const consumirConsultaInicial = useUiStore((estado) => estado.consumirConsultaInicial)
  const servidorInicial = useUiStore((estado) => estado.servidorInicial)
  const consumirServidorInicial = useUiStore((estado) => estado.consumirServidorInicial)

  const [arbol, setArbol] = useState<ArchiveFileEntry[]>([])
  const [colecciones, setColecciones] = useState<Coleccion[]>([])
  const [cargando, setCargando] = useState(true)
  const [modoRaiz, setModoRaiz] = useState<'colecciones' | 'explorador'>('colecciones')
  const [rutaActiva, setRutaActiva] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('documento')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaArbol, setBusquedaArbol] = useState('')
  const [consultaTransferida, setConsultaTransferida] = useState('')
  const [documento, setDocumento] = useState<Documento | null>(null)
  const [leyendoDoc, setLeyendoDoc] = useState(false)
  const [formatoActivo, setFormatoActivo] = useState<ArchiveFileEntry | null>(null)
  const [filtroGaleria, setFiltroGaleria] = useState<FiltroMultimedia>('todos')
  const [archivo, setArchivo] = useState<ArchivoAbierto | null>(null)
  const [leyendoArchivo, setLeyendoArchivo] = useState(false)
  const [ampliado, setAmpliado] = useState<{
    url: string
    tipo: TipoAmpliado
    items?: ElementoLightbox[]
    indiceInicial?: number
  } | null>(null)
  const [anchoArbol, setAnchoArbol] = useState(268)
  const [rutaCopiada, setRutaCopiada] = useState(false)
  const [contenidoCopiado, setContenidoCopiado] = useState(false)
  const [ordenColecciones, setOrdenColecciones] = useState<'fecha' | 'titulo' | 'tamano' | 'mensajes'>('fecha')
  const [filtroServidor, setFiltroServidor] = useState<string>('todos')

  const arrastreRef = useRef<AbortController | null>(null)
  const completadasRef = useRef(0)
  const copiaRef = useRef<number | null>(null)
  const copiaContenidoRef = useRef<number | null>(null)

  const coleccion = useMemo(
    () => colecciones.find((item) => item.ruta === rutaActiva) ?? null,
    [colecciones, rutaActiva]
  )

  const formatoEnUso = useMemo(() => {
    if (!coleccion) return null
    if (formatoActivo) {
      const coincidente =
        coleccion.formatos.find((fmt) => fmt.path === formatoActivo.path) ??
        coleccion.respuestasArchivos.find((resp) => resp.path === formatoActivo.path)
      if (coincidente) return coincidente
    }
    return coleccion.principal ?? coleccion.formatos[0] ?? null
  }, [coleccion, formatoActivo])

  const servidoresDisponibles = useMemo(() => {
    const nombres = new Set<string>()
    for (const item of colecciones) {
      if (item.servidor) nombres.add(item.servidor)
    }
    return Array.from(nombres).sort((a, b) => a.localeCompare(b, 'es'))
  }, [colecciones])

  const coleccionesFiltradas = useMemo(() => {
    const aguja = busqueda.trim() ? normalizar(busqueda) : ''
    const filtradas = colecciones.filter((item) => {
      if (filtroServidor !== 'todos' && item.servidor !== filtroServidor) return false
      if (aguja && !normalizar(`${item.titulo} ${item.canal} ${item.servidor}`).includes(aguja)) {
        return false
      }
      return true
    })

    return [...filtradas].sort((a, b) => {
      switch (ordenColecciones) {
        case 'titulo':
          return a.titulo.localeCompare(b.titulo, 'es')
        case 'tamano':
          return b.bytes - a.bytes
        case 'mensajes':
          return b.mensajes - a.mensajes
        default:
          return b.fecha - a.fecha
      }
    })
  }, [colecciones, busqueda, filtroServidor, ordenColecciones])

  const totalBytes = useMemo(
    () => colecciones.reduce((suma, item) => suma + item.bytes, 0),
    [colecciones]
  )

  // Aborta el arrastre del divisor si el componente se desmonta a mitad de gesto.
  useEffect(() => () => arrastreRef.current?.abort(), [])

  // Limpia los avisos de «Copiada» si la vista se cierra antes de tiempo.
  useEffect(() => () => {
    if (copiaRef.current !== null) window.clearTimeout(copiaRef.current)
    if (copiaContenidoRef.current !== null) window.clearTimeout(copiaContenidoRef.current)
  }, [])

  // Puente directo desde el Panel: filtra las colecciones por el servidor solicitado.
  useEffect(() => {
    if (!servidorInicial) return
    setFiltroServidor(servidorInicial)
    setRutaActiva(null)
    setModoRaiz('colecciones')
    consumirServidorInicial()
  }, [servidorInicial, consumirServidorInicial])

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

  // Formato activo de la colección abierta: se lee solo el formato seleccionado en texto.
  useEffect(() => {
    setDocumento(null)
    if (!coleccion || !formatoEnUso) {
      setLeyendoDoc(false)
      return
    }

    const ext = extensionDe(formatoEnUso.name)
    // PDF y EPUB los cargan sus propios visores vía archive:// sin leer texto en memoria.
    if (ext === 'pdf' || ext === 'epub') {
      setLeyendoDoc(false)
      return
    }

    let vigente = true
    setLeyendoDoc(true)

    window.api.archive.readFile(formatoEnUso.path)
      .then((resultado) => {
        if (!vigente) return
        setDocumento({ contenido: resultado.content, ruta: formatoEnUso.path, truncado: resultado.truncated })
      })
      .catch(() => {
        if (vigente) setDocumento({ contenido: '', ruta: formatoEnUso.path, truncado: false })
      })
      .finally(() => {
        if (vigente) setLeyendoDoc(false)
      })

    return () => { vigente = false }
  }, [coleccion?.ruta, formatoEnUso?.path])

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

  // En el explorador raíz se previsualiza el primer archivo disponible si aún no hay ninguno abierto.
  useEffect(() => {
    if (coleccion || modoRaiz !== 'explorador' || archivo || leyendoArchivo) return
    const primero = buscarPrimerArchivo(arbol)
    if (primero) void abrirArchivo(primero)
  }, [coleccion, modoRaiz, archivo, leyendoArchivo, arbol, abrirArchivo])

  const abrirColeccion = useCallback((
    item: Coleccion,
    formatoInicial?: ArchiveFileEntry | null,
    pestanaInicial: Pestana = 'documento'
  ) => {
    const inicial = formatoInicial ?? item.principal ?? item.formatos[0] ?? null
    const esBinario = inicial ? ['pdf', 'epub'].includes(extensionDe(inicial.name)) : false
    setRutaActiva(item.ruta)
    setPestana(pestanaInicial)
    setBusquedaArbol('')
    setFiltroGaleria('todos')
    setFormatoActivo(inicial)
    // Se limpia antes de leer: evita mostrar el documento de la colección anterior.
    setDocumento(null)
    setArchivo(null)
    setLeyendoDoc(Boolean(inicial && !esBinario))
  }, [])

  const volver = useCallback(() => {
    setRutaActiva(null)
    setFormatoActivo(null)
    setFiltroGaleria('todos')
    setDocumento(null)
    setArchivo(null)
    setBusquedaArbol('')
    setConsultaTransferida('')
  }, [])

  const listaNavColecciones = useMemo(
    () => (coleccionesFiltradas.length > 0 ? coleccionesFiltradas : colecciones),
    [coleccionesFiltradas, colecciones]
  )

  const indiceColeccionActual = useMemo(() => {
    if (!coleccion) return -1
    return listaNavColecciones.findIndex((item) => item.ruta === coleccion.ruta)
  }, [coleccion, listaNavColecciones])

  const coleccionAnterior =
    indiceColeccionActual > 0 ? listaNavColecciones[indiceColeccionActual - 1] : null
  const coleccionSiguiente =
    indiceColeccionActual >= 0 && indiceColeccionActual < listaNavColecciones.length - 1
      ? listaNavColecciones[indiceColeccionActual + 1]
      : null

  useEffect(() => {
    if (!coleccion) return
    const alTecla = (evento: KeyboardEvent) => {
      if (!evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return
      const destino = evento.target as HTMLElement | null
      if (destino) {
        const etiqueta = destino.tagName.toLowerCase()
        if (
          etiqueta === 'input' ||
          etiqueta === 'textarea' ||
          etiqueta === 'select' ||
          destino.isContentEditable
        ) {
          return
        }
      }
      if (evento.key === 'ArrowLeft' && coleccionAnterior) {
        evento.preventDefault()
        abrirColeccion(coleccionAnterior)
      } else if (evento.key === 'ArrowRight' && coleccionSiguiente) {
        evento.preventDefault()
        abrirColeccion(coleccionSiguiente)
      } else if (evento.key === '1') {
        evento.preventDefault()
        setPestana('documento')
      } else if (evento.key === '2') {
        evento.preventDefault()
        setPestana('galeria')
      } else if (evento.key === '3') {
        evento.preventDefault()
        setPestana('archivos')
      }
    }
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [coleccion, coleccionAnterior, coleccionSiguiente, abrirColeccion])

  // La búsqueda global o un salto directo puede pedir una carpeta o un archivo concreto:
  // abre la colección (o el explorador raíz) y posiciona el visor en el archivo exacto, sin salir de la app.
  useEffect(() => {
    if (!archivoPedido || cargando) return
    setConsultaTransferida(consultaInicial ?? '')
    consumirConsultaInicial()

    const objetivo = normalizarRutaArchivo(archivoPedido)
    const item = [...colecciones]
      .sort((a, b) => b.ruta.length - a.ruta.length)
      .find((c) => {
        const base = normalizarRutaArchivo(c.ruta)
        return objetivo === base || objetivo.startsWith(`${base}/`)
      })

    if (item) {
      setModoRaiz('colecciones')
      const base = normalizarRutaArchivo(item.ruta)
      if (objetivo !== base) {
        const enFormatos = item.formatos.find(
          (f) => normalizarRutaArchivo(f.path) === objetivo
        )
        const enRespuestas = item.respuestasArchivos.find(
          (r) => normalizarRutaArchivo(r.path) === objetivo
        )
        if (enFormatos) {
          abrirColeccion(item, enFormatos, 'documento')
        } else if (enRespuestas) {
          abrirColeccion(item, enRespuestas, 'documento')
        } else {
          const encontrado = buscarEntradaPorRuta(item.nodo.children ?? [], objetivo)
          if (encontrado && encontrado.type !== 'dir') {
            abrirColeccion(item, undefined, 'archivos')
            void abrirArchivo(encontrado)
          } else {
            abrirColeccion(item)
          }
        }
      } else {
        abrirColeccion(item)
      }
    } else if (arbol.length > 0) {
      const encontradoEnArbol = buscarEntradaPorRuta(arbol, objetivo)
      if (encontradoEnArbol) {
        setRutaActiva(null)
        setModoRaiz('explorador')
        if (encontradoEnArbol.type !== 'dir') {
          void abrirArchivo(encontradoEnArbol)
        } else {
          const primero = buscarPrimerArchivo(encontradoEnArbol.children ?? [])
          if (primero) void abrirArchivo(primero)
        }
      } else if (outputDir && objetivo === normalizarRutaArchivo(outputDir) && colecciones.length === 0) {
        setRutaActiva(null)
        setModoRaiz('explorador')
      }
    }

    consumirArchivoInicial()
  }, [
    archivoPedido,
    consultaInicial,
    cargando,
    colecciones,
    arbol,
    outputDir,
    abrirColeccion,
    abrirArchivo,
    consumirArchivoInicial,
    consumirConsultaInicial
  ])

  const copiarContenido = useCallback(async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setContenidoCopiado(true)
      if (copiaContenidoRef.current !== null) window.clearTimeout(copiaContenidoRef.current)
      copiaContenidoRef.current = window.setTimeout(() => setContenidoCopiado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }, [])

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
    const extFormatoActivo = formatoEnUso ? extensionDe(formatoEnUso.name) : ''
    const copiarEnBarraDoc =
      pestana === 'documento' &&
      Boolean(documento?.contenido) &&
      !['pdf', 'epub', 'csv', 'json', 'html', 'htm'].includes(extFormatoActivo)

    const imagenesMedia = coleccion.multimedia.filter((m) => EXT_IMAGEN.includes(extensionDe(m.name)))
    const videosMedia = coleccion.multimedia.filter((m) => EXT_VIDEO.includes(extensionDe(m.name)))
    const audiosMedia = coleccion.multimedia.filter((m) => EXT_AUDIO.includes(extensionDe(m.name)))
    const hayMixtos =
      [imagenesMedia.length > 0, videosMedia.length > 0, audiosMedia.length > 0].filter(Boolean).length > 1
    const filtroEfectivo: FiltroMultimedia =
      filtroGaleria === 'imagen' && imagenesMedia.length === 0
        ? 'todos'
        : filtroGaleria === 'video' && videosMedia.length === 0
          ? 'todos'
          : filtroGaleria === 'audio' && audiosMedia.length === 0
            ? 'todos'
            : filtroGaleria
    const multimediaVisible = coleccion.multimedia.filter((m) => {
      if (filtroEfectivo === 'todos') return true
      const ext = extensionDe(m.name)
      if (filtroEfectivo === 'imagen') return EXT_IMAGEN.includes(ext)
      if (filtroEfectivo === 'video') return EXT_VIDEO.includes(ext)
      return EXT_AUDIO.includes(ext)
    })

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
              {coleccion.multimedia.length > coleccion.imagenes.length
                ? `${coleccion.multimedia.length} archivos multimedia`
                : `${coleccion.imagenes.length} imágenes`}{' '}
              · {formatearBytes(coleccion.bytes)}
            </div>
          </div>

          <div className="workspace__actions">
            {listaNavColecciones.length > 0 && indiceColeccionActual >= 0 && (
              <div className="visor__nav-coleccion" role="group" aria-label="Navegación entre colecciones">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  disabled={!coleccionAnterior}
                  onClick={() => coleccionAnterior && abrirColeccion(coleccionAnterior)}
                  title="Colección anterior (Alt + ←)"
                  aria-label="Colección anterior"
                >
                  <ChevronLeft size={15} strokeWidth={ICONO_TRAZO} />
                </button>
                <span className="mono dim">
                  ({indiceColeccionActual + 1} / {listaNavColecciones.length})
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  disabled={!coleccionSiguiente}
                  onClick={() => coleccionSiguiente && abrirColeccion(coleccionSiguiente)}
                  title="Colección siguiente (Alt + →)"
                  aria-label="Colección siguiente"
                >
                  <ChevronRight size={15} strokeWidth={ICONO_TRAZO} />
                </button>
              </div>
            )}
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
                <span className="dim mono">{coleccion.multimedia.length}</span>
              </button>
              <button
                className={`btn btn--sm${pestana === 'archivos' ? '' : ' btn--ghost'}`}
                onClick={() => setPestana('archivos')}
              >
                Archivos
                <span className="dim mono">{hijos.length}</span>
              </button>

              <span className="spacer" />

              {copiarEnBarraDoc && documento?.contenido && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void copiarContenido(documento.contenido)}
                  title="Copiar markdown completo del documento"
                >
                  {contenidoCopiado
                    ? <Check size={14} strokeWidth={ICONO_TRAZO} />
                    : <Copy size={14} strokeWidth={ICONO_TRAZO} />}
                  {contenidoCopiado ? 'Texto copiado' : 'Copiar texto'}
                </button>
              )}

              {documento?.truncado && pestana === 'documento' && (
                <span className="badge badge--warn" title="Vista parcial del documento">
                  <TriangleAlert size={11} strokeWidth={2} />
                  Truncado
                </span>
              )}
            </div>

            {pestana === 'documento' && (
              <>
                {(coleccion.formatos.length > 0 || coleccion.respuestasArchivos.length > 0) && (
                  <div className="visor__formatos" role="tablist" aria-label="Formatos disponibles">
                    {coleccion.formatos.map((fmt) => {
                      const activo = formatoEnUso?.path === fmt.path
                      return (
                        <button
                          key={fmt.path}
                          type="button"
                          role="tab"
                          aria-selected={activo}
                          className={`chip${activo ? ' chip--active' : ''}`}
                          onClick={() => setFormatoActivo(fmt)}
                          title={fmt.name}
                        >
                          {etiquetaFormatoDoc(fmt, coleccion.formatos)}
                        </button>
                      )
                    })}

                    {coleccion.respuestasArchivos.length > 0 && (() => {
                      const indiceResp = coleccion.respuestasArchivos.findIndex(
                        (r) => r.path === formatoEnUso?.path
                      )
                      const respuestaActiva =
                        indiceResp >= 0 ? coleccion.respuestasArchivos[indiceResp] : null
                      return (
                        <>
                          <span className="spacer" />
                          <select
                            className="select"
                            style={{ width: 'auto', height: 28 }}
                            value={respuestaActiva?.path ?? ''}
                            onChange={(evento) => {
                              const ruta = evento.target.value
                              if (!ruta) {
                                setFormatoActivo(coleccion.principal ?? coleccion.formatos[0] ?? null)
                                return
                              }
                              const elegida = coleccion.respuestasArchivos.find((r) => r.path === ruta)
                              if (elegida) setFormatoActivo(elegida)
                            }}
                            aria-label={`Respuestas (${coleccion.respuestasArchivos.length})`}
                          >
                            <option value="">
                              Respuestas ({coleccion.respuestasArchivos.length})
                            </option>
                            {coleccion.respuestasArchivos.map((resp, idx) => (
                              <option key={resp.path} value={resp.path}>
                                #{idx + 1} · {resp.name.replace(/\.md$/i, '')}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={indiceResp <= 0}
                            onClick={() => {
                              if (indiceResp > 0) {
                                setFormatoActivo(coleccion.respuestasArchivos[indiceResp - 1])
                              }
                            }}
                            title="Respuesta anterior"
                            aria-label="Respuesta anterior"
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={indiceResp >= coleccion.respuestasArchivos.length - 1}
                            onClick={() => {
                              const siguienteIndice = indiceResp < 0 ? 0 : indiceResp + 1
                              const siguienteResp = coleccion.respuestasArchivos[siguienteIndice]
                              if (siguienteResp) setFormatoActivo(siguienteResp)
                            }}
                            title="Respuesta siguiente"
                            aria-label="Respuesta siguiente"
                          >
                            ▶
                          </button>
                          {respuestaActiva && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() =>
                                setFormatoActivo(coleccion.principal ?? coleccion.formatos[0] ?? null)
                              }
                            >
                              Volver al post
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}

                {!formatoEnUso ? (
                  <div className="empty">
                    <div className="empty__icon">
                      <FileText size={20} strokeWidth={ICONO_TRAZO} />
                    </div>
                    <div className="empty__title">Esta colección no tiene documento</div>
                    <div className="empty__text">
                      No se encontró post.md, thread.md, index.md ni otros formatos exportados en la
                      carpeta. Revisa la pestaña Archivos para ver qué se descargó.
                    </div>
                    <button className="btn btn--sm" onClick={() => setPestana('archivos')}>
                      <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
                      Ver archivos
                    </button>
                  </div>
                ) : extFormatoActivo === 'pdf' ? (
                  <iframe
                    className="visor__frame"
                    src={window.api.archive.toUrl(formatoEnUso.path)}
                    title={formatoEnUso.name}
                  />
                ) : extFormatoActivo === 'epub' ? (
                  <EpubViewer path={formatoEnUso.path} />
                ) : leyendoDoc ? (
                  <div className="split__body">
                    <div className="col">
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                      <div className="skeleton skeleton--row" />
                    </div>
                  </div>
                ) : extFormatoActivo === 'html' || extFormatoActivo === 'htm' ? (
                  <VistaHtml
                    path={formatoEnUso.path}
                    name={formatoEnUso.name}
                    contenido={documento?.contenido ?? ''}
                  />
                ) : extFormatoActivo === 'csv' ? (
                  <VistaCsv
                    contenido={documento?.contenido ?? ''}
                    truncado={Boolean(documento?.truncado)}
                    consultaInicial={consultaTransferida}
                  />
                ) : extFormatoActivo === 'json' ? (
                  <VistaJson
                    contenido={documento?.contenido ?? ''}
                    truncado={Boolean(documento?.truncado)}
                    consultaInicial={consultaTransferida}
                  />
                ) : documento && documento.contenido ? (
                  <VisorDocumento
                    contenido={documento.contenido}
                    ruta={documento.ruta}
                    onAmpliar={(url) => ampliar(url, 'imagen')}
                    consultaInicial={consultaTransferida}
                  />
                ) : (
                  <div className="empty">
                    <div className="empty__icon">
                      <FileText size={20} strokeWidth={ICONO_TRAZO} />
                    </div>
                    <div className="empty__title">El documento está vacío</div>
                    <div className="empty__text">
                      No se encontró contenido legible en {formatoEnUso.name}. Revisa la pestaña
                      Archivos para inspeccionar otros recursos descargados.
                    </div>
                    <button className="btn btn--sm" onClick={() => setPestana('archivos')}>
                      <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
                      Ver archivos
                    </button>
                  </div>
                )}
              </>
            )}

            {pestana === 'galeria' && (
              coleccion.multimedia.length === 0 ? (
                <div className="empty">
                  <div className="empty__icon">
                    <FileImage size={20} strokeWidth={ICONO_TRAZO} />
                  </div>
                  <div className="empty__title">Sin archivos multimedia</div>
                  <div className="empty__text">
                    Esta publicación no descargó imágenes, vídeos ni audios. Puedes repetir la
                    descarga incluyendo multimedia desde Explorar.
                  </div>
                </div>
              ) : !hayMixtos && videosMedia.length === 0 && audiosMedia.length === 0 ? (
                <Galeria
                  imagenes={coleccion.imagenes}
                  onAbrir={(indice) => {
                    const imagen = coleccion.imagenes[indice]
                    if (!imagen) return
                    const items: ElementoLightbox[] = coleccion.imagenes.map((img) => ({
                      url: window.api.archive.toUrl(img.path),
                      tipo: 'imagen' as const,
                      nombre: img.name
                    }))
                    setAmpliado({
                      url: items[indice].url,
                      tipo: 'imagen',
                      items,
                      indiceInicial: indice
                    })
                  }}
                />
              ) : (
                <>
                  {hayMixtos && (
                    <div className="galeria__filtro" role="tablist" aria-label="Filtrar multimedia">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={filtroEfectivo === 'todos'}
                        className={`chip${filtroEfectivo === 'todos' ? ' chip--active' : ''}`}
                        onClick={() => setFiltroGaleria('todos')}
                      >
                        Todos <span className="mono dim">{coleccion.multimedia.length}</span>
                      </button>
                      {imagenesMedia.length > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={filtroEfectivo === 'imagen'}
                          className={`chip${filtroEfectivo === 'imagen' ? ' chip--active' : ''}`}
                          onClick={() => setFiltroGaleria('imagen')}
                        >
                          Imágenes <span className="mono dim">{imagenesMedia.length}</span>
                        </button>
                      )}
                      {videosMedia.length > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={filtroEfectivo === 'video'}
                          className={`chip${filtroEfectivo === 'video' ? ' chip--active' : ''}`}
                          onClick={() => setFiltroGaleria('video')}
                        >
                          Vídeos <span className="mono dim">{videosMedia.length}</span>
                        </button>
                      )}
                      {audiosMedia.length > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={filtroEfectivo === 'audio'}
                          className={`chip${filtroEfectivo === 'audio' ? ' chip--active' : ''}`}
                          onClick={() => setFiltroGaleria('audio')}
                        >
                          Audio <span className="mono dim">{audiosMedia.length}</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="visor__galeria">
                    {multimediaVisible.map((media) => {
                      const ext = extensionDe(media.name)
                      const url = window.api.archive.toUrl(media.path)

                      if (EXT_IMAGEN.includes(ext)) {
                        const idxImagen = imagenesMedia.findIndex((img) => img.path === media.path)
                        return (
                          <button
                            key={media.path}
                            type="button"
                            className="galeria__item"
                            onClick={() => {
                              const items: ElementoLightbox[] = imagenesMedia.map((img) => ({
                                url: window.api.archive.toUrl(img.path),
                                tipo: 'imagen' as const,
                                nombre: img.name
                              }))
                              const indice = idxImagen >= 0 ? idxImagen : 0
                              if (!items[indice]) return
                              setAmpliado({
                                url: items[indice].url,
                                tipo: 'imagen',
                                items,
                                indiceInicial: indice
                              })
                            }}
                            title={media.name}
                          >
                            <img className="galeria__img" src={url} alt={media.name} loading="lazy" />
                          </button>
                        )
                      }

                      if (EXT_VIDEO.includes(ext)) {
                        return (
                          <div
                            key={media.path}
                            className="galeria__item"
                            style={{ cursor: 'default' }}
                            title={media.name}
                          >
                            <video src={url} controls preload="metadata" playsInline />
                          </div>
                        )
                      }

                      return (
                        <div
                          key={media.path}
                          className="galeria__item"
                          style={{ cursor: 'default', gap: 'var(--sp-2)', padding: 'var(--sp-2)' }}
                          title={media.name}
                        >
                          <FileAudio size={24} strokeWidth={ICONO_TRAZO} className="dim" />
                          <span className="mono dim truncate" style={{ maxWidth: '100%', fontSize: 'var(--text-xs)' }}>
                            {media.name}
                          </span>
                          <audio src={url} controls preload="metadata" />
                        </div>
                      )
                    })}
                  </div>
                </>
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
                    {archivo && EXT_TEXTO.includes(archivo.tipo) && archivo.contenido && (
                      <button
                        className="btn btn--ghost btn--icon btn--sm"
                        onClick={() => void copiarContenido(archivo.contenido)}
                        title={contenidoCopiado ? 'Texto copiado' : 'Copiar contenido'}
                      >
                        {contenidoCopiado
                          ? <Check size={15} strokeWidth={ICONO_TRAZO} />
                          : <Copy size={15} strokeWidth={ICONO_TRAZO} />}
                      </button>
                    )}
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
                    <VistaPrevia
                      archivo={archivo}
                      onAmpliar={ampliar}
                      consultaInicial={consultaTransferida}
                    />
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
            items={ampliado.items}
            indiceInicial={ampliado.indiceInicial}
            onClose={() => setAmpliado(null)}
          />
        )}
      </>
    )
  }

  // ---------- Listado de colecciones y explorador raíz ----------
  const subtitulo = cargando
    ? 'Leyendo la carpeta de salida'
    : `${colecciones.length} ${colecciones.length === 1 ? 'colección' : 'colecciones'} · ${formatearBytes(totalBytes)}`
  const arbolRaizVisible = filtrarArbol(arbol, busquedaArbol)

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
          ) : arbol.length === 0 ? (
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
            <>
              <div className="visor__barra">
                <button
                  type="button"
                  className={`chip${modoRaiz === 'colecciones' ? ' chip--active' : ''}`}
                  onClick={() => setModoRaiz('colecciones')}
                >
                  Colecciones ({colecciones.length})
                </button>
                <button
                  type="button"
                  className={`chip${modoRaiz === 'explorador' ? ' chip--active' : ''}`}
                  onClick={() => setModoRaiz('explorador')}
                >
                  Explorador de archivos
                </button>

                {modoRaiz === 'colecciones' && colecciones.length > 0 && (
                  <>
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

                    {(servidoresDisponibles.length > 1 || filtroServidor !== 'todos') && (
                      <select
                        className="select"
                        style={{ width: 'auto', height: 30 }}
                        value={filtroServidor}
                        onChange={(evento) => setFiltroServidor(evento.target.value)}
                        title="Filtrar por servidor"
                      >
                        <option value="todos">Todos los servidores</option>
                        {filtroServidor !== 'todos' && !servidoresDisponibles.includes(filtroServidor) && (
                          <option value={filtroServidor}>{filtroServidor}</option>
                        )}
                        {servidoresDisponibles.map((srv) => (
                          <option key={srv} value={srv}>{srv}</option>
                        ))}
                      </select>
                    )}

                    <select
                      className="select"
                      style={{ width: 'auto', height: 30 }}
                      value={ordenColecciones}
                      onChange={(evento) =>
                        setOrdenColecciones(evento.target.value as 'fecha' | 'titulo' | 'tamano' | 'mensajes')
                      }
                      title="Ordenar colecciones"
                    >
                      <option value="fecha">Más recientes</option>
                      <option value="titulo">Por título</option>
                      <option value="tamano">Mayor tamaño</option>
                      <option value="mensajes">Más mensajes</option>
                    </select>

                    {(busqueda.trim() || filtroServidor !== 'todos') && (
                      <span className="muted mono">
                        {coleccionesFiltradas.length} de {colecciones.length}
                      </span>
                    )}
                  </>
                )}
              </div>

              {modoRaiz === 'explorador' ? (
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

                    {arbolRaizVisible.length > 0 ? (
                      <div className="arbol">
                        <Arbol
                          entradas={arbolRaizVisible}
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
                      {archivo && EXT_TEXTO.includes(archivo.tipo) && archivo.contenido && (
                        <button
                          className="btn btn--ghost btn--icon btn--sm"
                          onClick={() => void copiarContenido(archivo.contenido)}
                          title={contenidoCopiado ? 'Texto copiado' : 'Copiar contenido'}
                        >
                          {contenidoCopiado
                            ? <Check size={15} strokeWidth={ICONO_TRAZO} />
                            : <Copy size={15} strokeWidth={ICONO_TRAZO} />}
                        </button>
                      )}
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
                      <VistaPrevia
                        archivo={archivo}
                        onAmpliar={ampliar}
                        consultaInicial={consultaTransferida}
                      />
                    ) : (
                      <div className="empty">
                        <div className="empty__icon">
                          <FileText size={20} strokeWidth={ICONO_TRAZO} />
                        </div>
                        <div className="empty__title">Elige un archivo</div>
                        <div className="empty__text">
                          Inspecciona cualquier carpeta o archivo descargado en la carpeta de salida,
                          aunque no forme parte de una colección detectada.
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              ) : colecciones.length === 0 ? (
                <div className="empty">
                  <div className="empty__icon">
                    <Folder size={20} strokeWidth={ICONO_TRAZO} />
                  </div>
                  <div className="empty__title">No se detectaron colecciones</div>
                  <div className="empty__text">
                    Hay archivos en la carpeta, pero ninguna carpeta contiene post.md, thread.md,
                    index.md ni exportaciones compatibles (HTML, JSON, CSV, PDF o EPUB). Puedes
                    inspeccionarlos directamente en el explorador de archivos integrado.
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => setModoRaiz('explorador')}
                    >
                      <FolderOpen size={14} strokeWidth={ICONO_TRAZO} />
                      Abrir explorador de archivos
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => void cargar()}>
                      <RefreshCw size={14} strokeWidth={ICONO_TRAZO} />
                      Refrescar
                    </button>
                  </div>
                </div>
              ) : coleccionesFiltradas.length > 0 ? (
                <Colecciones colecciones={coleccionesFiltradas} onAbrir={abrirColeccion} />
              ) : (
                <div className="empty">
                  <Search size={16} strokeWidth={ICONO_TRAZO} className="dim" />
                  <div className="empty__title">Sin coincidencias</div>
                  <div className="empty__text">
                    Ninguna colección coincide con «{busqueda || filtroServidor}». Prueba con el
                    nombre del canal o del servidor.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {ampliado && (
        <MediaLightbox
          url={ampliado.url}
          tipo={ampliado.tipo}
          items={ampliado.items}
          indiceInicial={ampliado.indiceInicial}
          onClose={() => setAmpliado(null)}
        />
      )}
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
  consultaInicial?: string
}

function VistaPrevia({ archivo, onAmpliar, consultaInicial }: PropsPrevia) {
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

  if (ext === 'svg') {
    return (
      <VistaSvg
        archivo={archivo}
        url={url}
        onAmpliar={onAmpliar}
        consultaInicial={consultaInicial}
      />
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
        className="visor__frame"
        src={`${url}#view=FitH&toolbar=1`}
        title={`PDF · ${archivo.name}`}
      />
    )
  }

  if (ext === 'html' || ext === 'htm') {
    return <VistaHtml path={archivo.path} name={archivo.name} contenido={archivo.contenido} />
  }

  if (ext === 'csv') {
    return (
      <VistaCsv
        contenido={archivo.contenido}
        truncado={archivo.truncado}
        consultaInicial={consultaInicial}
      />
    )
  }

  if (ext === 'md') {
    return (
      <VisorDocumento
        contenido={archivo.contenido}
        ruta={archivo.path}
        onAmpliar={(imagen) => onAmpliar(imagen, 'imagen')}
        consultaInicial={consultaInicial}
      />
    )
  }

  if (ext === 'json') {
    return (
      <VistaJson
        contenido={archivo.contenido}
        truncado={archivo.truncado}
        consultaInicial={consultaInicial}
      />
    )
  }

  if (EXT_TEXTO.includes(ext)) {
    return (
      <VistaCodigo
        contenido={archivo.contenido}
        lenguaje={LENGUAJE_POR_EXT[ext] ?? 'text'}
        consultaInicial={consultaInicial}
      />
    )
  }

  return <VistaBinario archivo={archivo} />
}

/** Vista dual para archivos SVG: imagen vectorizada o código fuente XML/SVG. */
function VistaSvg({
  archivo,
  url,
  onAmpliar,
  consultaInicial
}: {
  archivo: ArchivoAbierto
  url: string
  onAmpliar: (url: string, tipo: TipoAmpliado) => void
  consultaInicial?: string
}) {
  const [modo, setModo] = useState<'imagen' | 'codigo'>('imagen')

  useEffect(() => {
    setModo('imagen')
  }, [archivo.path])

  return (
    <>
      <div className="visor__json-meta">
        <button
          type="button"
          className={`chip${modo === 'imagen' ? ' chip--active' : ''}`}
          onClick={() => setModo('imagen')}
        >
          <FileImage size={13} strokeWidth={ICONO_TRAZO} />
          Vista imagen
        </button>
        <button
          type="button"
          className={`chip${modo === 'codigo' ? ' chip--active' : ''}`}
          onClick={() => setModo('codigo')}
        >
          <Code size={13} strokeWidth={ICONO_TRAZO} />
          Código SVG
        </button>
        <span className="spacer" />
        <span className="mono dim">{archivo.name}</span>
      </div>

      {modo === 'imagen' ? (
        <div className="split__body">
          <div className="empty">
            <img src={url} alt={archivo.name} onClick={() => onAmpliar(url, 'imagen')} />
          </div>
        </div>
      ) : (
        <VistaCodigo
          contenido={archivo.contenido}
          lenguaje="markup"
          consultaInicial={consultaInicial}
        />
      )}
    </>
  )
}

/** Ficha técnica para archivos binarios o sin visor textual dedicado. */
function VistaBinario({ archivo }: { archivo: ArchivoAbierto }) {
  const [rutaCopiada, setRutaCopiada] = useState(false)
  const timerRef = useRef<number | null>(null)
  const ext = archivo.tipo

  useEffect(() => {
    setRutaCopiada(false)
  }, [archivo.path])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copiarRutaArchivo = async () => {
    try {
      await navigator.clipboard.writeText(archivo.path)
      setRutaCopiada(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setRutaCopiada(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  return (
    <div className="empty">
      <div className="empty__icon">
        <File size={20} strokeWidth={ICONO_TRAZO} />
      </div>
      <div className="empty__title truncate">{archivo.name}</div>
      <div className="empty__text">
        {EXT_BINARIO.includes(ext)
          ? 'Archivo binario archivado localmente. Consulta su ficha técnica o su ubicación en el archivo.'
          : 'Ficha técnica del recurso archivado localmente.'}
      </div>

      <div className="visor__binario-ficha" role="region" aria-label="Ficha técnica del archivo">
        <div className="visor__binario-fila">
          <span className="visor__binario-etiqueta">Nombre</span>
          <span className="visor__binario-valor">{archivo.name}</span>
        </div>
        <div className="visor__binario-fila">
          <span className="visor__binario-etiqueta">Extensión</span>
          <span className="visor__binario-valor">{ext ? ext.toUpperCase() : 'SIN EXTENSIÓN'}</span>
        </div>
        <div className="visor__binario-fila">
          <span className="visor__binario-etiqueta">Tamaño</span>
          <span className="visor__binario-valor">
            {formatearBytes(archivo.bytes)} ({archivo.bytes.toLocaleString('es-ES')} bytes)
          </span>
        </div>
        <div className="visor__binario-fila">
          <span className="visor__binario-etiqueta">Ruta completa</span>
          <span className="visor__binario-valor">{archivo.path}</span>
        </div>
      </div>

      <div className="row">
        <button type="button" className="btn btn--sm" onClick={() => void copiarRutaArchivo()}>
          {rutaCopiada
            ? <Check size={14} strokeWidth={ICONO_TRAZO} />
            : <Copy size={14} strokeWidth={ICONO_TRAZO} />}
          {rutaCopiada ? 'Ruta copiada' : 'Copiar ruta'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void window.api.settings.revealFolder(archivo.path)}
        >
          <ExternalLink size={14} strokeWidth={ICONO_TRAZO} />
          Mostrar en el sistema
        </button>
      </div>
    </div>
  )
}

/** Vista de código reutilizada por los visores HTML, CSV, JSON, SVG y archivos de texto. */
function VistaCodigo({
  contenido,
  lenguaje,
  consultaInicial
}: {
  contenido: string
  lenguaje: string
  consultaInicial?: string
}) {
  const [filtro, setFiltro] = useState(() =>
    consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : ''
  )
  const [ajustarLinea, setAjustarLinea] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const copiaTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setFiltro(consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : '')
    setCopiado(false)
  }, [contenido, consultaInicial])

  useEffect(() => () => {
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
  }, [])

  const lineasTotales = useMemo(() => (contenido ? contenido.split(/\r?\n/) : []), [contenido])

  const lineasFiltradas = useMemo(() => {
    const aguja = normalizar(filtro.trim())
    if (!aguja) return lineasTotales
    return lineasTotales.filter((linea) => normalizar(linea).includes(aguja))
  }, [lineasTotales, filtro])

  const codigoMostrado = useMemo(() => {
    if (!filtro.trim()) return contenido
    return lineasFiltradas.length > 0 ? lineasFiltradas.join('\n') : '// Sin líneas coincidentes'
  }, [contenido, filtro, lineasFiltradas])

  const copiarCodigo = async () => {
    if (!codigoMostrado) return
    try {
      await navigator.clipboard.writeText(codigoMostrado)
      setCopiado(true)
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
      copiaTimerRef.current = window.setTimeout(() => setCopiado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  return (
    <>
      <div className="visor__json-meta">
        <div className="search" style={{ minWidth: 180, flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={14} strokeWidth={ICONO_TRAZO} className="search__icon" />
          <input
            className="input input--search"
            type="search"
            placeholder="Filtrar líneas…"
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
          />
        </div>

        <span className="badge mono">
          {filtro.trim()
            ? `${lineasFiltradas.length} de ${lineasTotales.length} líneas`
            : `${lineasTotales.length} ${lineasTotales.length === 1 ? 'línea' : 'líneas'}`}
        </span>

        <span className="spacer" />

        <button
          type="button"
          className={`chip${ajustarLinea ? ' chip--active' : ''}`}
          onClick={() => setAjustarLinea((prev) => !prev)}
        >
          Ajustar línea
        </button>

        {contenido && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarCodigo()}
            title="Copiar código"
          >
            {copiado
              ? <Check size={13} strokeWidth={ICONO_TRAZO} />
              : <Copy size={13} strokeWidth={ICONO_TRAZO} />}
            {copiado ? 'Código copiado' : 'Copiar código'}
          </button>
        )}
      </div>

      <div className="split__body">
        <SyntaxHighlighter
          language={lenguaje}
          style={vscDarkPlus}
          showLineNumbers
          wrapLongLines={ajustarLinea}
          customStyle={ESTILO_CODIGO}
        >
          {codigoMostrado}
        </SyntaxHighlighter>
      </div>
    </>
  )
}

/** Visor HTML integrado con conmutador entre renderizado seguro y código fuente. */
function VistaHtml({ path, name, contenido }: { path: string; name: string; contenido: string }) {
  const [modo, setModo] = useState<'vista' | 'codigo'>('vista')
  const [copiado, setCopiado] = useState(false)
  const copiaTimerRef = useRef<number | null>(null)
  const url = window.api.archive.toUrl(path)

  useEffect(() => {
    setModo('vista')
    setCopiado(false)
  }, [path])

  useEffect(() => () => {
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
  }, [])

  const copiarHtml = async () => {
    if (!contenido) return
    try {
      await navigator.clipboard.writeText(contenido)
      setCopiado(true)
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
      copiaTimerRef.current = window.setTimeout(() => setCopiado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  return (
    <>
      <div className="visor__json-meta">
        <button
          type="button"
          className={`chip${modo === 'vista' ? ' chip--active' : ''}`}
          onClick={() => setModo('vista')}
        >
          <Globe size={13} strokeWidth={ICONO_TRAZO} />
          Vista HTML
        </button>
        <button
          type="button"
          className={`chip${modo === 'codigo' ? ' chip--active' : ''}`}
          onClick={() => setModo('codigo')}
        >
          <Code size={13} strokeWidth={ICONO_TRAZO} />
          Código fuente
        </button>

        <span className="spacer" />
        <span className="mono dim">{name}</span>

        {contenido && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarHtml()}
            title="Copiar código fuente HTML"
          >
            {copiado
              ? <Check size={13} strokeWidth={ICONO_TRAZO} />
              : <Copy size={13} strokeWidth={ICONO_TRAZO} />}
            {copiado ? 'HTML copiado' : 'Copiar HTML'}
          </button>
        )}
      </div>

      {modo === 'vista' ? (
        // sandbox vacío: el HTML exportado funciona sin JS (el toggle de tema es CSS puro).
        <iframe
          className="visor__frame"
          sandbox=""
          referrerPolicy="no-referrer"
          src={url}
          title={name}
        />
      ) : (
        <VistaCodigo contenido={contenido} lenguaje="markup" />
      )}
    </>
  )
}

const FILAS_POR_PAGINA_CSV = 100

/** Visor interactivo de CSV con filtro vivo, ordenamiento por columna, paginación y vista código. */
function VistaCsv({
  contenido,
  truncado = false,
  consultaInicial
}: {
  contenido: string
  truncado?: boolean
  consultaInicial?: string
}) {
  const [modo, setModo] = useState<'tabla' | 'codigo'>('tabla')
  const [busqueda, setBusqueda] = useState(() =>
    consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : ''
  )
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(0)
  const [copiado, setCopiado] = useState(false)
  const [copiadoFiltrado, setCopiadoFiltrado] = useState(false)
  const copiaTimerRef = useRef<number | null>(null)
  const copiaFiltradoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setBusqueda(consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : '')
    setSortCol(null)
    setSortDir('asc')
    setPagina(0)
    setCopiado(false)
    setCopiadoFiltrado(false)
  }, [contenido, consultaInicial])

  useEffect(() => () => {
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
    if (copiaFiltradoTimerRef.current !== null) window.clearTimeout(copiaFiltradoTimerRef.current)
  }, [])

  const tabla = useMemo(() => parseCsvTable(contenido), [contenido])
  const filtradas = useMemo(
    () => filterAndSortCsvRows(tabla.rows, busqueda, sortCol, sortDir),
    [tabla.rows, busqueda, sortCol, sortDir]
  )

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / FILAS_POR_PAGINA_CSV))
  const paginaSegura = Math.min(pagina, totalPaginas - 1)
  const filasPagina = useMemo(() => {
    const inicio = paginaSegura * FILAS_POR_PAGINA_CSV
    return filtradas.slice(inicio, inicio + FILAS_POR_PAGINA_CSV)
  }, [filtradas, paginaSegura])

  const alOrdenar = (indice: number) => {
    setPagina(0)
    if (sortCol !== indice) {
      setSortCol(indice)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') {
      setSortDir('desc')
      return
    }
    setSortCol(null)
    setSortDir('asc')
  }

  const copiarCsv = async () => {
    if (!contenido) return
    try {
      await navigator.clipboard.writeText(contenido)
      setCopiado(true)
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
      copiaTimerRef.current = window.setTimeout(() => setCopiado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  const copiarVistaFiltrada = async () => {
    if (tabla.headers.length === 0) return
    try {
      const serializado = formatCsvRows(tabla.headers, filtradas)
      await navigator.clipboard.writeText(serializado)
      setCopiadoFiltrado(true)
      if (copiaFiltradoTimerRef.current !== null) window.clearTimeout(copiaFiltradoTimerRef.current)
      copiaFiltradoTimerRef.current = window.setTimeout(() => setCopiadoFiltrado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  return (
    <>
      <div className="visor__json-meta">
        {modo === 'tabla' && (
          <div className="search" style={{ minWidth: 180, flex: '1 1 220px', maxWidth: 340 }}>
            <Search size={14} strokeWidth={ICONO_TRAZO} className="search__icon" />
            <input
              className="input input--search"
              type="search"
              placeholder="Filtrar filas…"
              value={busqueda}
              onChange={(evento) => {
                setBusqueda(evento.target.value)
                setPagina(0)
              }}
            />
          </div>
        )}

        <span className="badge mono">
          {filtradas.length} de {tabla.totalRows} filas · {tabla.headers.length} columnas
        </span>

        {(tabla.truncated || truncado) && (
          <span
            className="badge badge--warn"
            title="La tabla se limita a 5 000 filas por rendimiento; usa Código o abre el archivo si necesitas el resto."
          >
            <TriangleAlert size={11} strokeWidth={2} />
            {tabla.truncated ? 'Limitado a 5 000 filas' : 'Archivo truncado'}
          </span>
        )}

        <span className="spacer" />

        <button
          type="button"
          className={`chip${modo === 'tabla' ? ' chip--active' : ''}`}
          onClick={() => setModo('tabla')}
        >
          <Table size={13} strokeWidth={ICONO_TRAZO} />
          Tabla
        </button>
        <button
          type="button"
          className={`chip${modo === 'codigo' ? ' chip--active' : ''}`}
          onClick={() => setModo('codigo')}
        >
          <Code size={13} strokeWidth={ICONO_TRAZO} />
          Código
        </button>

        {tabla.headers.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarVistaFiltrada()}
            title="Copiar filas visibles según el filtro y orden actual"
          >
            {copiadoFiltrado
              ? <Check size={13} strokeWidth={ICONO_TRAZO} />
              : <Copy size={13} strokeWidth={ICONO_TRAZO} />}
            {copiadoFiltrado ? 'Vista copiada' : `Copiar vista filtrada (${filtradas.length})`}
          </button>
        )}

        {contenido && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarCsv()}
            title="Copiar contenido CSV"
          >
            {copiado
              ? <Check size={13} strokeWidth={ICONO_TRAZO} />
              : <Copy size={13} strokeWidth={ICONO_TRAZO} />}
            {copiado ? 'CSV copiado' : 'Copiar CSV'}
          </button>
        )}
      </div>

      {modo === 'codigo' ? (
        <VistaCodigo contenido={contenido} lenguaje="csv" />
      ) : tabla.headers.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">
            <Table size={20} strokeWidth={ICONO_TRAZO} />
          </div>
          <div className="empty__title">CSV sin datos</div>
          <div className="empty__text">Este archivo CSV no contiene columnas ni filas legibles.</div>
        </div>
      ) : (
        <>
          <div className="visor__csv">
            <table className="table visor__csv-tabla">
              <thead>
                <tr>
                  {tabla.headers.map((cabecera, indice) => {
                    const activa = sortCol === indice
                    const indicador = activa ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
                    const etiqueta = cabecera || `Columna ${indice + 1}`
                    return (
                      <th key={`${indice}-${cabecera}`}>
                        <button
                          type="button"
                          onClick={() => alOrdenar(indice)}
                          title={`Ordenar por ${etiqueta}`}
                        >
                          <span className="truncate">{etiqueta}</span>
                          {indicador && <span className="mono">{indicador}</span>}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filasPagina.length > 0 ? (
                  filasPagina.map((fila, idxFila) => (
                    <tr key={paginaSegura * FILAS_POR_PAGINA_CSV + idxFila}>
                      {tabla.headers.map((_, idxCol) => (
                        <td key={idxCol}>{fila[idxCol] ?? ''}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={tabla.headers.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                      Ninguna fila coincide con «{busqueda}».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filtradas.length > FILAS_POR_PAGINA_CSV && (
            <div className="visor__json-meta">
              <span className="mono">
                Mostrando {paginaSegura * FILAS_POR_PAGINA_CSV + 1}–
                {Math.min((paginaSegura + 1) * FILAS_POR_PAGINA_CSV, filtradas.length)} de{' '}
                {filtradas.length}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={paginaSegura === 0}
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={14} strokeWidth={ICONO_TRAZO} />
                Anterior
              </button>
              <span className="mono">
                Página {paginaSegura + 1} de {totalPaginas}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={paginaSegura >= totalPaginas - 1}
                onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
              >
                Siguiente
                <ChevronRight size={14} strokeWidth={ICONO_TRAZO} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

function VistaJson({
  contenido,
  truncado,
  consultaInicial
}: {
  contenido: string
  truncado: boolean
  consultaInicial?: string
}) {
  const [modo, setModo] = useState<'tarjetas' | 'codigo'>('tarjetas')
  const [busqueda, setBusqueda] = useState(() =>
    consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : ''
  )
  const [copiado, setCopiado] = useState(false)
  const copiaTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setBusqueda(consultaInicial && consultaInicial.trim() ? consultaInicial.trim() : '')
    setCopiado(false)
  }, [contenido, consultaInicial])

  useEffect(() => () => {
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
  }, [])

  // Si el archivo llegó truncado el JSON es inválido por definición: no se intenta parsear.
  const analisis = useMemo(() => {
    if (truncado) {
      return {
        valido: false,
        parsed: null as unknown,
        formateado: contenido,
        resumen: null as ReturnType<typeof summarizeArchiveJson> | null
      }
    }
    try {
      const parsed: unknown = JSON.parse(contenido)
      return {
        valido: true,
        parsed,
        formateado: JSON.stringify(parsed, null, 2),
        resumen: summarizeArchiveJson(parsed)
      }
    } catch {
      return { valido: false, parsed: null as unknown, formateado: contenido, resumen: null }
    }
  }, [contenido, truncado])

  const esExportacionHilo = analisis.valido && analisis.resumen?.kind === 'thread-export'

  const tarjetas = useMemo(
    () => (esExportacionHilo ? extractJsonThreadMessages(analisis.parsed, busqueda) : []),
    [esExportacionHilo, analisis.parsed, busqueda]
  )

  const codigoVisible = useMemo(() => {
    const aguja = normalizar(busqueda.trim())
    if (!aguja) return analisis.formateado
    const coincidencias = analisis.formateado
      .split('\n')
      .filter((linea) => normalizar(linea).includes(aguja))
    return coincidencias.length > 0 ? coincidencias.join('\n') : '// Sin líneas coincidentes'
  }, [analisis.formateado, busqueda])

  const copiarJson = async () => {
    if (!analisis.formateado) return
    try {
      await navigator.clipboard.writeText(analisis.formateado)
      setCopiado(true)
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current)
      copiaTimerRef.current = window.setTimeout(() => setCopiado(false), 1600)
    } catch {
      // Sin permiso de portapapeles.
    }
  }

  return (
    <>
      <div className="visor__json-meta">
        {analisis.valido && analisis.resumen ? (
          analisis.resumen.kind === 'thread-export' ? (
            <>
              <span className="badge badge--accent mono">
                {analisis.resumen.messageCount ?? 0} mensajes
              </span>
              <span className="badge mono">
                {analisis.resumen.authorCount ?? 0} autores
              </span>
              {(analisis.resumen.attachmentCount ?? 0) > 0 && (
                <span className="badge mono">
                  {analisis.resumen.attachmentCount} adjuntos
                </span>
              )}
              {(analisis.resumen.reactionCount ?? 0) > 0 && (
                <span className="badge mono">
                  {analisis.resumen.reactionCount} reacciones
                </span>
              )}
              <span className="badge mono">
                {(analisis.resumen.wordCount ?? 0).toLocaleString('es-ES')} palabras
              </span>
            </>
          ) : (
            <>
              <span className="badge badge--accent">JSON válido</span>
              {analisis.resumen.topKeys.length > 0 && (
                <span className="mono dim">
                  Claves: {analisis.resumen.topKeys.slice(0, 6).join(', ')}
                  {analisis.resumen.topKeys.length > 6
                    ? ` (+${analisis.resumen.topKeys.length - 6})`
                    : ''}
                </span>
              )}
            </>
          )
        ) : (
          <span className="badge badge--warn">
            <TriangleAlert size={11} strokeWidth={2} />
            {truncado ? 'JSON truncado (vista parcial)' : 'JSON con formato no estándar'}
          </span>
        )}

        <div className="search" style={{ minWidth: 180, flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={14} strokeWidth={ICONO_TRAZO} className="search__icon" />
          <input
            className="input input--search"
            type="search"
            placeholder="Filtrar texto o claves…"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </div>

        <span className="spacer" />

        {esExportacionHilo && (
          <>
            <button
              type="button"
              className={`chip${modo === 'tarjetas' ? ' chip--active' : ''}`}
              onClick={() => setModo('tarjetas')}
            >
              Vista tarjetas
            </button>
            <button
              type="button"
              className={`chip${modo === 'codigo' ? ' chip--active' : ''}`}
              onClick={() => setModo('codigo')}
            >
              Código JSON
            </button>
          </>
        )}

        {analisis.formateado && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copiarJson()}
            title="Copiar JSON completo"
          >
            {copiado
              ? <Check size={13} strokeWidth={ICONO_TRAZO} />
              : <Copy size={13} strokeWidth={ICONO_TRAZO} />}
            {copiado ? 'JSON copiado' : 'Copiar JSON'}
          </button>
        )}
      </div>

      {esExportacionHilo && modo === 'tarjetas' ? (
        tarjetas.length > 0 ? (
          <div className="visor__json-cards">
            {tarjetas.map((card) => (
              <article key={card.id} className="visor__json-card">
                <div className="visor__json-card-head">
                  <strong>{card.author}</strong>
                  <div className="visor__json-card-meta">
                    {card.timestamp && <span className="mono dim">{card.timestamp}</span>}
                    <span className="mono dim">#{card.id}</span>
                  </div>
                </div>
                {card.content && <div className="visor__json-card-body">{card.content}</div>}
                {(card.attachmentNames.length > 0 || card.reactionSummary.length > 0) && (
                  <div className="visor__json-card-meta">
                    {card.attachmentNames.map((att, idx) => (
                      <span key={`att-${idx}-${att}`} className="badge mono">
                        {att}
                      </span>
                    ))}
                    {card.reactionSummary.map((rx, idx) => (
                      <span key={`rx-${idx}-${rx}`} className="badge mono">
                        {rx}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty__title">Sin mensajes coincidentes</div>
            <div className="empty__text">
              Ningún mensaje coincide con «{busqueda}».
            </div>
          </div>
        )
      ) : (
        <VistaCodigo contenido={codigoVisible} lenguaje="json" />
      )}
    </>
  )
}

function leerTemaDocumento(): 'light' | 'sepia' | 'dark' {
  if (typeof document !== 'undefined') {
    const actual = document.documentElement.dataset.theme
    if (actual === 'dark' || actual === 'sepia' || actual === 'light') {
      return actual
    }
  }
  return 'dark'
}

function EpubViewer({ path }: { path: string }) {
  const visorRef = useRef<HTMLDivElement | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [titulo, setTitulo] = useState('')
  const [posicion, setPosicion] = useState('')
  const [theme, setTheme] = useState<'light' | 'sepia' | 'dark'>(leerTemaDocumento)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [tamano, setTamano] = useState(100)

  const aplicarTema = useCallback((siguiente: 'light' | 'sepia' | 'dark') => {
    setTheme(siguiente)
    themeRef.current = siguiente
    const rendition = renditionRef.current
    if (!rendition) return
    for (const nombre of ['light', 'sepia', 'dark'] as const) {
      rendition.themes.register(nombre, { body: TEMAS_EPUB[nombre].body })
    }
    rendition.themes.select(siguiente)
  }, [])

  useEffect(() => {
    const alCambiarTema = (evento: Event) => {
      const detalle = (evento as CustomEvent<string>).detail
      const siguiente =
        detalle === 'dark' || detalle === 'sepia' || detalle === 'light'
          ? detalle
          : leerTemaDocumento()
      aplicarTema(siguiente)
    }
    window.addEventListener('dap:theme', alCambiarTema)
    return () => window.removeEventListener('dap:theme', alCambiarTema)
  }, [aplicarTema])

  useEffect(() => {
    const host = visorRef.current
    if (!host) return

    const libro = ePub(window.api.archive.toUrl(path))
    void libro.loaded.metadata.then((meta) => setTitulo(meta.title || ''))

    const rendition = libro.renderTo(host, { width: '100%', height: '100%', flow: 'paginated' })
    renditionRef.current = rendition

    void rendition.display().then(() => aplicarTema(themeRef.current))

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
            className={`btn btn--sm${theme === nombre ? '' : ' btn--ghost'}`}
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
