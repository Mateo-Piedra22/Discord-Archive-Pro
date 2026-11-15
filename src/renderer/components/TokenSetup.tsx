import { useState, type FormEvent } from 'react'
import {
  ArrowRight, ClipboardPaste, Eye, EyeOff, KeyRound, Loader2, LogIn, ScanSearch, ShieldCheck
} from 'lucide-react'
import type { DetectedToken, DetectionDiagnostic } from '../../shared/api'
import { useAuthStore } from '../stores/authStore'
import { showToast } from './Toast'

const DISCORD_TOKEN_PATTERN =
  /^(?:mfa\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

function stripWrappingQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim()
  }
  return value
}

/** Limpia espacios, comillas envolventes y prefijos accidentales (`Bearer ` / `Bot `). */
export function normalizarTokenEntrada(raw: string): string {
  let limpio = stripWrappingQuotes(raw.trim())
  limpio = limpio.replace(/^(?:bearer|bot)\s+/i, '').trim()
  return stripWrappingQuotes(limpio)
}

function esFormatoTokenValido(raw: string): boolean {
  const limpio = normalizarTokenEntrada(raw)
  return limpio.length > 0 && DISCORD_TOKEN_PATTERN.test(limpio)
}

/** Punto de estado por fuente: descifrado, encontrado sin descifrar, ausente. */
function estadoFuente(diagnostico: DetectionDiagnostic): string {
  if (diagnostico.decrypted) return 'dot--ok'
  if (diagnostico.found) return 'dot--warn'
  return 'dot--err'
}

function avatarUrl(token: DetectedToken): string | null {
  const usuario = token.user
  if (!usuario?.avatar) return null
  return `https://cdn.discordapp.com/avatars/${usuario.id}/${usuario.avatar}.png?size=64`
}

function inicial(token: DetectedToken): string {
  const nombre = token.user?.global_name || token.user?.username || '?'
  return nombre.charAt(0).toUpperCase()
}

