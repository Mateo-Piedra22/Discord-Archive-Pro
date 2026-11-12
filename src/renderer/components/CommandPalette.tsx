// ============================================================
// Paleta de comandos: cualquier acción a dos teclas de distancia.
// Se abre con Ctrl+K y no depende del ratón.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Archive,
  Compass,
  DownloadCloud,
  FileSearch,
  FolderOpen,
  FolderSearch,
  Hash,
  Info,
  Keyboard,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import type { Vista } from '../stores/uiStore'
import { useBrowserStore } from '../stores/browserStore'
import { useDownloadStore } from '../stores/downloadStore'

/** Clave del tema compartida con el resto de la aplicación. */
const TEMA_KEY = 'ui_theme'

/** Orden fijo de los grupos en la lista. */
const GRUPOS = ['Ir a', 'Servidores', 'Acciones'] as const

interface Accion {
  id: string
  grupo: string
  etiqueta: string
  /** Combinación que la ejecuta sin pasar por aquí. */
  atajo?: string
  Icono?: LucideIcon
  /** Icono remoto de un servidor (CDN de Discord). */
  iconoUrl?: string
  ejecutar: () => void
}

/** Quita acentos y mayúsculas para comparar de forma tolerante. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Alterna el tema y lo deja guardado, igual que hace Ajustes. */
function alternarTema(): void {
  const actual = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const siguiente = actual === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = siguiente
  localStorage.setItem(TEMA_KEY, siguiente)
}

