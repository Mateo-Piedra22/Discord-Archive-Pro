// ============================================================
// Paleta de comandos: cualquier acción a dos teclas de distancia.
// Se abre con Ctrl+K y no depende del ratón.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Archive,
  BookOpen,
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
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import type { Vista } from '../stores/uiStore'
import { useBrowserStore } from '../stores/browserStore'
import { useDownloadStore } from '../stores/downloadStore'
import type { DownloadHistoryRecord } from '../../core/discord/types'
import { showToast } from './Toast'

type TemaApp = 'dark' | 'light' | 'sepia'

/** Clave del tema compartida con el resto de la aplicación. */
const TEMA_KEY = 'ui_theme'

/** Orden fijo de los grupos en la lista. */
const GRUPOS = ['Ir a', 'Archivo reciente', 'Servidores', 'Canales', 'Acciones'] as const

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

function leerTemaActual(): TemaApp {
  const valor = document.documentElement.dataset.theme || localStorage.getItem(TEMA_KEY)
  return valor === 'light' || valor === 'sepia' ? valor : 'dark'
}

/** Aplica el tema indicado y notifica a la ventana para mantener sincronía. */
function aplicarTema(next: TemaApp): void {
  document.documentElement.dataset.theme = next
  localStorage.setItem(TEMA_KEY, next)
  window.dispatchEvent(new CustomEvent<TemaApp>('dap:theme', { detail: next }))
}

/** Rota entre los tres temas editoriales (oscuro → claro → sepia → oscuro). */
function ciclarTema(): void {
  const actual = leerTemaActual()
  const siguiente: TemaApp =
    actual === 'dark' ? 'light' : actual === 'light' ? 'sepia' : 'dark'
  aplicarTema(siguiente)
}

