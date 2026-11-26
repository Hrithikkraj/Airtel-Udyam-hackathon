import { createContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'
export type ToastInput = { tone?: ToastTone; message: string }
export type ToastItem = Required<ToastInput> & { id: number }

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)
