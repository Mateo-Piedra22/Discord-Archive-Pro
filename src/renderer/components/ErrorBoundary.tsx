import React from 'react'
import { AlertTriangle, Check, Copy, LayoutDashboard, RefreshCw } from 'lucide-react'

interface Props { children: React.ReactNode }
interface State { error: Error | null; copiado: boolean }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, copiado: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copiado: false }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private copiarError = () => {
    const { error } = this.state
    if (!error) return
    const detalle = [error.message, error.stack].filter(Boolean).join('\n\n')
    void navigator.clipboard?.writeText(detalle).then(() => {
      this.setState({ copiado: true })
      setTimeout(() => this.setState({ copiado: false }), 1800)
    })
  }

  private irAlPanel = () => {
    this.setState({ error: null, copiado: false })
    window.dispatchEvent(new CustomEvent('dap:navigate', { detail: 'panel' }))
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-6)',
            color: 'var(--fg-2)'
          }}
        >
          <AlertTriangle size={32} color="var(--err)" style={{ opacity: 0.85 }} />
          <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--fg)' }}>
            Error de renderizado
          </div>
          <div
            className="mono"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-3)',
              background: 'var(--surface-2)',
              padding: 'var(--sp-2) var(--sp-3)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)',
              maxWidth: 420,
              wordBreak: 'break-word',
              textAlign: 'center',
              maxHeight: 140,
              overflowY: 'auto'
            }}
          >
            {this.state.error.message || 'Error inesperado en la interfaz'}
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={this.copiarError}
            >
              {this.state.copiado ? <Check size={13} /> : <Copy size={13} />}
              {this.state.copiado ? 'Copiado' : 'Copiar detalle'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={this.irAlPanel}
            >
              <LayoutDashboard size={13} /> Ir al Panel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => this.setState({ error: null, copiado: false })}
            >
              <RefreshCw size={13} /> Reintentar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
