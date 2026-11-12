// ============================================================
// Galería — Todas las imágenes de la colección en una rejilla.
// Cada miniatura se sirve por `archive://` y se carga al verse.
// ============================================================

import type { ArchiveFileEntry } from '../../../shared/api'

interface PropsGaleria {
  imagenes: ArchiveFileEntry[]
  /** Recibe la posición de la imagen pulsada, para abrirla ampliada. */
  onAbrir: (indice: number) => void
}

export default function Galeria({ imagenes, onAbrir }: PropsGaleria) {
  return (
    <div className="visor__galeria">
      {imagenes.map((imagen, indice) => (
        <button
          key={imagen.path}
          type="button"
          className="galeria__item"
          onClick={() => onAbrir(indice)}
          title={imagen.name}
        >
          <img
            className="galeria__img"
            src={window.api.archive.toUrl(imagen.path)}
            alt={imagen.name}
            loading="lazy"
            draggable={false}
          />
        </button>
      ))}
    </div>
  )
}
