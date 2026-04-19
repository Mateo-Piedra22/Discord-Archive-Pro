import { create } from 'zustand'

interface AuthState {
  token: string | null
  user: { id: string; username: string; global_name: string | null; avatar: string | null } | null
  status: 'idle' | 'connecting' | 'connected' | 'error'
  error: string | null
  setToken: (token: string) => Promise<boolean>
  validate: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  status: 'idle',
  error: null,

  setToken: async (token: string) => {
    set({ status: 'connecting', error: null })
    try {
      const result = await window.api.auth.setToken(token)
      if (result.success) {
        set({ token, user: result.user, status: 'connected', error: null })
        return true
      } else {
        set({ status: 'error', error: result.error })
        return false
      }
    } catch (error: any) {
      set({ status: 'error', error: error.message })
      return false
    }
  },

  validate: async () => {
    set({ status: 'connecting' })
    try {
      const result = await window.api.auth.validate()
      if (result.success) {
        set({ user: result.user, status: 'connected', error: null })
      } else {
        set({ status: 'idle', user: null })
      }
    } catch {
      set({ status: 'idle', user: null })
    }
  },

  logout: () => {
    window.api.auth.clear()
    set({ token: null, user: null, status: 'idle', error: null })
  }
}))
