import React, { useState } from 'react'
import { 
  FolderOutput, LogOut, Minus, Plus, Settings2, Database, 
  Network, Palette, Layout, ShieldCheck, Download, 
  Trash2, RefreshCw, Layers, LayoutList
} from 'lucide-react'
import { useDownloadStore } from '../stores/downloadStore'
import { useBrowserStore } from '../stores/browserStore'
import { useAuthStore } from '../stores/authStore'
import { showToast } from './Toast'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
}

export default function SettingsView() {
  const {
    outputDir, exportFormats, contentSelection, namingPattern, threadMode, includeToc,
    maxConcurrent, maxFileSize, autoOpenFolder, preserveFilenames,
    minimizeToTray, strictChannelFiltering,
    setExportFormats, setContentSelection, setNamingPattern,
    setThreadMode, setIncludeToc, setMaxConcurrent, setMaxFileSize,
    setAutoOpenFolder, setPreserveFilenames, setMinimizeToTray, setStrictChannelFiltering,
    pickDirectory, openOutputFolder
  } = useDownloadStore()
  const { showStandardChannels, setShowStandardChannels } = useBrowserStore()
  const { user, logout } = useAuthStore()
  const [dbStats, setDbStats] = useState<any>(null)
  const [rateStats, setRateStats] = useState<any>(null)
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = localStorage.getItem('ui_zoom')
    return saved ? Number(saved) : 0
  })

  const [activeTab, setActiveTab] = useState<'general' | 'export' | 'advanced' | 'system'>('general')

  const handleZoom = (val: number) => {
    const newVal = Math.max(-1, Math.min(2, val))
    setZoomLevel(newVal)
    localStorage.setItem('ui_zoom', newVal.toString())
    window.api.window.setZoom(newVal)
  }

  const loadStats = async () => {
    try {
      const stats = await window.api.settings.getDbStats()
      setDbStats(stats)
      const rs = await window.api.settings.getRateLimiterStats()
      setRateStats(rs)
    } catch (e) {
      console.error('Failed to load stats:', e)
    }
  }

  React.useEffect(() => {
    loadStats()
    const intv = setInterval(loadStats, 5000)
    return () => clearInterval(intv)
  }, [])

  const handleClearCache = async () => {
    if (confirm('¿Estás seguro de que quieres borrar la caché local? Esto no borrará los archivos descargados.')) {
      const res = await window.api.cache.clear()
      if (res.success) {
        showToast('Caché borrada correctamente', 'success')
        loadStats()
      } else {
        showToast('Error al borrar la caché', 'error')
      }
    }
  }

  const toggleFormat = (f: string) => {
    if (exportFormats.includes(f)) {
      if (exportFormats.length > 1) setExportFormats(exportFormats.filter(x => x !== f))
    } else {
      setExportFormats([...exportFormats, f])
    }
  }

  const contentLabels: Record<string, { label: string; desc: string; recommended: boolean }> = {
    text:         { label: 'Texto', desc: 'Contenido textual de los mensajes', recommended: true },
    images:       { label: 'Imágenes', desc: 'Fotos, GIFs y capturas adjuntadas', recommended: true },
    replies:      { label: 'Respuestas', desc: 'Todos los mensajes de la conversación', recommended: true },
    embeds:       { label: 'Embeds', desc: 'Previews de enlaces, iframes, etc.', recommended: true },
    metadata:     { label: 'Metadata', desc: 'IDs, reacciones, ediciones', recommended: true },
    files:        { label: 'Archivos', desc: 'PDF, ZIP y otros adjuntos', recommended: true },
    videos:       { label: 'Videos', desc: 'Clips de video adjuntos', recommended: false },
    stickers:     { label: 'Stickers', desc: 'Stickers de Discord', recommended: false },
    customEmojis: { label: 'Emojis', desc: 'Emojis del servidor', recommended: false },
    avatars:      { label: 'Avatares', desc: 'Fotos de perfil', recommended: false },
  }

  return (
    <div className="settings-container" style={{ 
      display: 'flex', height: '100%', overflow: 'hidden',
      background: 'var(--bg-0)', animation: 'fadeIn 0.4s var(--ease)'
    }}>
      {/* Sidebar Navigation */}
      <aside style={{ 
        width: 220, borderRight: '1px solid var(--border)', 
        background: 'rgba(0,0,0,0.1)', padding: '20px 0',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '0 20px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ 
            width: 32, height: 32, borderRadius: 8, 
            background: 'var(--accent)', display: 'flex', 
            alignItems: 'center', justifyContent: 'center' 
          }}>
            <Settings2 size={18} color="white" />
          </div>
          <span style={{ fontWeight: 700, color: 'var(--text-0)' }}>Ajustes</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          {[
            { id: 'general', label: 'General', icon: <Palette size={14} /> },
            { id: 'export',  label: 'Exportación', icon: <Download size={14} /> },
            { id: 'advanced', label: 'Avanzado', icon: <Layers size={14} /> },
            { id: 'system',  label: 'Sistema', icon: <Database size={14} /> },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', border: 'none', borderRadius: 8,
                background: activeTab === t.id ? 'var(--accent-dim)' : 'transparent',
                color: activeTab === t.id ? 'var(--accent-text)' : 'var(--text-2)',
                fontWeight: activeTab === t.id ? 700 : 500,
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
              }}
            >
              <span style={{ opacity: activeTab === t.id ? 1 : 0.6 }}>{t.icon}</span>
              <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* User Card at bottom of sidebar */}
        {user && (
          <div style={{ 
            margin: '0 12px 12px', padding: '12px', 
            background: 'rgba(255,255,255,0.02)', borderRadius: 12,
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div className="avatar" style={{ width: 32, height: 32 }}>
                {user.avatar ? (
                  <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`} alt="" />
                ) : (
                  <span>{(user.global_name || user.username).charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  fontSize: 12, fontWeight: 700, color: 'var(--text-0)', 
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' 
                }}>
                  {user.global_name || user.username}
                </div>
                <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>Conectado</div>
              </div>
            </div>
            <button 
              className="btn btn--danger btn--xs" 
              style={{ width: '100%', gap: 6 }} 
              onClick={() => { logout(); showToast('Sesión cerrada', 'info') }}
            >
              <LogOut size={12} /> Salir
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main style={{ 
        flex: 1, overflowY: 'auto', padding: '40px 60px', position: 'relative',
        background: 'radial-gradient(circle at top right, rgba(88, 101, 242, 0.05) 0%, transparent 40%)' 
      }}>
        {/* Animated Background Decor */}
        <div style={{ position: 'absolute', top: 40, right: 60, opacity: 0.1, pointerEvents: 'none' }}>
           <SettingsAnimation />
        </div>
        
        {/* TAB: GENERAL */}
        {activeTab === 'general' && (
          <div style={{ maxWidth: 600, animation: 'fadeUp 0.3s var(--ease)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-0)', marginBottom: 4 }}>General</h2>
            <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginBottom: 32 }}>Configura la apariencia y el comportamiento básico de la aplicación.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {/* Output Directory */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Ruta de descarga</h4>
                <div 
                  onClick={pickDirectory}
                  style={{
                    background: 'var(--bg-1)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }}
                  className="settings-card-hover"
                >
                  <div style={{ 
                    width: 36, height: 36, borderRadius: 10, 
                    background: 'rgba(255,255,255,0.03)', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', color: 'var(--accent)'
                  }}>
                    <FolderOutput size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {outputDir || 'Seleccionar carpeta...'}
                    </div>
                  </div>
                  <button className="btn btn--ghost btn--sm">Cambiar</button>
                </div>
              </section>

              {/* UI Zoom */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Escala de interfaz</h4>
                <div style={{ 
                  background: 'var(--bg-1)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                      width: 36, height: 36, borderRadius: 10, 
                      background: 'rgba(255,255,255,0.03)', display: 'flex', 
                      alignItems: 'center', justifyContent: 'center', color: 'var(--amber)'
                    }}>
                      <Layout size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Nivel de Zoom</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Ajusta el tamaño de la fuente y elementos.</div>
                    </div>
                  </div>
                  <div className="stepper" style={{ background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 10 }}>
                    <button className="stepper__btn" style={{ width: 32, height: 32, border: 'none' }} onClick={() => handleZoom(zoomLevel - 0.25)}><Minus size={14} /></button>
                    <span className="stepper__value" style={{ minWidth: 60 }}>{Math.round((1 + zoomLevel) * 100)}%</span>
                    <button className="stepper__btn" style={{ width: 32, height: 32, border: 'none' }} onClick={() => handleZoom(zoomLevel + 0.25)}><Plus size={14} /></button>
                  </div>
                </div>
              </section>

              {/* Window Behavior */}
              <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', margin: 0 }}>Ventana y Sistema</h4>
                </div>
                <div 
                  onClick={() => setMinimizeToTray(!minimizeToTray)}
                  style={{ 
                    background: 'var(--bg-1)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px', display: 'flex', alignItems: 'center', 
                    justifyContent: 'space-between', cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ 
                      width: 36, height: 36, borderRadius: 10, 
                      background: 'rgba(255,255,255,0.03)', display: 'flex', 
                      alignItems: 'center', justifyContent: 'center', color: 'var(--accent)'
                    }}>
                      <Layout size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Minimizar a la bandeja</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Oculta la ventana al sistema en vez de cerrarla.</div>
                    </div>
                  </div>
                  <div style={{ 
                    width: 42, height: 22, borderRadius: 11, 
                    background: minimizeToTray ? 'var(--accent)' : 'var(--bg-3)',
                    position: 'relative', transition: 'all 0.3s'
                  }}>
                    <div style={{ 
                      position: 'absolute', top: 2, left: minimizeToTray ? 22 : 2, 
                      width: 18, height: 18, borderRadius: '50%', background: 'white',
                      transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }} />
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB: EXPORT */}
        {activeTab === 'export' && (
          <div style={{ maxWidth: 600, animation: 'fadeUp 0.3s var(--ease)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-0)', marginBottom: 4 }}>Exportación</h2>
            <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginBottom: 32 }}>Define qué datos guardar y en qué formatos envolverlos.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {/* Formats Selection */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Formatos de archivo</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {[
                    { k: 'markdown', l: 'Markdown', ext: '.md', desc: 'Universal y ligero (Estándar)', color: '#7289da' },
                    { k: 'html',     l: 'HTML Interactive', ext: '.html', desc: 'Fiel a la interfaz original', color: '#e34c26' },
                    { k: 'pdf',      l: 'PDF Premium', ext: '.pdf', desc: 'Resumen listo para imprimir', color: '#f40f02' },
                    { k: 'epub',     l: 'E-Reader / Books', ext: '.epub', desc: 'Ideal para tablets y Kindle', color: '#9b59b6' },
                    { k: 'json',     l: 'JSON Data', ext: '.json', desc: 'Solo datos crudos para desarrolladores', color: '#f1e05a' },
                  ].map(f => {
                    const active = exportFormats.includes(f.k)
                    return (
                      <div 
                        key={f.k}
                        onClick={() => toggleFormat(f.k)}
                        style={{
                          background: active ? 'rgba(88,101,242,0.08)' : 'var(--bg-1)',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
                          display: 'flex', gap: 12, transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ 
                          width: 40, height: 40, borderRadius: 8, 
                          background: active ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: active ? 'white' : 'var(--text-3)', flexShrink: 0
                        }}>
                          <span style={{ fontWeight: 800, fontSize: 10 }}>{f.ext.toUpperCase()}</span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent-text)' : 'var(--text-1)' }}>{f.l}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.desc}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Content Checklist */}
              <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', margin: 0 }}>Filtros de contenido</h4>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Recomendado: Todo activo</div>
                </div>
                <div style={{ 
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
                  gap: 8, background: 'rgba(0,0,0,0.1)', padding: 10, borderRadius: 12 
                }}>
                  {Object.entries(contentLabels).map(([key, meta]) => {
                    const active = (contentSelection as any)[key]
                    return (
                      <button
                        key={key}
                        onClick={() => setContentSelection(key, !active)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          background: active ? 'var(--accent-dim)' : 'transparent',
                          border: '1px solid rgba(255,255,255,0.03)', borderRadius: 8,
                          cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s'
                        }}
                      >
                        <div style={{ 
                          width: 14, height: 14, borderRadius: 4, 
                          background: active ? 'var(--accent)' : 'var(--bg-3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', flexShrink: 0
                        }}>
                          {active && <span style={{ fontSize: 10 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? 'var(--accent-text)' : 'var(--text-2)' }}>
                          {meta.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Thread Mode Selection */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Estructura de archivos</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { k: 'single',   l: 'Hilo Unificado', desc: 'Todo en un solo archivo cronológico. Limpio y portátil.', icon: <Layout size={16} /> },
                    { k: 'separate', l: 'Exportación Atómica', desc: 'Un archivo por mensaje. Diseñado para archivistas técnicos.', icon: <LayoutList size={16} /> },
                    { k: 'both',     l: 'Paquete Completo (Recomendado)', desc: 'Genera ambos estilos. Máxima redundancia y acceso.', icon: <Layers size={16} /> },
                  ].map(m => (
                    <div 
                      key={m.k}
                      onClick={() => setThreadMode(m.k as any)}
                      style={{
                        background: 'var(--bg-1)', border: `1px solid ${threadMode === m.k ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 14, transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ 
                        width: 18, height: 18, borderRadius: '50%',
                        border: `2px solid ${threadMode === m.k ? 'var(--accent)' : 'var(--text-3)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {threadMode === m.k && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: threadMode === m.k ? 'var(--accent-text)' : 'var(--text-1)' }}>{m.l}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{m.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB: ADVANCED */}
        {activeTab === 'advanced' && (
          <div style={{ maxWidth: 600, animation: 'fadeUp 0.3s var(--ease)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-0)', marginBottom: 4 }}>Avanzado</h2>
            <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginBottom: 32 }}>Control quirúrgico sobre el proceso de sincronización y rendimiento.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Concurrent Downloads */}
              <div style={{ 
                background: 'var(--bg-1)', borderRadius: 16, padding: 20, 
                border: '1px solid var(--border)', display: 'flex', 
                alignItems: 'center', justifyContent: 'space-between' 
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Sincronización Paralela</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Número de threads de descarga activos simultáneamente.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 10 }}>
                  <button className="stepper__btn" style={{ border: 'none' }} onClick={() => setMaxConcurrent(Math.max(1, maxConcurrent - 1))}><Minus size={14} /></button>
                  <span style={{ fontSize: 18, fontWeight: 800, minWidth: 24, textAlign: 'center' }}>{maxConcurrent}</span>
                  <button className="stepper__btn" style={{ border: 'none' }} onClick={() => setMaxConcurrent(Math.min(10, maxConcurrent + 1))}><Plus size={14} /></button>
                </div>
              </div>

              {/* Toggles */}
              <div style={{ background: 'rgba(255,255,255,0.01)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden' }}>
                {[
                  { k: 'index', l: 'Generar Índice (_INDEX.md)', val: includeToc, set: setIncludeToc, icon: <LayoutList size={16} /> },
                  { k: 'auto',  l: 'Auto-Abrir Carpeta', val: autoOpenFolder, set: setAutoOpenFolder, icon: <FolderOutput size={16} /> },
                  { k: 'name',  l: 'Preservar Nombres Originales', val: preserveFilenames, set: setPreserveFilenames, icon: <Database size={16} /> },
                  { k: 'strict', l: 'Privacidad Estricta (Ocultar prohibidos)', val: strictChannelFiltering, set: setStrictChannelFiltering, icon: <ShieldCheck size={16} /> },
                ].map(item => (
                  <div 
                    key={item.k}
                    onClick={() => item.set(!item.val)}
                    style={{ 
                      padding: '16px 20px', display: 'flex', alignItems: 'center', 
                      justifyContent: 'space-between', borderBottom: '1px solid var(--border)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ opacity: item.val ? 1 : 0.4, color: item.val ? 'var(--accent)' : 'inherit' }}>{item.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: item.val ? 600 : 400 }}>{item.l}</span>
                    </div>
                    <div style={{ 
                      width: 44, height: 22, borderRadius: 11, 
                      background: item.val ? 'var(--accent)' : 'var(--bg-3)',
                      position: 'relative', transition: 'all 0.3s'
                    }}>
                      <div style={{ 
                        position: 'absolute', top: 2, left: item.val ? 24 : 2, 
                        width: 18, height: 18, borderRadius: '50%', background: 'white',
                        transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* EXPERIMENTAL: Standard Channels */}
              <section style={{ 
                marginTop: 10, padding: 20, borderRadius: 16, 
                background: 'linear-gradient(135deg, rgba(240,178,50,0.05) 0%, rgba(240,178,50,0.02) 100%)',
                border: '1px solid rgba(240,178,50,0.15)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Network size={16} color="var(--amber)" />
                  <h4 style={{ margin: 0, fontSize: 14, color: 'var(--amber)', fontWeight: 800 }}>Modo Forzado (Canales Estándar)</h4>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 16 }}>
                  Habilita el escaneo de canales de texto convencionales y mensajes directos. Esta función es experimental y puede causar bloqueos temporales por parte de Discord si se usa en servidores masivos.
                </p>
                <div 
                  onClick={() => setShowStandardChannels(!showStandardChannels)}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                    padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, width: 'fit-content'
                  }}
                >
                  <div style={{ 
                    width: 40, height: 20, borderRadius: 10, 
                    background: showStandardChannels ? 'var(--amber)' : 'var(--bg-3)',
                    position: 'relative'
                  }}>
                    <div style={{ 
                      position: 'absolute', top: 2, left: showStandardChannels ? 22 : 2, 
                      width: 16, height: 16, borderRadius: '50%', background: 'white',
                      transition: 'all 0.2s'
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: showStandardChannels ? 'var(--text-0)' : 'var(--text-3)' }}>
                    {showStandardChannels ? 'ACTIVADO' : 'DESACTIVADO'}
                  </span>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* TAB: SYSTEM */}
        {activeTab === 'system' && (
          <div style={{ maxWidth: 600, animation: 'fadeUp 0.3s var(--ease)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-0)', marginBottom: 4 }}>Sistema</h2>
            <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginBottom: 32 }}>Mantenimiento de la base de datos local y monitoreo de la API.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Rate Limits */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Estado de la API (Discord)</h4>
                <div style={{ 
                  background: 'var(--bg-1)', borderRadius: 16, padding: 20, border: '1px solid var(--border)',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Sincronización Global</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>
                      {rateStats?.global?.remaining ?? '—'} <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>de {rateStats?.global?.limit ?? '—'}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Rutas Activas</span>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{Object.keys(rateStats?.routes || {}).length}</span>
                  </div>
                </div>
              </section>

              {/* Database Stats Card */}
              <section>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 12 }}>Almacenamiento Local</h4>
                <div style={{ 
                  background: 'var(--bg-1)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' 
                }}>
                  <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Posts en Caché</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{dbStats?.totalPosts?.toLocaleString() ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Archivos Registrados</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{dbStats?.totalFiles?.toLocaleString() ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Mensajes Indexados</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{dbStats?.totalMessages?.toLocaleString() ?? '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>Tamaño Total</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-text)' }}>{dbStats ? formatBytes(dbStats.totalSize) : '—'}</div>
                    </div>
                  </div>
                  
                  {/* Danger Zone */}
                  <div style={{ 
                    padding: '16px 20px', background: 'rgba(218, 55, 60, 0.05)', 
                    borderTop: '1px solid rgba(218, 55, 60, 0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Trash2 size={16} color="var(--red)" />
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Limpieza preventiva de metadatos locales.</span>
                    </div>
                    <button 
                      className="btn btn--danger btn--sm" 
                      style={{ gap: 6 }}
                      onClick={handleClearCache}
                    >
                      <RefreshCw size={12} /> Purgar Caché
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

      </main>

    </div>
  )
}

function SettingsAnimation() {
  return (
    <div className="settings-anim">
      <div className="settings-anim__gear settings-anim__gear--lg">
        <Settings2 size={120} strokeWidth={0.5} />
      </div>
      <div className="settings-anim__gear settings-anim__gear--sm">
        <Settings2 size={60} strokeWidth={1} />
      </div>
      <style>{`
        .settings-anim {
          position: relative; width: 140px; height: 140px;
        }
        .settings-anim__gear {
          position: absolute; color: var(--accent);
        }
        .settings-anim__gear--lg {
          top: 0; left: 0; animation: spin 20s linear infinite;
        }
        .settings-anim__gear--sm {
          bottom: 0; right: 0; animation: spin-reverse 10s linear infinite;
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spin-reverse { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
      `}</style>
    </div>
  )
}
