// ============================================================
// Colecciones — Detección automática de lo que hay en la carpeta
// de salida. Cada carpeta que contiene post.md, thread.md,
// index.md, post.html, post.json, post.csv, messages.csv,
// export.pdf o export.epub es una colección: una publicación
// exportada.
// ============================================================

import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ArchiveFileEntry } from '../../../shared/api'

const ICONO_TRAZO = 1.8

/** Colecciones visibles por tramo antes de mostrar «Cargar más». */
export const TAMANO_PAGINA_COLECCIONES = 60

/** Extensiones que se muestran como imagen en portada y galería. */
export const EXT_IMAGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']

/** Extensiones de vídeo reproducibles en la galería multimedia. */
export const EXT_VIDEO = ['mp4', 'webm', 'mov', 'mkv', 'ogv']

/** Extensiones de audio reproducibles en la galería multimedia. */
export const EXT_AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']

/** Archivos que marcan una carpeta como colección. */
const MARCAS = new Set([
  'index.md',
  'post.md',
  'thread.md',
  'post.html',
  'post.json',
  'post.csv',
  'messages.csv',
  'export.pdf',
  'export.epub'
])

/** Orden de preferencia para el documento que abre la colección. */
const ORDEN_DOCUMENTO = [
  'post.md',
  'thread.md',
  'index.md',
  'post.html',
  'post.json',
  'post.csv',
  'messages.csv',
  'export.pdf',
  'export.epub'
]

const ETIQUETAS_FORMATO: Record<string, string> = {
  'post.md': 'MD',
  'thread.md': 'HILO',
  'index.md': 'ÍNDICE',
  'post.html': 'HTML',
  'post.json': 'JSON',
  'post.csv': 'CSV',
  'messages.csv': 'CSV',
  'export.pdf': 'PDF',
  'export.epub': 'EPUB'
}

function etiquetaFormato(nombre: string, tienePostCsv: boolean): string {
  const clave = nombre.toLowerCase()
  if (clave === 'messages.csv' && tienePostCsv) return 'CSV · MSGS'
  return ETIQUETAS_FORMATO[clave] ?? nombre.toUpperCase()
}

/** Formato de fecha del archivo, en español y sin ceros a la izquierda. */
const FORMATO_FECHA = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

export interface Coleccion {
  /** Ruta absoluta de la carpeta de la publicación. */
  ruta: string
  /** Nombre crudo de la carpeta. */
  nombre: string
  /** Título legible, sin prefijo numérico ni fecha. */
  titulo: string
  /** Servidor de Discord, cuando la estructura lo permite deducir. */
  servidor: string
  /** Canal o foro donde se publicó. */
  canal: string
  /** Momento de publicación en milisegundos (0 si no se pudo deducir). */
  fecha: number
  /** Documentos markdown de la publicación. */
  documentos: number
  /** Mensajes del hilo, contando el original. */
  mensajes: number
  /** Archivos .md dentro de `replies/`, ordenados numéricamente. */
  respuestasArchivos: ArchiveFileEntry[]
  /** Imágenes encontradas en toda la carpeta. */
  imagenes: ArchiveFileEntry[]
  /** Todos los archivos multimedia (imágenes, vídeos y audio) de la colección. */
  multimedia: ArchiveFileEntry[]
  /** Formatos exportados encontrados en la raíz de la colección, ordenados según preferencia. */
  formatos: ArchiveFileEntry[]
  /** Peso total en bytes. */
  bytes: number
  /** Primera imagen de `assets/`, si existe. */
  portada: string | null
  /** Documento que se abre por defecto. */
  principal: ArchiveFileEntry | null
  /** Nodo del árbol, para recorrer la carpeta sin volver a escanear. */
  nodo: ArchiveFileEntry
}

/** Minúsculas y sin acentos: permite buscar «diseño» escribiendo «diseno». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

export function textoFecha(ms: number): string {
  return ms > 0 ? FORMATO_FECHA.format(new Date(ms)) : 'Sin fecha'
}

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.')
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : ''
}

/** Ruta relativa a la raíz, siempre con separadores `/`. */
function relativa(ruta: string, raiz: string): string {
  const archivo = ruta.replace(/\\/g, '/')
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '')
  return base && archivo.startsWith(base) ? archivo.slice(base.length).replace(/^\/+/, '') : archivo
}