export default function TokenSetup() {
  const { setToken, status, error } = useAuthStore()

  const [valor, setValor] = useState('')
  const [visible, setVisible] = useState(false)
  const [detectando, setDetectando] = useState(false)
  const [diagnosticos, setDiagnosticos] = useState<DetectionDiagnostic[]>([])
  const [detectados, setDetectados] = useState<DetectedToken[]>([])
  const [errorDeteccion, setErrorDeteccion] = useState<string | null>(null)

  const ocupado = status === 'connecting'

  const conectar = async (token: string): Promise<void> => {
    const ok = await setToken(token)
    if (ok) showToast('Sesión conectada', 'success')
  }

  const enviarManual = async (evento: FormEvent) => {
    evento.preventDefault()
    const limpio = normalizarTokenEntrada(valor)
    if (!limpio) return
    await conectar(limpio)
  }

  const pegarDesdePortapapeles = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        showToast('No se pudo acceder al portapapeles', 'warning')
        return
      }
      const raw = await navigator.clipboard.readText()
      const limpio = normalizarTokenEntrada(raw)
      if (!limpio) {
        showToast('El portapapeles está vacío', 'warning')
        return
      }
      setValor(limpio)
    } catch {
      showToast('No se pudo leer el portapapeles. Pega el token manualmente.', 'error')
    }
  }

  const detectar = async () => {
    setDetectando(true)
    setErrorDeteccion(null)
    setDiagnosticos([])
    setDetectados([])

    try {
      const resultado = await window.api.tokenDetector.detect()
      const fuentes = resultado.diagnostics ?? []
      const sesiones = (resultado.tokens ?? []).filter((t) => t.valid)

      setDiagnosticos(fuentes)
      setDetectados(sesiones)

      if (!resultado.success || (fuentes.length === 0 && sesiones.length === 0)) {
        setErrorDeteccion(resultado.error || 'No se encontraron sesiones de Discord en este equipo.')
      } else if (sesiones.length === 0) {
        setErrorDeteccion('Las instalaciones se detectaron, pero ninguna sesión pudo descifrarse. Usa el token manual.')
      }
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : 'Error de comunicación con el sistema.'
      setErrorDeteccion(mensaje)
    } finally {
      setDetectando(false)
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--surface-0)' }}>
      <style>{`
        @keyframes dap-spin { to { transform: rotate(360deg); } }
        .dap-spin { animation: dap-spin 900ms linear infinite; }
      `}</style>

      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: 'var(--sp-10) var(--sp-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--sp-5)'
        }}
      >
        {/* ---------- Encabezado ---------- */}
        <header className="col" style={{ gap: 'var(--sp-2)' }}>
          <span className="section__title">Acceso</span>
          <h1 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}>Estrato</h1>
          <p className="muted" style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, maxWidth: 540 }}>
            Archivo local de servidores, canales e hilos. Conecta tu cuenta para empezar a exportar.
            La aplicación trabaja con tu propio token y no interviene ningún servidor intermedio.
          </p>
        </header>

        <hr className="divider" />

        {/* ---------- Dos caminos ---------- */}
        <div className="grid grid--cards">
          {/* --- Detección automática --- */}
          <section className="card col" style={{ minWidth: 0 }}>
            <header className="card__header">
              <ScanSearch size={15} strokeWidth={1.8} style={{ color: 'var(--fg-3)' }} />
              <span className="card__title">Detección automática</span>
            </header>

            <div className="card__body col" style={{ gap: 'var(--sp-3)', flex: 1 }}>
              <p className="muted" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.55 }}>
                Revisa Discord Desktop, Discord Canary y los navegadores instalados en busca de una
                sesión abierta. El análisis ocurre en este equipo.
              </p>

              <button
                type="button"
                className="btn btn--primary"
                onClick={detectar}
                disabled={detectando || ocupado}
              >
                {detectando ? (
                  <>
                    <Loader2 size={14} strokeWidth={1.8} className="dap-spin" />
                    Analizando instalaciones…
                  </>
                ) : (
                  <>
                    <ScanSearch size={14} strokeWidth={1.8} />
                    Detectar sesión
                  </>
                )}
              </button>

              {diagnosticos.length > 0 && (
                <div className="col" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
                  <span className="section__title">Fuentes analizadas</span>
                  {diagnosticos.map((fuente) => (
                    <div
                      key={`${fuente.kind}-${fuente.source}`}
                      className="row"
                      style={{ alignItems: 'flex-start', gap: 'var(--sp-2)' }}
                    >
                      <span
                        className={`dot ${estadoFuente(fuente)}`}
                        style={{ marginTop: 'var(--sp-1)' }}
                        aria-hidden="true"
                      />
                      <div className="col" style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-2)' }}>
                          {fuente.source}
                        </span>
                        <span className="muted" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.45 }}>
                          {fuente.detail}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {detectados.length > 0 && (
                <div className="col" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
                  <span className="section__title">Sesiones disponibles</span>
                  <div className="list">
                    {detectados.map((sesion) => {
                      const avatar = avatarUrl(sesion)
                      return (
                        <button
                          key={sesion.token}
                          type="button"
                          className="list__row"
                          onClick={() => void conectar(sesion.token)}
                          disabled={ocupado}
                          style={{ width: '100%', textAlign: 'left' }}
                        >
                          <span
                            style={{
                              width: 'var(--sp-6)',
                              height: 'var(--sp-6)',
                              flexShrink: 0,
                              borderRadius: 'var(--r-full)',
                              overflow: 'hidden',
                              background: 'var(--surface-3)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--fg-2)'
                            }}
                          >
                            {avatar ? (
                              <img
                                src={avatar}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              inicial(sesion)
                            )}
                          </span>
                          <span className="col" style={{ minWidth: 0, flex: 1 }}>
                            <span className="list__name">
                              {sesion.user?.global_name || sesion.user?.username || 'Cuenta desconocida'}
                            </span>
                            <span className="list__meta">{sesion.source}</span>
                          </span>
                          <ArrowRight size={14} strokeWidth={1.8} className="dim" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {errorDeteccion && (
                <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
                  <span className="badge badge--err">Sin acceso</span>
                  <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--fg-2)' }}>
                    {errorDeteccion}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* --- Token manual --- */}
          <section className="card col" style={{ minWidth: 0 }}>
            <header className="card__header">
              <KeyRound size={15} strokeWidth={1.8} style={{ color: 'var(--fg-3)' }} />
              <span className="card__title">Token manual</span>
            </header>

            <div className="card__body">
              <form className="col" style={{ gap: 'var(--sp-3)' }} onSubmit={enviarManual}>
                <div className="field">
                  <label className="field__label" htmlFor="token-manual">
                    Token de acceso
                  </label>
                  <div className="row" style={{ gap: 'var(--sp-2)' }}>
                    <input
                      id="token-manual"
                      className="input"
                      type={visible ? 'text' : 'password'}
                      value={valor}
                      onChange={(evento) => setValor(evento.target.value)}
                      placeholder="Pega aquí tu token"
                      spellCheck={false}
                      autoComplete="off"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void pegarDesdePortapapeles()}
                      disabled={ocupado}
                      title="Pegar desde el portapapeles"
                      aria-label="Pegar token desde el portapapeles"
                    >
                      <ClipboardPaste size={14} strokeWidth={1.8} />
                      Pegar
                    </button>
                    <button
                      type="button"
                      className="btn btn--icon"
                      onClick={() => setVisible((previo) => !previo)}
                      title={visible ? 'Ocultar token' : 'Mostrar token'}
                      aria-label={visible ? 'Ocultar token' : 'Mostrar token'}
                    >
                      {visible ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
                    </button>
                  </div>
                  {valor.trim().length > 0 && (() => {
                    const formatoValido = esFormatoTokenValido(valor)
                    return (
                      <div
                        className="row"
                        style={{ gap: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}
                        role="status"
                      >
                        <span
                          className={`dot ${formatoValido ? 'dot--ok' : 'dot--warn'}`}
                          aria-hidden="true"
                        />
                        <span style={{ color: formatoValido ? 'var(--ok)' : 'var(--warn)' }}>
                          {formatoValido
                            ? 'Formato compatible con token de Discord'
                            : 'El formato no coincide con un token de Discord válido'}
                        </span>
                      </div>
                    )
                  })()}
                  <span className="field__hint">
                    Se guarda cifrado en este equipo. No se envía a ningún servicio externo.
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn btn--primary btn--block"
                  disabled={!normalizarTokenEntrada(valor) || ocupado}
                >
                  {ocupado ? (
                    <>
                      <Loader2 size={14} strokeWidth={1.8} className="dap-spin" />
                      Verificando…
                    </>
                  ) : (
                    <>
                      <LogIn size={14} strokeWidth={1.8} />
                      Conectar
                    </>
                  )}
                </button>

                {error && (
                  <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
                    <span className="badge badge--err">Error</span>
                    <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--fg-2)' }}>
                      {error}
                    </span>
                  </div>
                )}
              </form>
            </div>
          </section>
        </div>

        {/* ---------- Instrucciones ---------- */}
        <section className="card">
          <header className="card__header">
            <ShieldCheck size={15} strokeWidth={1.8} style={{ color: 'var(--fg-3)' }} />
            <span className="card__title">Cómo obtener el token</span>
          </header>
          <div className="card__body">
            <ol className="col" style={{ gap: 'var(--sp-3)' }}>
              <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                <span
                  className="mono dim"
                  style={{ fontSize: 'var(--text-xs)', paddingTop: 'var(--sp-1)' }}
                >
                  01
                </span>
                <span style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
                  Abre Discord en el navegador e inicia sesión con la cuenta que quieres archivar.
                </span>
              </li>
              <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                <span
                  className="mono dim"
                  style={{ fontSize: 'var(--text-xs)', paddingTop: 'var(--sp-1)' }}
                >
                  02
                </span>
                <span style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
                  Abre las herramientas de desarrollo con <span className="kbd">F12</span> o{' '}
                  <span className="kbd">Ctrl</span> <span className="kbd">Shift</span>{' '}
                  <span className="kbd">I</span>.
                </span>
              </li>
              <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                <span
                  className="mono dim"
                  style={{ fontSize: 'var(--text-xs)', paddingTop: 'var(--sp-1)' }}
                >
                  03
                </span>
                <span style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
                  Entra en <span className="mono">Application</span> ›{' '}
                  <span className="mono">Local Storage</span> ›{' '}
                  <span className="mono">https://discord.com</span>.
                </span>
              </li>
              <li className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                <span
                  className="mono dim"
                  style={{ fontSize: 'var(--text-xs)', paddingTop: 'var(--sp-1)' }}
                >
                  04
                </span>
                <span style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, color: 'var(--fg-2)' }}>
                  Copia el valor de la clave <span className="mono">token</span> y pégalo en el campo
                  de token manual.
                </span>
              </li>
            </ol>
          </div>
        </section>

        <p className="dim" style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
          Usa únicamente cuentas propias. El token se guarda cifrado en este equipo y el contenido
          archivado permanece en la carpeta <span className="mono">data/</span> junto al ejecutable.
        </p>
      </div>
    </div>
  )
}
