import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Compass, DownloadCloud, Archive, Settings2, Info, LayoutDashboard,
  Minus, Square, Copy, X, Sun, Moon, BookOpen, Loader2, Command, Search
} from 'lucide-react'
import { useAuthStore } from './stores/authStore'
import { useBrowserStore } from './stores/browserStore'
import { useDownloadStore } from './stores/downloadStore'
import { useUiStore, type Vista } from './stores/uiStore'
import { useToast, ToastContainer } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import TokenSetup from './components/TokenSetup'
import logoUrl from './assets/logo.png'

// Las vistas pesadas se cargan bajo demanda: el bundle inicial solo trae
// el armazón. El visor de archivo (epubjs, resaltado de código) es el que
// más pesa y no se necesita hasta que el usuario entra.
const DashboardView = lazy(() => import('./components/DashboardView'))
const ExploreLayout = lazy(() => import('./components/explore/ExploreLayout'))
const DownloadsView = lazy(() => import('./components/DownloadsView'))
const SettingsView = lazy(() => import('./components/SettingsView'))
const ArchiveViewer = lazy(() => import('./components/ArchiveViewer'))
const AboutView = lazy(() => import('./components/AboutView'))

// Capas superpuestas: solo se descargan cuando se abren por primera vez.
const LiveThreadView = lazy(() => import('./components/LiveThreadView'))
const CommandPalette = lazy(() => import('./components/CommandPalette'))
const ShortcutsSheet = lazy(() => import('./components/ShortcutsSheet'))
const SearchOverlay = lazy(() => import('./components/SearchOverlay'))

const VISTAS: { id: Vista; etiqueta: string; icono: typeof Compass }[] = [
  { id: 'panel', etiqueta: 'Panel', icono: LayoutDashboard },
  { id: 'explorar', etiqueta: 'Explorar', icono: Compass },
  { id: 'cola', etiqueta: 'Cola', icono: DownloadCloud },
  { id: 'archivo', etiqueta: 'Archivo', icono: Archive },
  { id: 'ajustes', etiqueta: 'Ajustes', icono: Settings2 },
  { id: 'legal', etiqueta: 'Legal', icono: Info }
]

export type TemaApp = 'dark' | 'light' | 'sepia'

const TEMA_KEY = 'ui_theme'

const INFO_TEMA: Record<TemaApp, { nombre: string; corto: string; themeColor: string }> = {
  dark: { nombre: 'Tinta oscura', corto: 'Oscuro', themeColor: '#0e1116' },
  light: { nombre: 'Papel claro', corto: 'Claro', themeColor: '#f6f4ef' },
  sepia: { nombre: 'Pergamino sepia', corto: 'Sepia', themeColor: '#efe8d8' }
}

function normalizarTema(valor: string | null | undefined): TemaApp {
  return valor === 'light' || valor === 'sepia' ? valor : 'dark'
}

function leerTema(): TemaApp {
  return normalizarTema(localStorage.getItem(TEMA_KEY))
}

function siguienteTema(actual: TemaApp): TemaApp {
  if (actual === 'dark') return 'light'
  if (actual === 'light') return 'sepia'
  return 'dark'
}

function Cargando() {
  return (
    <div className="empty">
      <Loader2 size={20} className="muted girar" />
      <span className="muted" style={{ fontSize: 'var(--text-md)' }}>Cargando…</span>
    </div>
  )
}

