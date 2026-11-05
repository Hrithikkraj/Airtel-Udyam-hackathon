import { useEffect, useState } from 'react'
import { fetchProducts, type Product } from './api'
import { rupees } from './format'

function categoryLink(category: string) {
  return category.toLowerCase().replace(/[^a-z]+/g, '-')
}

// The basic facts every product has.
function buyingFacts(product: Product) {
  const setup =
    product.setup_fee_inr > 0 ? `${rupees(product.setup_fee_inr)} one-time setup` : 'No setup fee'
  const days = product.install_days === 1 ? '1 day' : `${product.install_days} days`
  return `${setup}. ${product.min_contract_months}-month minimum. Ready in about ${days}.`
}

// Only the conditions that apply to this product, in plain words.
function conditions(product: Product, allProducts: Product[]) {
  const list: string[] = []
  if (product.requires_gstin) list.push('Needs an active GSTIN')
  if (!product.city_tiers.includes(2)) list.push('Only in tier 1 cities')
  if (product.min_employees > 1) list.push(`For ${product.min_employees}+ employees`)
  if (product.min_sites > 1) list.push(`For ${product.min_sites}+ sites`)
  if (product.requires_one_of.length > 0) {
    const names = product.requires_one_of.map(
      (id) => allProducts.find((other) => other.product_id === id)?.name ?? id,
    )
    list.push(`Works with ${names.join(', ')}`)
  }
  return list
}

function ProductRow({ product, allProducts }: { product: Product; allProducts: Product[] }) {
  const needs = conditions(product, allProducts)
  return (
    <li className="py-4">
      {/* The dotted line between name and price is the look of a shop's rate list. */}
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold text-lg leading-snug">{product.name}</h3>
        <span aria-hidden="true" className="min-w-4 flex-1 border-b-2 border-dotted border-rule" />
        <p className="font-display font-semibold text-lg whitespace-nowrap tabular-nums">
          {rupees(product.price_min_inr)}–{rupees(product.price_max_inr)}
        </p>
      </div>
      <p className="text-right text-sm text-muted">a month, {product.unit}</p>
      <p className="mt-1 max-w-[62ch]">{product.description}</p>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">{buyingFacts(product)}</p>
      {needs.length > 0 && (
        <p className="mt-2 max-w-[62ch] border-l-4 border-marigold pl-2 text-sm">
          {needs.join('. ')}.
        </p>
      )}
    </li>
  )
}

export default function CataloguePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasFailed, setHasFailed] = useState(false)

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch(() => setHasFailed(true))
      .finally(() => setIsLoading(false))
  }, [])

  // Set keeps the first time each category appears and removes repeats.
  const categories = [...new Set(products.map((product) => product.category))]

  return (
    <>
      {categories.length > 0 && (
        <nav
          aria-label="Product types"
          className="sticky top-0 z-10 border-b border-rule bg-paper"
        >
          <ul className="mx-auto flex max-w-3xl gap-5 overflow-x-auto px-4 py-3 whitespace-nowrap">
            {categories.map((category) => (
              <li key={category}>
                <a className="font-semibold underline underline-offset-4" href={`#${categoryLink(category)}`}>
                  {category}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <main className="mx-auto max-w-3xl px-4 pb-16">
        {isLoading && <p className="py-8">Loading the rate list…</p>}

        {hasFailed && (
          <p role="alert" className="py-8">
            The rate list did not load. Check that the backend is running on port 8000, then reload
            this page.
          </p>
        )}

        {!isLoading && !hasFailed && products.length === 0 && (
          <p className="py-8">
            The rate list is empty. In the backend folder, run python -m app.import_data, then
            reload this page.
          </p>
        )}

        {categories.map((category) => (
          <section key={category} id={categoryLink(category)} className="mt-10 scroll-mt-16">
            <h2 className="border-b-4 border-ink font-display text-2xl font-bold sm:text-3xl">
              {category}
            </h2>
            <ul className="divide-y divide-rule">
              {products
                .filter((product) => product.category === category)
                .map((product) => (
                  <ProductRow key={product.product_id} product={product} allProducts={products} />
                ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  )
}
