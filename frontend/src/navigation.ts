import type { LucideIcon } from 'lucide-react'

// One place in the main navigation: the bottom bar on a phone, the top bar on a computer.
export type NavItem = {
  key: 'home' | 'quote' | 'order' | 'rates' | 'profile'
  label: string
  icon: LucideIcon
  isActive: boolean
  // Quote and Order only exist after a quote or an order. Until then the tab is dimmed, and tapping
  // it explains what to do first instead of opening an empty page.
  isAvailable: boolean
  unavailableMessage?: string
  onSelect: () => void
}