export default function CommandPalette() {
  const paletaAbierta = useUiStore((s) => s.paletaAbierta)
  const setPaleta = useUiStore((s) => s.setPaleta)
  const setVista = useUiStore((s) => s.setVista)
  const setAtajos = useUiStore((s) => s.setAtajos)
  const setBusqueda = useUiStore((s) => s.setBusqueda)

  const guilds = useBrowserStore((s) => s.guilds)
  const selectGuild = useBrowserStore((s) => s.selectGuild)
  const fetchGuilds = useBrowserStore((s) => s.fetchGuilds)

  const pauseAll = useDownloadStore((s) => s.pauseAll)
  const resumeAll = useDownloadStore((s) => s.resumeAll)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)
  const pickDirectory = useDownloadStore((s) => s.pickDirectory)

  const [consulta, setConsulta] = useState('')
  const [activo, setActivo] = useState(0)
  const campoRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([])

  const irA = (vista: Vista) => () => setVista(vista)

  // Todas las acciones disponibles, con su grupo y su atajo.
  const acciones = useMemo<Accion[]>(() => {
    const vistas: Accion[] = [
      {
        id: 'vista-panel',
        grupo: 'Ir a',
        etiqueta: 'Panel',
        atajo: 'Ctrl+1',
        Icono: LayoutDashboard,
        ejecutar: irA('panel')
      },
      {
        id: 'vista-explorar',
        grupo: 'Ir a',
        etiqueta: 'Explorar',
        atajo: 'Ctrl+2',
        Icono: Compass,
        ejecutar: irA('explorar')
      },
      {
        id: 'vista-cola',
        grupo: 'Ir a',
        etiqueta: 'Cola',
        atajo: 'Ctrl+3',
        Icono: DownloadCloud,
        ejecutar: irA('cola')
      },
      {
        id: 'vista-archivo',
        grupo: 'Ir a',
        etiqueta: 'Archivo',
        atajo: 'Ctrl+4',
        Icono: Archive,
        ejecutar: irA('archivo')
      },
      {
        id: 'vista-ajustes',
        grupo: 'Ir a',
        etiqueta: 'Ajustes',
        atajo: 'Ctrl+5',
        Icono: Settings2,
        ejecutar: irA('ajustes')
      },
      {
        id: 'vista-legal',
        grupo: 'Ir a',
        etiqueta: 'Legal',
        atajo: 'Ctrl+6',
        Icono: Info,
        ejecutar: irA('legal')
      }
    ]

    // Solo los primeros servidores: la lista se vuelve inmanejable después.
    const servidores: Accion[] = guilds.slice(0, 8).map((guild) => ({
      id: `servidor-${guild.id}`,
      grupo: 'Servidores',
      etiqueta: guild.name,
      iconoUrl: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
        : undefined,
      Icono: guild.id === '@me' ? MessageSquare : Hash,
      ejecutar: () => {
        selectGuild(guild)
        setVista('explorar')
      }
    }))

    const accionesSueltas: Accion[] = [
      {
        id: 'accion-actualizar',
        grupo: 'Acciones',
        etiqueta: 'Actualizar servidores',
        Icono: RefreshCw,
        ejecutar: () => {
          void fetchGuilds()
        }
      },
      {
        id: 'accion-carpeta',
        grupo: 'Acciones',
        etiqueta: 'Elegir carpeta de destino',
        Icono: FolderSearch,
        ejecutar: () => {
          void pickDirectory()
        }
      },
      {
        id: 'accion-abrir-carpeta',
        grupo: 'Acciones',
        etiqueta: 'Abrir carpeta de descargas',
        Icono: FolderOpen,
        ejecutar: () => openOutputFolder()
      },
      {
        id: 'accion-pausar',
        grupo: 'Acciones',
        etiqueta: 'Pausar la cola',
        Icono: Pause,
        ejecutar: () => pauseAll()
      },
      {
        id: 'accion-reanudar',
        grupo: 'Acciones',
        etiqueta: 'Reanudar la cola',
        Icono: Play,
        ejecutar: () => resumeAll()
      },
      {
        id: 'accion-buscar',
        grupo: 'Acciones',
        etiqueta: 'Buscar en el archivo',
        atajo: 'Ctrl+F',
        Icono: FileSearch,
        ejecutar: () => setBusqueda(true)
      },
      {
        id: 'accion-atajos',
        grupo: 'Acciones',
        etiqueta: 'Ver atajos de teclado',
        atajo: 'Ctrl+/',
        Icono: Keyboard,
        ejecutar: () => setAtajos(true)
      },
      {
        id: 'accion-tema',
        grupo: 'Acciones',
        etiqueta: 'Cambiar tema',
        Icono: Moon,
        ejecutar: () => alternarTema()
      }
    ]

    return [...vistas, ...servidores, ...accionesSueltas]
  }, [guilds, selectGuild, fetchGuilds, pickDirectory, openOutputFolder, pauseAll, resumeAll, setAtajos, setBusqueda, setVista])

  // Filtro tolerante a acentos; los grupos vacíos desaparecen.
  const grupos = useMemo(() => {
    const busqueda = normalizar(consulta.trim())
    const visibles = busqueda
      ? acciones.filter((accion) => normalizar(accion.etiqueta).includes(busqueda))
      : acciones
    return GRUPOS.map((nombre) => ({
      nombre,
      acciones: visibles.filter((accion) => accion.grupo === nombre)
    })).filter((grupo) => grupo.acciones.length > 0)
  }, [acciones, consulta])

  const plano = useMemo(() => grupos.flatMap((grupo) => grupo.acciones), [grupos])

  // Al abrir se limpia la búsqueda y se enfoca el campo.
  useEffect(() => {
    if (!paletaAbierta) return
    setConsulta('')
    setActivo(0)
    campoRef.current?.focus()
  }, [paletaAbierta])

  // La selección nunca queda fuera de la lista filtrada.
  useEffect(() => {
    setActivo((previo) => (previo >= plano.length ? 0 : previo))
  }, [plano.length])

  // La fila activa siempre se mantiene a la vista.
  useEffect(() => {
    itemsRef.current[activo]?.scrollIntoView({ block: 'nearest' })
  }, [activo, plano.length])

  if (!paletaAbierta) return null

  const cerrar = () => setPaleta(false)

  const ejecutarAccion = (accion: Accion | undefined) => {
    if (!accion) return
    accion.ejecutar()
    cerrar()
  }

  const mover = (paso: number) => {
    if (plano.length === 0) return
    setActivo((previo) => (previo + paso + plano.length) % plano.length)
  }

  const alPulsarTecla = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      mover(1)
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      mover(-1)
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      ejecutarAccion(plano[activo])
    } else if (evento.key === 'Escape') {
      evento.preventDefault()
      cerrar()
    }
  }

  return (
    <div className="scrim" onClick={cerrar}>
      <div
        className="dialogo"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onClick={(evento) => evento.stopPropagation()}
        onKeyDown={alPulsarTecla}
      >
        <div className="paleta__campo">
          <div className="search spacer">
            <Search size={15} strokeWidth={1.8} className="search__icon" />
            <input
              ref={campoRef}
              className="input input--search"
              type="text"
              autoFocus
              value={consulta}
              placeholder="Buscar acciones, servidores o canales…"
              onChange={(evento) => {
                setConsulta(evento.target.value)
                setActivo(0)
              }}
            />
          </div>
          <span className="kbd">Esc</span>
        </div>

        <div className="paleta__lista">
          {plano.length === 0 && (
            <div className="empty">
              <span className="muted">Sin resultados</span>
            </div>
          )}

          {grupos.map((grupo) => {
            const desde = plano.indexOf(grupo.acciones[0])
            return (
              <div key={grupo.nombre}>
                <div className="paleta__grupo">{grupo.nombre}</div>
                {grupo.acciones.map((accion, indice) => {
                  const posicion = desde + indice
                  const activa = posicion === activo
                  const Icono = accion.Icono
                  return (
                    <button
                      key={accion.id}
                      ref={(nodo) => {
                        itemsRef.current[posicion] = nodo
                      }}
                      type="button"
                      className={`paleta__item${activa ? ' paleta__item--activo' : ''}`}
                      onMouseEnter={() => setActivo(posicion)}
                      onClick={() => ejecutarAccion(accion)}
                    >
                      {accion.iconoUrl ? (
                        <img src={accion.iconoUrl} alt="" width={16} height={16} />
                      ) : Icono ? (
                        <Icono size={15} strokeWidth={1.8} />
                      ) : null}
                      <span className="truncate">{accion.etiqueta}</span>
                      <span className="spacer" />
                      {accion.atajo && <span className="kbd">{accion.atajo}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
