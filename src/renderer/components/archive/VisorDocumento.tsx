// ============================================================
// Visor de documento — Markdown exportado con tipografía de
// lectura: ancho de línea corto, tablas reales, imágenes con
// pie. El bloque de metadatos del export queda plegado.
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import type { MouseEvent as EventoRaton } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
// @ts-ignore - Soporte para HTML sin procesar en markdown
import rehypeRaw from 'rehype-raw'

const ICONO_TRAZO = 1.8

/** Esquemas que no se resuelven como archivo local ni se abren fuera. */
const ESQUEMAS_PERMITIDOS = /^(https?:|archive:|data:|blob:|mailto:|#)/i

interface PropsVisor {
  /** Markdown ya leído del disco. */
  contenido: string
  /** Ruta del archivo, para resolver `assets/...` contra su carpeta. */
  ruta: string
  /** Abre una imagen del documento a pantalla completa. */
  onAmpliar?: (url: string) => void
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

export default function VisorDocumento({ contenido, ruta, onAmpliar }: PropsVisor) {
  const [metadatosAbiertos, setMetadatosAbiertos] = useState(false)

  const { metadatos, cuerpo } = useMemo(() => partirDocumento(contenido), [contenido])

  const transformarUrl = useCallback((url: string) => resolverAsset(url, ruta), [ruta])

  const componentes = useMemo<Components>(() => ({
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
        if (href && /^https?:/i.test(href)) void window.api.app.openExternal(href)
      }
      return (
        <a href={href} onClick={alPulsar} title={href}>
          {children}
        </a>
      )
    }
  }), [onAmpliar])

  return (
    <div className="visor__doc">
      {metadatos.length > 0 && (
        <div className="row">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setMetadatosAbiertos((valor) => !valor)}
            aria-expanded={metadatosAbiertos}
          >
            {metadatosAbiertos
              ? <ChevronDown size={14} strokeWidth={ICONO_TRAZO} />
              : <ChevronRight size={14} strokeWidth={ICONO_TRAZO} />}
            {metadatosAbiertos ? 'Ocultar metadatos' : 'Ver metadatos'}
          </button>
        </div>
      )}

      {metadatosAbiertos && (
        <pre className="mono">
          {metadatos
            .map((linea) => linea.replace(/^>\s?/, '').replace(/^-{3}$/, '').trimEnd())
            .filter((linea) => linea.length > 0)
            .join('\n')}
        </pre>
      )}

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={transformarUrl}
        components={componentes}
      >
        {cuerpo}
      </ReactMarkdown>
    </div>
  )
}
