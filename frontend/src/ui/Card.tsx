import { createElement, type HTMLAttributes, type Ref } from 'react'
import { cx } from './cx'

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li' | 'aside'
  variant?: 'elevated' | 'flat'
  interactive?: boolean // Lifts a little under a mouse. Nothing changes on touch screens.
  ref?: Ref<HTMLElement>
}

// A white card with soft depth: the surface every piece of content sits on.
export default function Card({ as = 'div', variant = 'elevated', interactive = false, className, ...rest }: Props) {
  return createElement(as, {
    className: cx(variant === 'flat' ? 'card-flat' : 'card', interactive && 'card-interactive', className),
    ...rest,
  })
}