export default function App() {
  const { status, user, validate } = useAuthStore()
  const { initListeners, queue } = useDownloadStore()
  const { selectedChannel, selectedGuild, selectChannel } = useBrowserStore()
  const { toasts, removeToast } = useToast()

  const {
    vista, setVista, hilo, cerrarHilo,
    paletaAbierta, setPaleta, atajosAbiertos, setAtajos,
    busquedaAbierta, setBusqueda
  } = useUiStore()

  const [maximizado, setMaximizado] = useState(false)
  const [tema, setTema] = useState<TemaApp>(leerTema)

  // Tema: se aplica en <html> para que también afecte a los portales.
  useEffect(() => {
    document.documentElement.dataset.theme = tema
    localStorage.setItem(TEMA_KEY, tema)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', INFO_TEMA[tema].themeColor)
  }, [tema])

  // Sincronización del tema cuando cambia desde Ajustes o la Paleta de comandos.
  useEffect(() => {
    const alCambiarTema = (evento: Event) => {
      const siguiente = normalizarTema((evento as CustomEvent<string>).detail)
      setTema((actual) => (actual === siguiente ? actual : siguiente))
    }
    window.addEventListener('dap:theme', alCambiarTema)
    return () => window.removeEventListener('dap:theme', alCambiarTema)
  }, [])

  const rotarTema = () => {
    const next = siguienteTema(tema)
    setTema(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem(TEMA_KEY, next)
    window.dispatchEvent(new CustomEvent<TemaApp>('dap:theme', { detail: next }))
  }

  // Arranque: validar sesión, escuchar la cola y restaurar el zoom.
  useEffect(() => {
    void validate()
    const limpiarListeners = initListeners()

    const factor = Number(localStorage.getItem('ui_zoom_factor') || '1')
    window.api.window.setZoom(Number.isFinite(factor) ? factor : 1)

    const quitarEstado = window.api.window.onStateChanged((estado) => setMaximizado(estado.maximized))
    const quitarAuth = window.api.auth.onAutoConnected((conectado) => {
      if (conectado) void validate()
    })
    void window.api.window.getState().then((estado) => setMaximizado(estado.maximized))

    return () => {
      limpiarListeners()
      quitarEstado()
      quitarAuth()
    }
  }, [])

  // Navegación programática desde las vistas (por ejemplo «Ir a Ajustes»).
  useEffect(() => {
    const alNavegar = (evento: Event) => {
      const destino = (evento as CustomEvent<string>).detail
      if (VISTAS.some((v) => v.id === destino)) setVista(destino as Vista)
    }
    window.addEventListener('dap:navigate', alNavegar)
    return () => window.removeEventListener('dap:navigate', alNavegar)
  }, [setVista])

  // Atajos globales de la ventana.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      const ctrl = evento.ctrlKey || evento.metaKey

      if (ctrl && evento.key.toLowerCase() === 'k') {
        evento.preventDefault()
        setPaleta(!paletaAbierta)
        return
      }
      if (ctrl && evento.key.toLowerCase() === 'f') {
        evento.preventDefault()
        setBusqueda(true)
        return
      }
      if (ctrl && evento.key === '/') {
        evento.preventDefault()
        setAtajos(!atajosAbiertos)
        return
      }
      if (ctrl && !evento.shiftKey && !evento.altKey) {
        const indice = Number(evento.key) - 1
        if (indice >= 0 && indice < VISTAS.length) {
          evento.preventDefault()
          setVista(VISTAS[indice].id)
          return
        }
      }

      if (evento.key === 'Escape') {
        // Una capa con su propio manejo de Esc (visor de imágenes) tiene
        // prioridad: si no, cerrar la imagen también salía del canal.
        if (document.querySelector('.lightbox')) return
        if (paletaAbierta) return setPaleta(false)
        if (busquedaAbierta) return setBusqueda(false)
        if (atajosAbiertos) return setAtajos(false)
        if (hilo) return cerrarHilo()
        if (vista === 'explorar' && selectedChannel) {
          selectChannel(null)
        }
      }
    }

    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [
    vista, selectedChannel, hilo, paletaAbierta, atajosAbiertos, busquedaAbierta,
    setPaleta, setBusqueda, setAtajos, cerrarHilo, setVista, selectChannel
  ])

  const activas = queue.filter(
    (t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'paused'
  ).length

  const estadoConexion =
    status === 'connected' ? 'ok' : status === 'connecting' ? 'busy' : 'off'

  return (
    <div className="app-shell">
      {/* ---------- Barra de título ---------- */}
      <header
        className="titlebar"
        onDoubleClick={() => window.api.window.toggleMaximize()}
      >
        <div className="titlebar__brand">
          <img src={logoUrl} alt="" />
          <span>Estrato</span>
        </div>

        <div className="titlebar__meta">
          <span className="titlebar__status">
            <span className={`dot dot--${estadoConexion}`} />
            {status === 'connected'
              ? user?.global_name || user?.username || 'Conectado'
              : status === 'connecting'
                ? 'Conectando…'
                : 'Sin sesión'}
          </span>
          {selectedGuild && vista === 'explorar' && (
            <span className="truncate" style={{ maxWidth: 220 }}>
              {selectedGuild.name}
              {selectedChannel ? ` · #${selectedChannel.name || 'chat'}` : ''}
            </span>
          )}
        </div>

        <div className="titlebar__spacer" />

        <button
          className="wc"
          title="Paleta de comandos (Ctrl+K)"
          onClick={() => setPaleta(true)}
        >
          <Command size={13} />
        </button>

        <div className="window-controls">
          <button className="wc" title="Minimizar" onClick={() => window.api.window.minimize()}>
            <Minus size={13} />
          </button>
          <button
            className="wc"
            title={maximizado ? 'Restaurar' : 'Maximizar'}
            onClick={() => window.api.window.toggleMaximize()}
          >
            {maximizado ? <Copy size={11} /> : <Square size={11} />}
          </button>
          <button className="wc wc--close" title="Cerrar" onClick={() => window.api.window.close()}>
            <X size={13} />
          </button>
        </div>
      </header>

      {/* ---------- Cuerpo ---------- */}
      {status !== 'connected' ? (
        <TokenSetup />
      ) : (
        <div className="app-body">
          <nav className="rail">
            <div className="rail__brand" title="Estrato">
              <img src={logoUrl} alt="" />
            </div>

            {VISTAS.map((item, indice) => {
              const Icono = item.icono
              const activa = vista === item.id
              return (
                <button
                  key={item.id}
                  className={`rail__item${activa ? ' rail__item--active' : ''}`}
                  onClick={() => setVista(item.id)}
                  title={`${item.etiqueta} (Ctrl+${indice + 1})`}
                >
                  <Icono size={17} strokeWidth={activa ? 2.1 : 1.8} />
                  <span className="rail__label">{item.etiqueta}</span>
                  {item.id === 'cola' && activas > 0 && (
                    <span className="rail__badge">{activas > 99 ? '99+' : activas}</span>
                  )}
                </button>
              )
            })}

            <div className="rail__spacer" />

            <div className="rail__foot">
              <button
                className="rail__item"
                onClick={() => setBusqueda(true)}
                title="Buscar en el archivo (Ctrl+F)"
              >
                <Search size={16} />
                <span className="rail__label">Buscar</span>
              </button>
              <button
                className="rail__item"
                onClick={rotarTema}
                title={`Tema actual: ${INFO_TEMA[tema].nombre} · Cambiar a ${INFO_TEMA[siguienteTema(tema)].nombre}`}
                aria-label={`Tema actual: ${INFO_TEMA[tema].nombre}. Cambiar a ${INFO_TEMA[siguienteTema(tema)].nombre}`}
              >
                {tema === 'dark' ? (
                  <Moon size={16} />
                ) : tema === 'light' ? (
                  <Sun size={16} />
                ) : (
                  <BookOpen size={16} />
                )}
                <span className="rail__label">{INFO_TEMA[tema].corto}</span>
              </button>
            </div>
          </nav>

          <main className="workspace">
            <ErrorBoundary>
              <Suspense fallback={<Cargando />}>
                {vista === 'panel' && <DashboardView />}
                {vista === 'explorar' && <ExploreLayout />}
                {vista === 'cola' && <DownloadsView />}
                {vista === 'archivo' && <ArchiveViewer />}
                {vista === 'ajustes' && <SettingsView />}
                {vista === 'legal' && <AboutView />}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}

      {/* ---------- Capas superpuestas ---------- */}
      <Suspense fallback={null}>
        {hilo && <LiveThreadView />}
        {paletaAbierta && <CommandPalette />}
        {atajosAbiertos && <ShortcutsSheet />}
        {busquedaAbierta && <SearchOverlay />}
      </Suspense>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  )
}
