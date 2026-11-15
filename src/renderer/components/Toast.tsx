import React, { useState, useEffect, useCallback } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  action?: ToastAction
  exiting?: boolean
}

type ToastType = Toast['type']

let toastId = 0
let globalAddToast: ((msg: string, type: ToastType, action?: ToastAction) => void) | null = null

/**
 * Cola de mensajes emitidos antes de que el contenedor esté montado.
 * Sin esto, cualquier `showToast()` de arranque (p. ej. desde un store)
 * se perdía en silencio.
 */
const MAX_PENDING = 10
const pendingToasts: { message: string; type: ToastType; action?: ToastAction }[] = []

function flushPendingToasts() {
  if (!globalAddToast) return
  while (pendingToasts.length > 0) {
    const next = pendingToasts.shift()
    if (next) globalAddToast(next.message, next.type, next.action)
  }
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType, action?: ToastAction) => {
    const id = ++toastId
    const duration = action ? 5000 : 3000
    setToasts((prev) => {
      if (prev.some((t) => !t.exiting && t.message === message && t.type === type)) {
        return prev
      }
      return [...prev, { id, message, type, action }]
    })
    setTimeout(() => {
      setToasts((prev) => {
        if (!prev.some((t) => t.id === id)) return prev
        return prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      })
      setTimeout(() => {
        setToasts((prev) => {
          if (!prev.some((t) => t.id === id)) return prev
          return prev.filter((t) => t.id !== id)
        })
      }, 200)
    }, duration)
  }, [])

  useEffect(() => {
    globalAddToast = addToast
    // Vaciamos lo que se haya emitido antes del montaje del contenedor.
    flushPendingToasts()
    return () => {
      // Solo nos desregistramos si seguimos siendo el handler activo
      // (evita que un desmontaje tardío anule al contenedor actual).
      if (globalAddToast === addToast) globalAddToast = null
    }
  }, [addToast])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

export function showToast(message: string, type: ToastType = 'info', action?: ToastAction) {
  if (globalAddToast) {
    globalAddToast(message, type, action)
    return
  }
  // Contenedor aún no montado: guardamos (máx. 10, descartando el más viejo).
  if (pendingToasts.length >= MAX_PENDING) pendingToasts.shift()
  pendingToasts.push({ message, type, action })
}

export function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.type}${t.exiting ? ' toast--exiting' : ''}`}
          onClick={() => onRemove(t.id)}
        >
          <span className="toast__icon">
            {t.type === 'success' && '✓'}{t.type === 'error' && '✕'}{t.type === 'warning' && '!'}{t.type === 'info' && 'i'}
          </span>
          {t.message}
          {t.action && (
            <button
              type="button"
              className="btn btn--ghost btn--sm toast__action"
              onClick={(e) => {
                e.stopPropagation()
                t.action?.onClick()
                onRemove(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
