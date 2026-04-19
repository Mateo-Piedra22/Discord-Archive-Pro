import React, { useState, useEffect, useCallback } from 'react'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  exiting?: boolean
}

let toastId = 0
let globalAddToast: ((msg: string, type: Toast['type']) => void) | null = null

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200)
    }, 3000)
  }, [])

  useEffect(() => {
    globalAddToast = addToast
    return () => { globalAddToast = null }
  }, [addToast])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

export function showToast(message: string, type: Toast['type'] = 'info') {
  if (globalAddToast) globalAddToast(message, type)
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
