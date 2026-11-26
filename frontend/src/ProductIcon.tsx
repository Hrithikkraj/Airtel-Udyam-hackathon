import { createElement } from 'react'
import { productIcon } from './productIcons'

// The picture for one product. Decorative: the product's name is always written next to it.
export default function ProductIcon({ productId, size = 22 }: { productId: string; size?: number }) {
  return createElement(productIcon(productId), { size, 'aria-hidden': true })
}
