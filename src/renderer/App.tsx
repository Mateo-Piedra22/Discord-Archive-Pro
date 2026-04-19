import React, { useState, useEffect } from 'react'
import { Compass, DownloadCloud, Archive, Settings, ChevronRight, Minus, Square, X, Info } from 'lucide-react'
import { useAuthStore } from './stores/authStore'
import { useBrowserStore } from './stores/browserStore'
import { useDownloadStore } from './stores/downloadStore'
import { useToast, ToastContainer } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import TokenSetup from './components/TokenSetup'
import ExploreView from './components/explore/ExploreView'
import PostList from './components/PostList'
import DownloadsView from './components/DownloadsView'
import SettingsView from './components/SettingsView'
import ArchiveViewer from './components/ArchiveViewer'
import AboutView from './components/AboutView'
import logoUrl from './assets/logo.png'

type Tab = 'browse' | 'downloads' | 'archive' | 'settings' | 'about'
type BrowseStep = 'explore' | 'posts'

export default function App() {
  const { status, validate } = useAuthStore()
  const { initListeners, queue } = useDownloadStore()
  const { selectedGuild, selectedChannel } = useBrowserStore()
  const { toasts, removeToast } = useToast()

  const [activeTab, setActiveTab] = useState<Tab>('browse')
  const [browseStep, setBrowseStep] = useState<BrowseStep>('explore')

  useEffect(() => {
    validate()
    initListeners()
    const savedZoom = localStorage.getItem('ui_zoom')
    if (savedZoom) {
      window.api.window.setZoom(Number(savedZoom))
    }
  }, [])

  useEffect(() => {
    if (selectedChannel) setBrowseStep('posts')
    else setBrowseStep('explore')
  }, [selectedChannel])

  const activeDownloads = queue.filter(t => t.status === 'downloading' || t.status === 'queued').length

  return (
    <div className="app">
      {/* Title Bar */}
      <div className="titlebar">
        <div className="titlebar__left">
          <div className={`dot dot--${status === 'connected' ? 'green' : status === 'connecting' ? 'amber' : 'off'}`} />
          <img src={logoUrl} alt="Logo" style={{ width: 14, height: 14, marginLeft: 6, marginRight: 4 }} />
          <span className="titlebar__title" style={{ fontWeight: 600, letterSpacing: '0.02em' }}>Discord Archive Pro</span>
        </div>
        <div className="titlebar__controls">
          <button className="wc" onClick={() => window.api.window.minimize()} title="Minimizar"><Minus size={10} /></button>
          <button className="wc" onClick={() => window.api.window.toggleMaximize()} title="Maximizar"><Square size={10} /></button>
          <button className="wc wc--close" onClick={() => window.api.window.close()} title="Cerrar"><X size={10} /></button>
        </div>
      </div>

      {status !== 'connected' ? (
        <TokenSetup />
      ) : (
        <>
          {/* Tabs */}
          <nav className="tabs">
            {([
              { key: 'browse' as Tab, label: 'Explorar', icon: <Compass size={15} /> },
              { key: 'downloads' as Tab, label: 'Descargas', icon: <DownloadCloud size={15} />, badge: activeDownloads },
              { key: 'archive' as Tab, label: 'Archivo', icon: <Archive size={15} /> },
              { key: 'settings' as Tab, label: 'Config', icon: <Settings size={15} /> },
              { key: 'about' as Tab, label: 'Legal', icon: <Info size={15} /> },
            ]).map(t => (
              <button
                key={t.key}
                className={`tabs__item${activeTab === t.key ? ' tabs__item--active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.icon}
                {t.label}
                {t.badge ? <span className="tabs__badge">{t.badge}</span> : null}
              </button>
            ))}
          </nav>

          {/* Content */}
          <main className="main">
            <ErrorBoundary>
              {activeTab === 'browse' && (selectedChannel ? <PostList /> : <ExploreView />)}
              {activeTab === 'downloads' && <DownloadsView />}
              {activeTab === 'archive' && <ArchiveViewer />}
              {activeTab === 'settings' && <SettingsView />}
              {activeTab === 'about' && <AboutView />}
            </ErrorBoundary>
          </main>
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  )
}

function DownloadAnimation() {
  return (
    <div className="dl-anim" style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        position: 'absolute', width: '120%', height: '120%',
        background: 'radial-gradient(circle, var(--accent) 0%, transparent 60%)',
        opacity: 0.1, filter: 'blur(30px)', animation: 'dlGlow 4s infinite alternate ease-in-out'
      }} />
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path className="dl-arrow" d="M12 3V16M12 16L7 11M12 16L17 11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path className="dl-base" d="M20 21H4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
        <circle cx="12" cy="12" r="9" stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 4" opacity="0.2" />
      </svg>
      <style>{`
        @keyframes dlGlow { 0% { opacity: 0.1; transform: scale(0.9); } 100% { opacity: 0.2; transform: scale(1.1); } }
        .dl-arrow { animation: dlArrow 2s infinite ease-in-out; }
        @keyframes dlArrow { 
          0%, 100% { transform: translateY(-3px); opacity: 0.4; } 
          50% { transform: translateY(3px); opacity: 1; } 
        }
        .dl-base { animation: dlBase 2s infinite ease-in-out; }
        @keyframes dlBase { 0%, 100% { transform: scaleX(0.8); } 50% { transform: scaleX(1.1); } }
      `}</style>
    </div>
  )
}
