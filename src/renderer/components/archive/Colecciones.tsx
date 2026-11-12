// ============================================================
// Colecciones — Detección automática de lo que hay en la carpeta
// de salida. Cada carpeta que contiene post.md, thread.md o
// index.md es una colección: una publicación exportada.
// ============================================================

import { ChevronRight } from 'lucide-react'
import type { ArchiveFileEntry } from '../../../shared/api'

const ICONO_TRAZO = 1.8

/** Extensiones que se muestran como imagen en portada y galería. */
export const EXT_IMAGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']

/** Archivos que marcan una carpeta como colección. */
const MARCAS = new Set(['index.md', 'post.md', 'thread.md'])

/** Orden de preferencia para el documento que abre la colección. */
const ORDEN_DOCUMENTO = ['post.md', 'thread.md', 'index.md']

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
  /** Imágenes encontradas en toda la carpeta. */
  imagenes: ArchiveFileEntry[]
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
  imagenes: ArchiveFileEntry[]
}

function medir(nodo: ArchiveFileEntry): Medidas {
  const medidas: Medidas = { bytes: 0, documentos: 0, respuestas: 0, imagenes: [] }

  const recorrer = (entradas: ArchiveFileEntry[]): void => {
    for (const entrada of entradas) {
      if (entrada.type === 'dir') {
        recorrer(entrada.children ?? [])
        continue
      }
      medidas.bytes += entrada.size ?? 0
      if (MARCAS.has(entrada.name.toLowerCase())) medidas.documentos++
      if (EXT_IMAGEN.includes(extensionDe(entrada.name))) medidas.imagenes.push(entrada)
    }
  }

  recorrer(nodo.children ?? [])

  // Cada respuesta individual se guarda como un .md dentro de `replies/`.
  const respuestas = (nodo.children ?? []).find((hijo) => hijo.type === 'dir' && hijo.name === 'replies')
  medidas.respuestas = (respuestas?.children ?? []).filter(
    (hijo) => hijo.type === 'file' && extensionDe(hijo.name) === 'md'
  ).length

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
        const principal =
          ORDEN_DOCUMENTO
            .map((nombre) => archivos.find((hijo) => hijo.name.toLowerCase() === nombre))
            .find((hijo): hijo is ArchiveFileEntry => Boolean(hijo)) ?? null

        colecciones.push({
          ruta: nodo.path,
          nombre: nodo.name,
          titulo: tituloDeCarpeta(nodo.name),
          servidor: partes.length >= 3 ? partes[0] : '',
          canal: partes.length >= 2 ? partes[partes.length - 2] : '',
          fecha: fechaDeNombre(nodo.name),
          documentos: medidas.documentos,
          mensajes: medidas.respuestas + (principal ? 1 : 0),
          imagenes: medidas.imagenes,
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
  return (
    <div className="colecciones">
      {colecciones.map((coleccion) => {
        const canal = etiquetaCanal(coleccion.canal)

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
              </div>
            </div>

            <div className="coleccion__acciones">
              <ChevronRight size={15} strokeWidth={ICONO_TRAZO} className="dim" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
