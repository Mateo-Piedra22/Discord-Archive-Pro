import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 12, padding: 24, color: 'var(--text-1)'
        }}>
          <AlertTriangle size={32} color="var(--red)" style={{ opacity: 0.8 }} />
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-0)' }}>
            Error de renderizado
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-2)',
            padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
            maxWidth: 320, wordBreak: 'break-word', textAlign: 'center',
            maxHeight: 120, overflowY: 'auto'
          }}>
            {this.state.error.message}
          </div>
          <button
            className="btn btn--ghost btn--sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => this.setState({ error: null })}
          >
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