/** Fecha de publicación deducida del nombre de la carpeta. */
function fechaDeNombre(nombre: string): number {
  const patrones: RegExp[] = [
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{2})-(\d{2})-(\d{4})/,
    /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/
  ]

  for (const [indice, patron] of patrones.entries()) {
    const coincidencia = patron.exec(nombre)
    if (!coincidencia) continue

    const [, a, b, c] = coincidencia
    // El segundo patrón viene como DD-MM-YYYY.
    const anio = indice === 1 ? Number(c) : Number(a)
    const mes = Number(b)
    const dia = indice === 1 ? Number(a) : Number(c)

    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) continue
    const fecha = new Date(anio, mes - 1, dia)
    if (!Number.isNaN(fecha.getTime())) return fecha.getTime()
  }

  return 0
}

/** Quita numeración y fecha del nombre de carpeta para dejar un título. */
function tituloDeCarpeta(nombre: string): string {
  const limpio = nombre
    .replace(/^\d{3}[_\-\s]+/, '')
    .replace(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|(?<!\d)\d{8}(?!\d)/, '')
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '')
    .replace(/_/g, ' ')
    .trim()

  return limpio || nombre
}

/** Etiqueta del canal: los meses de la estructura por fecha no llevan `#`. */
export function etiquetaCanal(canal: string): string {
  if (!canal) return ''
  return /^\d{4}-\d{2}$/.test(canal) ? canal : `#${canal}`
}

interface Medidas {
  bytes: number
  documentos: number
  respuestas: number
  respuestasArchivos: ArchiveFileEntry[]
  imagenes: ArchiveFileEntry[]
  multimedia: ArchiveFileEntry[]
}

function medir(nodo: ArchiveFileEntry): Medidas {
  const medidas: Medidas = {
    bytes: 0,
    documentos: 0,
    respuestas: 0,
    respuestasArchivos: [],
    imagenes: [],
    multimedia: []
  }

  const recorrer = (entradas: ArchiveFileEntry[]): void => {
    for (const entrada of entradas) {
      if (entrada.type === 'dir') {
        recorrer(entrada.children ?? [])
        continue
      }
      medidas.bytes += entrada.size ?? 0
      if (MARCAS.has(entrada.name.toLowerCase())) medidas.documentos++
      const ext = extensionDe(entrada.name)
      if (EXT_IMAGEN.includes(ext)) {
        medidas.imagenes.push(entrada)
        medidas.multimedia.push(entrada)
      } else if (EXT_VIDEO.includes(ext) || EXT_AUDIO.includes(ext)) {
        medidas.multimedia.push(entrada)
      }
    }
  }

  recorrer(nodo.children ?? [])

  // Cada respuesta individual se guarda como un .md dentro de `replies/`.
  const respuestas = (nodo.children ?? []).find((hijo) => hijo.type === 'dir' && hijo.name === 'replies')
  const respuestasArchivos = (respuestas?.children ?? [])
    .filter((hijo) => hijo.type === 'file' && extensionDe(hijo.name) === 'md')
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
  medidas.respuestas = respuestasArchivos.length
  medidas.respuestasArchivos = respuestasArchivos

  return medidas
}

/** Primera imagen de `assets/`; si no hay, la primera de la carpeta. */
function primeraImagen(nodo: ArchiveFileEntry): string | null {
  const buscar = (entradas: ArchiveFileEntry[]): string | null => {
    for (const entrada of entradas) {
      if (entrada.type === 'dir') {
        const encontrada = buscar(entrada.children ?? [])
        if (encontrada) return encontrada
      } else if (EXT_IMAGEN.includes(extensionDe(entrada.name))) {
        return entrada.path
      }
    }
    return null
  }

  const assets = (nodo.children ?? []).find((hijo) => hijo.type === 'dir' && hijo.name === 'assets')
  return assets ? buscar(assets.children ?? []) : buscar(nodo.children ?? [])
}

