import { useContext } from 'react'
import { ToastContext } from './toastContext'

/** Shows a short message at the bottom of the screen: toast({ tone: 'success', message: '…' }). */
export function useToast() {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside ToastProvider')
  return show
}
