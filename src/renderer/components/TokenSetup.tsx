import React, { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { showToast } from './Toast'
import { motion, AnimatePresence } from 'framer-motion'
import { Key, Shield, Cpu, Zap, ArrowRight, Eye, EyeOff, Search, Loader2, Sparkles, CheckCircle2 } from 'lucide-react'
import confetti from 'canvas-confetti'

/**
 * Premium TokenSetup Component
 * 
 * Re-architected in Stack 2026 for Discord Archive Pro.
 * Provides a production-grade onboarding experience with:
 * - High-fidelity animations using Framer Motion
 * - Glassmorphic design and animated gradients
 * - Auto-detection with visual feedback
 * - Particle effects on successful connection
 */
export default function TokenSetup() {
  const [token, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectedTokens, setDetectedTokens] = useState<{ source: string; token: string; user?: any }[]>([])
  const [detectError, setDetectError] = useState<string | null>(null)
  
  const { setToken, status, error } = useAuthStore()

  // Success celebration effect
  useEffect(() => {
    if (status === 'connected') {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#5865F2', '#ffffff', '#43b581']
      })
    }
  }, [status])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    const success = await setToken(token.trim())
    if (success) showToast('Conexión establecida con éxito', 'success')
  }

  const handleAutoDetect = async () => {
    setDetecting(true)
    setDetectError(null)
    setDetectedTokens([])
    try {
      const result = await window.api.tokenDetector.detect()
      if (result.success && result.tokens.length > 0) {
        setDetectedTokens(result.tokens)
        // Auto-select if only one valid token found
        if (result.tokens.length === 1) {
          handleSelectDetected(result.tokens[0].token)
        } else {
          showToast(`Se han detectado ${result.tokens.length} sesiones`, 'info')
        }
      } else if (result.success) {
        setDetectError('No se detectaron sesiones activas. Abre Discord Desktop e intenta de nuevo.')
      } else {
        setDetectError(result.error || 'Fallo en el motor de detección')
      }
    } catch (err: any) {
      setDetectError(err.message || 'Error de comunicación con el sistema')
    } finally {
      setTimeout(() => setDetecting(false), 800) // Aesthetic delay for smoothness
    }
  }

  const handleSelectDetected = async (t: string) => {
    const success = await setToken(t)
    if (success) showToast('Vinculación automática completada', 'success')
  }

  return (
    <div className="setup-container">
      {/* Dynamic Background Elements */}
      <div className="setup-bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>

      <motion.div 
        className="setup-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Brand Header */}
        <header className="setup-header">
          <motion.div 
            className="setup-brand-icon"
            whileHover={{ scale: 1.05, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
          >
            <div className="icon-inner">
              <Zap size={28} fill="currentColor" />
            </div>
            <div className="icon-glow" />
          </motion.div>
          
          <h1 className="setup-title">Discord Archive Pro</h1>
          <p className="setup-tagline">Preservación digital de alta fidelidad</p>
        </header>

        <div className="setup-main-grid">
          {/* Automatic Detection Module */}
          <section className="setup-module detection-module">
            <div className="module-header">
              <Cpu size={18} className="icon-accent" />
              <h3>Sincronización Inteligente</h3>
            </div>
            
            <p className="module-desc">
              Escanea tu entorno local para encontrar sesiones activas de Discord de forma segura y privada.
            </p>

            <button
              className={`btn-premium ${detecting ? 'btn-premium--loading' : ''}`}
              onClick={handleAutoDetect}
              disabled={detecting || status === 'connecting'}
            >
              <span className="btn-content">
                {detecting ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <Search size={18} />
                )}
                <span>{detecting ? 'Escaneando...' : 'Detectar Sesiones'}</span>
              </span>
              <div className="btn-shine" />
            </button>

            <AnimatePresence>
              {detectedTokens.length > 0 && (
                <motion.div 
                  className="detection-results"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className="results-label">Cuentas encontradas:</div>
                  {detectedTokens.map((dt, i) => (
                    <motion.div 
                      key={i} 
                      className="account-pill" 
                      onClick={() => handleSelectDetected(dt.token)}
                      whileHover={{ x: 4, background: 'rgba(255,255,255,0.08)' }}
                    >
                      <div className="account-avatar">
                        {dt.user?.avatar ? (
                          <img src={`https://cdn.discordapp.com/avatars/${dt.user.id}/${dt.user.avatar}.png?size=64`} alt="" />
                        ) : (
                          <div className="avatar-placeholder">{(dt.user?.global_name || dt.user?.username || '?').charAt(0)}</div>
                        )}
                      </div>
                      <div className="account-info">
                        <span className="account-name">{dt.user?.global_name || dt.user?.username}</span>
                        <span className="account-meta">{dt.source}</span>
                      </div>
                      <ArrowRight size={14} className="account-arrow" />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {detectError && (
              <motion.div 
                className="module-error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                {detectError}
              </motion.div>
            )}
          </section>

          {/* Manual Entry Module */}
          <section className="setup-module manual-module">
            <div className="module-header">
              <Shield size={18} className="icon-accent" />
              <h3>Acceso Manual</h3>
            </div>

            <form onSubmit={handleSubmit} className="manual-form">
              <div className="premium-input-wrapper">
                <input
                  className="premium-input"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Introduce tu Token de Discord"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <motion.button
                className="btn-submit"
                type="submit"
                disabled={!token.trim() || status === 'connecting'}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {status === 'connecting' ? (
                  <span className="flex-center gap-2">
                    <Loader2 className="animate-spin" size={16} /> Verificando...
                  </span>
                ) : 'Vincular con Token'}
              </motion.button>

              {error && (
                <div className="form-error">
                  <span className="error-icon">!</span>
                  {error}
                </div>
              )}
            </form>

            <details className="setup-guide">
              <summary>
                <Sparkles size={14} className="mr-2" />
                <span>¿Cómo obtener mi token?</span>
              </summary>
              <div className="guide-content">
                <div className="step">
                  <span className="step-num">01</span>
                  <p>Abre Discord Desktop o Web y pulsa <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd></p>
                </div>
                <div className="step">
                  <span className="step-num">02</span>
                  <p>Ve a la pestaña <strong>Red (Network)</strong> y busca peticiones a <code>/api</code></p>
                </div>
                <div className="step">
                  <span className="step-num">03</span>
                  <p>En los <strong>Headers</strong>, localiza el campo <code>Authorization</code></p>
                </div>
              </div>
            </details>
          </section>
        </div>

        {/* Footer Meta */}
        <footer className="setup-footer">
          <div className="footer-status">
            <CheckCircle2 size={12} />
            <span>Encriptación local AES-256 asegurada</span>
          </div>
        </footer>
      </motion.div>
    </div>
  )
}

