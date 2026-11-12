import React, { useState, useEffect, useCallback } from 'react'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  exiting?: boolean
}

type ToastType = Toast['type']

let toastId = 0
let globalAddToast: ((msg: string, type: ToastType) => void) | null = null

/**
 * Cola de mensajes emitidos antes de que el contenedor esté montado.
 * Sin esto, cualquier `showToast()` de arranque (p. ej. desde un store)
 * se perdía en silencio.
 */
const MAX_PENDING = 10
const pendingToasts: { message: string; type: ToastType }[] = []

function flushPendingToasts() {
  if (!globalAddToast) return
  while (pendingToasts.length > 0) {
    const next = pendingToasts.shift()
    if (next) globalAddToast(next.message, next.type)
  }
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200)
    }, 3000)
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

export function showToast(message: string, type: ToastType = 'info') {
  if (globalAddToast) {
    globalAddToast(message, type)
    return
  }
  // Contenedor aún no montado: guardamos (máx. 10, descartando el más viejo).
  if (pendingToasts.length >= MAX_PENDING) pendingToasts.shift()
  pendingToasts.push({ message, type })
}

export function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="toast-container">
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
        </div>
      ))}
    </div>
  )
}
