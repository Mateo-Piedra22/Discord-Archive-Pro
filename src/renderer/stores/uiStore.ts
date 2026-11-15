import { create } from 'zustand'

/** Vistas de primer nivel del riel. */
export type Vista = 'panel' | 'explorar' | 'cola' | 'archivo' | 'ajustes' | 'legal'

export interface HiloAbierto {
  threadId: string
  nombre: string
  canal: string
  servidor: string
}

interface UiState {
  vista: Vista
  /** Hilo abierto en el visor en vivo (sin descargar). */
  hilo: HiloAbierto | null
  paletaAbierta: boolean
  atajosAbiertos: boolean
  busquedaAbierta: boolean
  /** Archivo que la búsqueda global quiere abrir dentro del visor. */
  archivoInicial: string | null
  /** Consulta de búsqueda inicial transferida al visor integrado. */
  consultaInicial: string | null
  /** Servidor inicial que se filtra o resalta al abrir el visor integrado. */
  servidorInicial: string | null

  setVista: (vista: Vista) => void
  abrirHilo: (hilo: HiloAbierto) => void
  cerrarHilo: () => void
  setPaleta: (abierta: boolean) => void
  setAtajos: (abiertos: boolean) => void
  setBusqueda: (abierta: boolean) => void
  /** Abre el archivo dentro de la app, sin lanzar el programa del sistema. */
  abrirArchivo: (ruta: string, consulta?: string) => void
  /** Abre el visor integrado filtrando las colecciones por servidor. */
  abrirArchivoServidor: (servidor: string) => void
  consumirArchivoInicial: () => void
  consumirConsultaInicial: () => void
  consumirServidorInicial: () => void
  cerrarCapas: () => void
}

export const useUiStore = create<UiState>((set) => ({
  // La app abre en el Panel: responde «qué tengo archivado» antes que nada.
  vista: 'panel',
  hilo: null,
  paletaAbierta: false,
  atajosAbiertos: false,
  busquedaAbierta: false,
  archivoInicial: null,
  consultaInicial: null,
  servidorInicial: null,

  setVista: (vista) => set({ vista, hilo: null }),
  abrirHilo: (hilo) => set({ hilo }),
  cerrarHilo: () => set({ hilo: null }),
  setPaleta: (paletaAbierta) => set({ paletaAbierta }),
  setAtajos: (atajosAbiertos) => set({ atajosAbiertos }),
  setBusqueda: (busquedaAbierta) => set({ busquedaAbierta }),
  abrirArchivo: (ruta, consulta) =>
    set({
      vista: 'archivo',
      archivoInicial: ruta,
      consultaInicial: consulta?.trim() ? consulta.trim() : null,
      hilo: null,
      busquedaAbierta: false
    }),
  abrirArchivoServidor: (servidor) =>
    set({
      vista: 'archivo',
      archivoInicial: null,
      consultaInicial: null,
      servidorInicial: servidor.trim() ? servidor.trim() : null,
      hilo: null,
      busquedaAbierta: false
    }),
  consumirArchivoInicial: () => set({ archivoInicial: null }),
  consumirConsultaInicial: () => set({ consultaInicial: null }),
  consumirServidorInicial: () => set({ servidorInicial: null }),
  cerrarCapas: () => set({ paletaAbierta: false, atajosAbiertos: false, busquedaAbierta: false, hilo: null })
}))