export default function CommandPalette() {
  const paletaAbierta = useUiStore((s) => s.paletaAbierta)
  const setPaleta = useUiStore((s) => s.setPaleta)
  const setVista = useUiStore((s) => s.setVista)
  const setAtajos = useUiStore((s) => s.setAtajos)
  const setBusqueda = useUiStore((s) => s.setBusqueda)

  const guilds = useBrowserStore((s) => s.guilds)
  const channels = useBrowserStore((s) => s.channels)
  const selectGuild = useBrowserStore((s) => s.selectGuild)
  const selectChannel = useBrowserStore((s) => s.selectChannel)
  const fetchGuilds = useBrowserStore((s) => s.fetchGuilds)

  const pauseAll = useDownloadStore((s) => s.pauseAll)
  const resumeAll = useDownloadStore((s) => s.resumeAll)
  const openOutputFolder = useDownloadStore((s) => s.openOutputFolder)
  const pickDirectory = useDownloadStore((s) => s.pickDirectory)

  const [consulta, setConsulta] = useState('')
  const [activo, setActivo] = useState(0)
  const [historialReciente, setHistorialReciente] = useState<DownloadHistoryRecord[]>([])
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

    const rutasVistas = new Set<string>()
    const archivosRecientes: Accion[] = []
    for (const row of historialReciente) {
      if (row.status !== 'done' || !row.download_path) continue
      const claveRuta = row.download_path.replace(/\\/g, '/').toLowerCase()
      if (rutasVistas.has(claveRuta)) continue
      rutasVistas.add(claveRuta)
      const rutaDestino = row.download_path
      const nombreHilo = row.thread_name || row.thread_id
      archivosRecientes.push({
        id: `reciente-${row.id}`,
        grupo: 'Archivo reciente',
        etiqueta: row.guild_name ? `${nombreHilo} · ${row.guild_name}` : nombreHilo,
        Icono: BookOpen,
        ejecutar: () => {
          useUiStore.getState().abrirArchivo(rutaDestino)
        }
      })
    }

    const servidores: Accion[] = guilds.map((guild) => ({
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

    const canalesActivos: Accion[] = channels
      .filter((ch) => ch.type !== 4)
      .map((channel) => ({
        id: `canal-${channel.id}`,
        grupo: 'Canales',
        etiqueta: `#${channel.name || channel.id}`,
        Icono: Hash,
        ejecutar: () => {
          selectChannel(channel)
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
        etiqueta: 'Cambiar tema (Oscuro / Claro / Sepia)',
        Icono: Palette,
        ejecutar: () => ciclarTema()
      },
      {
        id: 'accion-tema-dark',
        grupo: 'Acciones',
        etiqueta: 'Tema: Tinta oscura',
        Icono: Moon,
        ejecutar: () => aplicarTema('dark')
      },
      {
        id: 'accion-tema-light',
        grupo: 'Acciones',
        etiqueta: 'Tema: Papel claro',
        Icono: Sun,
        ejecutar: () => aplicarTema('light')
      },
      {
        id: 'accion-tema-sepia',
        grupo: 'Acciones',
        etiqueta: 'Tema: Pergamino sepia',
        Icono: BookOpen,
        ejecutar: () => aplicarTema('sepia')
      },
      {
        id: 'accion-optimizar-memoria',
        grupo: 'Acciones',
        etiqueta: 'Optimizar memoria y caché',
        Icono: Sparkles,
        ejecutar: () => {
          void window.api.app
            .optimizeMemory()
            .then((res) => {
              showToast(`Memoria optimizada (${res.cachesCleared} entradas liberadas)`, 'success')
            })
            .catch((error) => {
              showToast(
                error instanceof Error ? error.message : 'No se pudo optimizar la memoria',
                'error'
              )
            })
        }
      },
      {
        id: 'accion-verificar-integridad',
        grupo: 'Acciones',
        etiqueta: 'Verificar integridad de caché y BD',
        Icono: ShieldCheck,
        ejecutar: () => {
          void window.api.cache
            .verifyIntegrity()
            .then((res) => {
              const detalleInvalidados =
                res.invalidatedFiles > 0 ? ` (${res.invalidatedFiles} invalidados)` : ''
              if (res.integrityOk) {
                showToast(
                  `Integridad OK · ${res.checkedFiles} archivos verificados${detalleInvalidados}, ${res.orphanPosts} huérfanos reparados`,
                  'success'
                )
              } else {
                showToast(
                  `Alerta de integridad en la BD · ${res.checkedFiles} archivos verificados${detalleInvalidados}, ${res.orphanPosts} huérfanos reparados`,
                  'warning'
                )
              }
            })
            .catch((error) => {
              showToast(
                error instanceof Error
                  ? error.message
                  : 'No se pudo verificar la integridad de caché y BD',
                'error'
              )
            })
        }
      },
      {
        id: 'accion-reintentar-fallidas',
        grupo: 'Acciones',
        etiqueta: 'Reintentar descargas fallidas',
        Icono: RotateCw,
        ejecutar: () => {
          void useDownloadStore
            .getState()
            .retryAllFailed()
            .then((count) => {
              if (count > 0) {
                showToast(
                  `Reintentando ${count} ${count === 1 ? 'descarga fallida' : 'descargas fallidas'}`,
                  'success'
                )
              } else {
                showToast('No hay descargas fallidas para reintentar', 'info')
              }
            })
            .catch((error) => {
              showToast(
                error instanceof Error
                  ? error.message
                  : 'No se pudieron reintentar las descargas fallidas',
                'error'
              )
            })
        }
      },
      {
        id: 'accion-limpiar-completadas',
        grupo: 'Acciones',
        etiqueta: 'Limpiar descargas completadas',
        Icono: Trash2,
        ejecutar: () => {
          useDownloadStore.getState().clearCompleted()
          showToast('Descargas completadas limpiadas de la cola', 'success')
        }
      }
    ]

    return [...vistas, ...archivosRecientes, ...servidores, ...canalesActivos, ...accionesSueltas]
  }, [
    historialReciente,
    guilds,
    channels,
    selectGuild,
    selectChannel,
    fetchGuilds,
    pickDirectory,
    openOutputFolder,
    pauseAll,
    resumeAll,
    setAtajos,
    setBusqueda,
    setVista
  ])

  // Filtro tolerante a acentos; sin búsqueda acota listas largas a 8 elementos.
  const grupos = useMemo(() => {
    const busqueda = normalizar(consulta.trim())
    const visibles = busqueda
      ? acciones.filter((accion) => normalizar(accion.etiqueta).includes(busqueda))
      : acciones
    return GRUPOS.map((nombre) => {
      const lista = visibles.filter((accion) => accion.grupo === nombre)
      const acotada =
        !busqueda && (nombre === 'Servidores' || nombre === 'Canales' || nombre === 'Archivo reciente')
          ? lista.slice(0, 8)
          : lista
      return { nombre, acciones: acotada }
    }).filter((grupo) => grupo.acciones.length > 0)
  }, [acciones, consulta])

  const plano = useMemo(() => grupos.flatMap((grupo) => grupo.acciones), [grupos])

  // Al abrir se limpia la búsqueda, se enfoca el campo y se carga el historial reciente.
  useEffect(() => {
    if (!paletaAbierta) return
    setConsulta('')
    setActivo(0)
    campoRef.current?.focus()

    let vigente = true
    window.api.download
      .getHistory(15, 0)
      .then((filas) => {
        if (vigente) setHistorialReciente(filas ?? [])
      })
      .catch(() => {
        if (vigente) setHistorialReciente([])
      })
    return () => {
      vigente = false
    }
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
    } else if (evento.key === 'Home') {
      if (plano.length === 0) return
      evento.preventDefault()
      setActivo(0)
    } else if (evento.key === 'End') {
      if (plano.length === 0) return
      evento.preventDefault()
      setActivo(plano.length - 1)
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