/** Recorre el árbol y devuelve las colecciones ordenadas de más nueva a más vieja. */
export function detectarColecciones(arbol: ArchiveFileEntry[], raiz: string): Coleccion[] {
  const colecciones: Coleccion[] = []

  const visitar = (entradas: ArchiveFileEntry[]): void => {
    for (const nodo of entradas) {
      if (nodo.type !== 'dir') continue

      const archivos = (nodo.children ?? []).filter((hijo) => hijo.type === 'file')
      const marcas = archivos.filter((hijo) => MARCAS.has(hijo.name.toLowerCase()))

      if (marcas.length > 0) {
        const medidas = medir(nodo)
        const partes = relativa(nodo.path, raiz).split('/').filter(Boolean)
        const formatos = ORDEN_DOCUMENTO
          .map((nombre) => archivos.find((hijo) => hijo.name.toLowerCase() === nombre))
          .filter((hijo): hijo is ArchiveFileEntry => Boolean(hijo))
        const principal = formatos[0] ?? null

        colecciones.push({
          ruta: nodo.path,
          nombre: nodo.name,
          titulo: tituloDeCarpeta(nodo.name),
          servidor: partes.length >= 3 ? partes[0] : '',
          canal: partes.length >= 2 ? partes[partes.length - 2] : '',
          fecha: fechaDeNombre(nodo.name),
          documentos: medidas.documentos,
          mensajes: medidas.respuestas + (principal ? 1 : 0),
          respuestasArchivos: medidas.respuestasArchivos,
          imagenes: medidas.imagenes,
          multimedia: medidas.multimedia,
          formatos,
          bytes: medidas.bytes,
          portada: primeraImagen(nodo),
          principal,
          nodo
        })
      }

      visitar(nodo.children ?? [])
    }
  }

  visitar(arbol)

  return colecciones.sort(
    (a, b) => b.fecha - a.fecha || a.titulo.localeCompare(b.titulo, 'es')
  )
}

interface PropsColecciones {
  colecciones: Coleccion[]
  onAbrir: (coleccion: Coleccion) => void
}

export default function Colecciones({ colecciones, onAbrir }: PropsColecciones) {
  const [limiteVisible, setLimiteVisible] = useState(TAMANO_PAGINA_COLECCIONES)

  // Al cambiar la lista filtrada u ordenada, volvemos al primer tramo.
  useEffect(() => {
    setLimiteVisible(TAMANO_PAGINA_COLECCIONES)
  }, [colecciones])

  const visibles =
    colecciones.length > limiteVisible ? colecciones.slice(0, limiteVisible) : colecciones

  return (
    <>
      <div className="colecciones">
        {visibles.map((coleccion) => {
          const canal = etiquetaCanal(coleccion.canal)
          const tienePostCsv = coleccion.formatos.some(
            (fmt) => fmt.name.toLowerCase() === 'post.csv'
          )
          const otrosMedios = coleccion.multimedia.length - coleccion.imagenes.length

          return (
            <div
              key={coleccion.ruta}
              className="coleccion"
              role="button"
              tabIndex={0}
              onClick={() => onAbrir(coleccion)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') {
                  evento.preventDefault()
                  onAbrir(coleccion)
                }
              }}
              title={coleccion.ruta}
            >
              {coleccion.portada ? (
                <img
                  className="coleccion__portada"
                  src={window.api.archive.toUrl(coleccion.portada)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="coleccion__portada" aria-hidden="true" />
              )}

              <div className="coleccion__cuerpo">
                <div className="coleccion__titulo truncate">{coleccion.titulo}</div>

                <div className="coleccion__meta truncate">
                  {[canal, coleccion.servidor].filter(Boolean).join(' · ') || 'Archivo local'}
                </div>

                <div className="coleccion__meta truncate">
                  {textoFecha(coleccion.fecha)} · {coleccion.mensajes} mensajes ·{' '}
                  {formatearBytes(coleccion.bytes)}
                </div>

                <div className="coleccion__meta truncate">
                  {coleccion.documentos}{' '}
                  {coleccion.documentos === 1 ? 'publicación' : 'publicaciones'} ·{' '}
                  {coleccion.imagenes.length}{' '}
                  {coleccion.imagenes.length === 1 ? 'imagen' : 'imágenes'}
                  {otrosMedios > 0 && ` · ${otrosMedios} ${otrosMedios === 1 ? 'medio' : 'medios'}`}
                </div>

                {coleccion.formatos.length > 0 && (
                  <div className="coleccion__formatos">
                    {coleccion.formatos.map((fmt) => (
                      <span key={fmt.path} className="coleccion__formato-tag">
                        {etiquetaFormato(fmt.name, tienePostCsv)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="coleccion__acciones">
                <ChevronRight size={15} strokeWidth={ICONO_TRAZO} className="dim" />
              </div>
            </div>
          )
        })}
      </div>

      {colecciones.length > limiteVisible && (
        <div
          className="row"
          style={{
            justifyContent: 'center',
            padding: 'var(--sp-3) var(--sp-5)',
            borderTop: '1px solid var(--line-soft)',
            flexShrink: 0
          }}
        >
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setLimiteVisible((prev) =>
                Math.min(colecciones.length, prev + TAMANO_PAGINA_COLECCIONES)
              )
            }
          >
            Cargar más (mostrando {visibles.length} de {colecciones.length})
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setLimiteVisible(colecciones.length)}
          >
            Mostrar todas
          </button>
        </div>
      )}
    </>
  )
}
