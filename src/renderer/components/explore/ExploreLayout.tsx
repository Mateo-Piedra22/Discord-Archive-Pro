import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compass, Hash, LayoutList, MessageSquare } from 'lucide-react'
import { useBrowserStore } from '../../stores/browserStore'
import { isForum, type DiscordChannel, type DiscordGuild } from '../../../core/discord/types'
import RailServidores from './RailServidores'
import SidebarCanales from './SidebarCanales'
import SelectorServidores from './SelectorServidores'
import ChannelChatView from '../ChannelChatView'
import PostList from '../PostList'

type Servidor = DiscordGuild & { isDM?: boolean }

const LS_ULTIMO_SERVIDOR = 'ultimo_servidor'
const LS_ULTIMOS_CANALES = 'ultimos_canales'
const MAX_RECIENTES = 5

interface CanalReciente {
  id: string
  nombre: string
  tipo: number
  guildId: string
}

function leerRecientes(): CanalReciente[] {
  try {
    const crudo = localStorage.getItem(LS_ULTIMOS_CANALES)
    if (!crudo) return []
    const datos = JSON.parse(crudo) as unknown
    if (!Array.isArray(datos)) return []
    return datos
      .filter(
        (item): item is CanalReciente =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as CanalReciente).id === 'string' &&
          typeof (item as CanalReciente).nombre === 'string' &&
          typeof (item as CanalReciente).tipo === 'number' &&
          typeof (item as CanalReciente).guildId === 'string'
      )
      .slice(0, MAX_RECIENTES)
  } catch {
    return []
  }
}

function iconoDeTipo(tipo: number) {
  if (tipo === 15 || tipo === 16) return <LayoutList size={14} strokeWidth={1.8} />
  if (tipo === 1 || tipo === 3) return <MessageSquare size={14} strokeWidth={1.8} />
  return <Hash size={14} strokeWidth={1.8} />
}

/**
 * Explorar como cliente de chat: riel de servidores, barra de canales y
 * contenido, los tres persistentes. Al entrar se restaura el último servidor
 * y sus canales se cargan solos; nunca se muestra una pantalla intermedia.
 */
export default function ExploreLayout() {
  const {
    guilds,
    selectedGuild,
    selectGuild,
    fetchGuilds,
    loadingGuilds,
    selectedChannel,
    selectChannel,
    channels
  } = useBrowserStore()

  const [selectorAbierto, setSelectorAbierto] = useState(false)
  const [recientes, setRecientes] = useState<CanalReciente[]>(leerRecientes)

  const restaurado = useRef(false)

  // Carga inicial de servidores (una sola vez por montaje).
  useEffect(() => {
    if (guilds.length === 0 && !loadingGuilds) void fetchGuilds()
  }, [guilds.length, loadingGuilds, fetchGuilds])

  // Restauración: último servidor guardado o el primero disponible.
  useEffect(() => {
    if (restaurado.current) return
    if (selectedGuild) {
      restaurado.current = true
      return
    }
    if (guilds.length === 0) return

    restaurado.current = true
    const guardado = localStorage.getItem(LS_ULTIMO_SERVIDOR)
    const elegido =
      guilds.find((g) => g.id === guardado) ??
      guilds.find((g) => g.id !== '@me') ??
      guilds[0]
    if (elegido) selectGuild(elegido)
  }, [guilds, selectedGuild, selectGuild])

  // Recuerda el servidor activo para la próxima entrada.
  useEffect(() => {
    if (selectedGuild) localStorage.setItem(LS_ULTIMO_SERVIDOR, selectedGuild.id)
  }, [selectedGuild])

  // Recuerda los últimos canales abiertos (máximo 5, sin duplicados).
  useEffect(() => {
    if (!selectedChannel || !selectedGuild) return
    const entrada: CanalReciente = {
      id: selectedChannel.id,
      nombre: selectedChannel.name ?? 'Canal',
      tipo: selectedChannel.type,
      guildId: selectedGuild.id
    }
    setRecientes((previos) => {
      const siguiente = [entrada, ...previos.filter((r) => r.id !== entrada.id)].slice(
        0,
        MAX_RECIENTES
      )
      localStorage.setItem(LS_ULTIMOS_CANALES, JSON.stringify(siguiente))
      return siguiente
    })
  }, [selectedChannel, selectedGuild])

  // Ctrl+Shift+S abre el selector de servidores desde cualquier punto.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (!(evento.ctrlKey || evento.metaKey) || !evento.shiftKey) return
      if (evento.key.toLowerCase() !== 's') return
      evento.preventDefault()
      setSelectorAbierto((previo) => !previo)
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])

  const recientesDelServidor = useMemo(
    () => recientes.filter((r) => r.guildId === selectedGuild?.id),
    [recientes, selectedGuild]
  )

  const abrirReciente = useCallback(
    (reciente: CanalReciente) => {
      const canal = channels.find((c) => c.id === reciente.id)
      if (canal) selectChannel(canal)
    },
    [channels, selectChannel]
  )

  const seleccionarServidor = useCallback(
    (servidor: Servidor) => {
      selectGuild(servidor)
      setSelectorAbierto(false)
    },
    [selectGuild]
  )

  const canal: DiscordChannel | null = selectedChannel

  return (
    <>
      <div className="split vista-entra">
        <RailServidores
          servidores={guilds}
          seleccionadoId={selectedGuild?.id ?? null}
          cargando={loadingGuilds}
          onSeleccionar={seleccionarServidor}
          onAbrirSelector={() => setSelectorAbierto(true)}
          onActualizar={() => void fetchGuilds()}
        />

        <SidebarCanales onAbrirSelector={() => setSelectorAbierto(true)} />

        <div className="contenido">
          {canal ? (
            isForum(canal.type) ? (
              <PostList />
            ) : (
              <ChannelChatView />
            )
          ) : (
            <div className="contenido__vacio">
              <div className="empty">
                <div className="empty__icon">
                  <Compass size={20} strokeWidth={1.8} />
                </div>
                <div className="empty__title">Elegí un canal</div>
                <div className="empty__text">
                  Seleccioná un canal en la barra de la izquierda para leer su historial. La
                  navegación se queda a la vista.
                </div>

                {recientesDelServidor.length > 0 && (
                  <div className="col">
                    <div className="divider" />
                    <div className="muted">Últimos canales</div>
                    <div className="row">
                      {recientesDelServidor.map((reciente) => {
                        const disponible = channels.some((c) => c.id === reciente.id)
                        return (
                          <button
                            key={reciente.id}
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => abrirReciente(reciente)}
                            disabled={!disponible}
                            title={disponible ? reciente.nombre : 'Este canal ya no está disponible'}
                          >
                            {iconoDeTipo(reciente.tipo)}
                            <span className="truncate">{reciente.nombre}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <SelectorServidores
        abierto={selectorAbierto}
        servidores={guilds}
        seleccionadoId={selectedGuild?.id ?? null}
        onSeleccionar={seleccionarServidor}
        onCerrar={() => setSelectorAbierto(false)}
      />
    </>
  )
}
