// All calls to the backend live in this file.

export type Product = {
  product_id: string
  category: string
  name: string
  description: string
  unit: string
  price_min_inr: number
  price_max_inr: number
  setup_fee_inr: number
  min_contract_months: number
  city_tiers: number[]
  min_employees: number
  min_sites: number
  requires_gstin: boolean
  requires_one_of: string[]
  install_days: number
  target_segments: string[]
}

export type Profile = {
  employee_count: number
  num_sites: number
  city_tier: number
  has_gstin: boolean
  fibre_available: boolean
  segment: string | null
  needs: string[]
  budget_monthly_inr: number | null
  current_internet: string | null
  preferred_language: string
  quantities?: Record<string, number>
  // What the business already has from us. The server sets this itself when an order is saved.
  owned_product_ids?: string[]
}

export type BundleItem = { product_id: string; quantity: number }

export type QuoteLine = {
  product_id: string
  name: string
  unit: string
  quantity: number
  unit_price_inr: number
  monthly_inr: number
  setup_inr: number
}

export type Quote = {
  lines: QuoteLine[]
  monthly_total_inr: number
  setup_total_inr: number
  contract_months: number
  install_days: number
}

// Why we chose a product, written by the server's own code. Every field may be missing in an old
// saved response, so the page must work without it.
export type ProductDetail = {
  product_id: string
  what_you_get?: string
  why?: string[]
  good_to_know?: string[]
  price?: {
    unit_price_inr: number
    quantity: number
    monthly_inr: number
    setup_inr: number
    range_min_inr: number
    range_max_inr: number
    share_of_bill_pct: number
  }
  why_not_others?: { product_id: string; name: string; difference: string }[]
  upgrade?: { product_id: string; name: string; extra_monthly_inr: number; note: string } | null
  if_removed?: string | null
}

export type RecommendedBundle = {
  quote: Quote
  reasons: Record<string, string>
  score: { needs_covered: number; size_fit: number; simplicity: number; total: number }
  details?: Record<string, ProductDetail>
}

export type AddOn = {
  product_id: string
  name: string
  quantity: number
  monthly_inr: number
  setup_inr: number
  reason: string
  detail?: ProductDetail | null
}

export type Recommendation = {
  segment: string
  bundle: RecommendedBundle | null
  alternatives: RecommendedBundle[]
  addons: AddOn[]
  not_included: { product_id: string; name: string; reasons: string[] }[]
  over_budget: boolean
  assisted_reasons: string[]
  explanation: string
  chosen_by: 'advisor' | 'owner'
}

export type City = { city: string; city_tier: number }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type AdvisorAnswers = Record<string, unknown> & { city?: string | null }
export type AdvisorReply = {
  reply: string
  answers: AdvisorAnswers
  /** The language the advisor found in the owner's messages, such as "Hindi", "Hinglish" or "Tamil". */
  language: string
  profile: Profile | null
  recommendation: Recommendation | null
}

// Every request carries this header. Other websites cannot add it, so the server can tell that a
// request which uses our cookies really came from our own pages.
const SAME_SITE_HEADER = { 'X-Accel-CSRF': '1' }

// Turns the server's error into readable text. Rule errors arrive as a list of sentences.
async function errorText(response: Response, fallback: string): Promise<string> {
  const error = await response.json().catch(() => null)
  const detail = error?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && typeof detail[0] === 'string') return detail.join('. ')
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
    return detail.map((item: { msg: string }) => item.msg.replace(/^Value error, /, '')).join('. ')
  }
  return fallback
}

// Sends a request and returns the reply. Cookies go with it, but only to our own server.
async function send<T>(path: string, options: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const { method = options.json !== undefined || options.form ? 'POST' : 'GET', json, form } = options
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: json !== undefined ? { ...SAME_SITE_HEADER, 'Content-Type': 'application/json' } : SAME_SITE_HEADER,
    body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
  })
  if (!response.ok) {
    const isSignInCheck = path === '/api/account/me' || path === '/api/account/signin'
    if (response.status === 401 && !isSignInCheck) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    throw new ApiError(response.status, await errorText(response, `Server replied with status ${response.status}`))
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

/** Fired when the server says this browser is no longer signed in. */
export const SIGNED_OUT_EVENT = 'accel-signed-out'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const request = <T,>(path: string, body?: unknown) => send<T>(path, body === undefined ? {} : { json: body })

export const fetchProducts = () => request<Product[]>('/api/catalogue/products')
export const fetchCities = () => request<City[]>('/api/advisor/cities')
export const fetchAdvisorStatus = () => request<{ available: boolean }>('/api/advisor/status')

// The file ending only helps the server read the format; the server checks the recording's type itself.
const VOICE_FILE_ENDINGS: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }

/**
 * Sends a short voice recording and returns what the owner said, for the chat box. Nothing is stored.
 * `language` is only a hint, the chat's language so far: it keeps spoken Hindi out of Urdu script.
 */
export function transcribeAudio(audio: Blob, language: string) {
  const kind = audio.type.split(';')[0]
  const form = new FormData()
  form.append('audio', audio, `voice.${VOICE_FILE_ENDINGS[kind] ?? 'webm'}`)
  form.append('language', language)
  return send<{ text: string }>('/api/advisor/transcribe', { form })
}

export function trimAdvisorMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 1000) }))
}

// `language` is only a hint: the chat's language so far. The server works out the language itself.
// `businessId` is set when shopping again for a business the owner already has.
export const sendAdvisorMessage = (messages: ChatMessage[], language: string, answers: AdvisorAnswers, businessId?: number) =>
  request<AdvisorReply>('/api/advisor/message', {
    messages: trimAdvisorMessages(messages),
    preferred_language: language,
    answers,
    ...(businessId !== undefined ? { business_id: businessId } : {}),
  })

export const fetchRecommendation = (profile: Profile) =>
  request<Recommendation>('/api/bundles/recommend', profile)

// A plan the owner picked from the rate list. Refused with readable reasons if it breaks a rule.
export const fetchOwnerPlan = (profile: Profile, items: BundleItem[]) =>
  request<Recommendation>('/api/bundles/plan', { profile, items })

export const priceBundle = (profile: Profile, items: BundleItem[]) =>
  request<Quote>('/api/bundles/quote', { profile, items })

export type SavedQuote = {
  quote_id: number
  order_id: number
  business_id: number
  status: string
  quote: Quote
  // Where the new order starts: kyc_complete when the business was already verified.
  order_status?: string
}

// The business's name and type, filled in from the chat. Empty text keeps what is saved.
export type BusinessNames = { name: string; type: string }
const namesBody = (names?: BusinessNames) => ({ business_name: names?.name || null, business_type: names?.type || null })

// With businessId, the order joins a business the owner already has, and its verified documents are used again.
export const saveQuote = (
  profile: Profile,
  items: BundleItem[],
  city: string | null,
  chosenBy: 'advisor' | 'owner' = 'advisor',
  businessId?: number,
  names?: BusinessNames,
) =>
  request<SavedQuote>('/api/quotes', {
    profile,
    items,
    city,
    chosen_by: chosenBy,
    ...namesBody(names),
    ...(businessId !== undefined ? { business_id: businessId } : {}),
  })

// ---------- Shop again for a business the owner already has ----------

export type OwnedProduct = { product_id: string; name: string; quantity: number }
export type ShopAgain = {
  business_id: number
  business_name: string | null
  business_type: string | null
  city: string | null
  employee_count: number
  num_sites: number
  has_gstin: boolean
  kyc_verified: boolean
  owned: OwnedProduct[]
  last_order_id: number | null
  last_order: OwnedProduct[]
  answers: AdvisorAnswers
}
// The details the owner confirmed on "Is this still right?".
export type ConfirmedDetails = { employee_count: number; num_sites: number; city: string | null; has_gstin: boolean }

export const fetchShopAgain = (businessId: number) => request<ShopAgain>(`/api/shop-again/${businessId}`)

// The last order's products again, at today's prices, as a quote the owner can still change.
export const reorderForBusiness = (businessId: number, details: ConfirmedDetails, language: string) =>
  request<{ profile: Profile; recommendation: Recommendation; city: string | null }>(`/api/shop-again/${businessId}/reorder`, {
    ...details,
    preferred_language: language,
  })

// The quote behind an order, so the owner can go back to it from any later step, even after a reload.
export type AcceptedQuote = {
  profile: Profile
  recommendation: Recommendation
  city: string | null
  can_change: boolean
  business_name?: string | null
  business_type?: string | null
}
export const fetchAcceptedQuote = (orderId: number) => request<AcceptedQuote>(`/api/quotes/for-order/${orderId}`)

// Changes the quote of an order that is not placed yet. Same order, and the documents are kept.
export const replaceAcceptedQuote = (
  orderId: number,
  profile: Profile,
  items: BundleItem[],
  city: string | null,
  chosenBy: 'advisor' | 'owner' = 'advisor',
  names?: BusinessNames,
) =>
  send<SavedQuote>(`/api/quotes/for-order/${orderId}`, {
    method: 'PUT',
    json: { profile, items, city, chosen_by: chosenBy, ...namesBody(names) },
  })

// Orders in these states can no longer change their quote.
export const FIXED_ORDER_STATUSES = ['installation_scheduled', 'installation_in_progress', 'activated', 'cancelled']

// ---------- KYC ----------

export type KycDocument = {
  document_type: string
  name: string
  status: string
  reasons: string[]
  fields: Record<string, string>
  // Problems with earlier documents that first appear with this one. Missing in old responses.
  mismatches?: string[]
}

export type KycStatus = {
  status: string
  has_consent: boolean
  documents: KycDocument[]
  waiting_for: string[]
  problems_across_documents: string[]
  review_note: string | null
  // The documents needed, in order. Missing in old responses, so the page then works it out itself.
  steps?: string[]
}

export type KycNotice = { version: string; purpose: string; points: string[] }

// KYC calls rely on this browser's HttpOnly order cookie, or the signed-in account, to prove ownership.
const kycRequest = (businessId: number, path: string, method: string, options: { json?: unknown; form?: FormData } = {}) =>
  send<KycStatus>(`/api/kyc/${businessId}${path}`, { method, ...options })

export const fetchKycNotice = () => request<KycNotice>('/api/kyc/notice')

export const fetchKycStatus = (businessId: number) => kycRequest(businessId, '/status', 'GET')

export const giveKycConsent = (businessId: number, version: string) =>
  kycRequest(businessId, '/consent', 'POST', { json: { notice_version: version } })

export const withdrawKycConsent = (businessId: number) => kycRequest(businessId, '/consent', 'DELETE')

export const uploadKycDocument = (businessId: number, documentType: string, file: File) => {
  const form = new FormData()
  form.append('document_type', documentType)
  form.append('file', file)
  return kycRequest(businessId, '/documents', 'POST', { form })
}

export const declareNoUdyam = (businessId: number) => kycRequest(businessId, '/no-udyam', 'POST')

// ---------- Orders ----------

export type Order = {
  order_id: number
  business_id: number
  has_gstin: boolean
  status: string
  status_label: string
  who_acts_next: string
  next_step: string
  next_action: string | null
  can_cancel: boolean
  steps: { label: string; state: string; at: string | null }[]
  timeline: { label: string; at: string }[]
  lines: { product_id: string; name: string; quantity: number; monthly_inr: number; setup_inr: number }[]
  monthly_total_inr: number
  setup_total_inr: number
  contract_months: number
  install_days: number
  expected_activation: string | null
  preferred_installation_date: string | null
  help_requested: boolean
  demo_mode: boolean
}

const orderRequest = (orderId: number, action = '') =>
  send<Order>(`/api/orders/${orderId}${action && `/${action}`}`, { method: action ? 'POST' : 'GET' })

export const fetchOrder = (orderId: number) => orderRequest(orderId)
export const placeOrder = (orderId: number) => orderRequest(orderId, 'place')
export const cancelOrder = (orderId: number) => orderRequest(orderId, 'cancel')
export const advanceDemoOrder = (orderId: number) => orderRequest(orderId, 'demo-advance')
export const setPreferredInstallationDate = (orderId: number, preferredInstallationDate: string | null) =>
  send<Order>(`/api/orders/${orderId}/installation-date`, {
    method: 'PUT',
    json: { preferred_installation_date: preferredInstallationDate },
  })
export const requestHelp = (orderId: number, phone: string) =>
  send<Order>(`/api/orders/${orderId}/help`, { json: { phone } }).catch(() => {
    throw new Error('That did not work. Check the number and try again.')
  })

// An older version of this app kept the order secret in page storage. This moves it into a cookie once.
export const rememberOrder = (orderId: number, legacyToken: string) =>
  fetch(`/api/orders/${orderId}/remember`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Access-Token': legacyToken },
  }).then((response) => response.ok)

export const requestCallback = (profile: Profile, city: string | null, phone: string) =>
  send('/api/callbacks', { json: { profile, city, phone, agreed_to_be_called: true } }).catch(() => {
    throw new Error('That did not work. Check the number and try again.')
  })

// ---------- Staff ----------

export async function staffRequest<T>(key: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api/staff/${path}`, {
    method,
    headers: { 'X-Staff-Key': key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'That did not work. Try again.')
  }
  return response.json()
}

// ---------- Accounts ----------

export type AccountOrder = { order_id: number; status: string; status_label: string; monthly_total_inr: number; created_at: string }
export type AccountBusiness = {
  business_id: number
  business_name: string | null
  business_type: string | null
  city: string | null
  employee_count: number | null
  num_sites: number | null
  has_gstin: boolean
  orders: AccountOrder[]
}
export type Account = {
  user_id: number
  full_name: string
  email: string
  phone: string | null
  preferred_language: 'English' | 'Hindi'
  created_at: string
  businesses: AccountBusiness[]
}

export const signUp = (details: { full_name: string; email: string; password: string; phone: string | null }) =>
  send<Account>('/api/account/signup', { json: details })

export const signIn = (email: string, password: string) => send<Account>('/api/account/signin', { json: { email, password } })

export const signOut = () => send<void>('/api/account/signout', { method: 'POST' })

/** The signed-in account, or null when nobody is signed in on this browser. */
export async function fetchAccount(): Promise<Account | null> {
  try {
    return await send<Account>('/api/account/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export const updateAccount = (changes: { full_name?: string; phone?: string; clear_phone?: boolean; preferred_language?: 'English' | 'Hindi' }) =>
  send<Account>('/api/account/me', { method: 'PATCH', json: changes })

export const updateBusiness = (businessId: number, changes: { business_name: string; business_type: string }) =>
  send<Account>(`/api/account/businesses/${businessId}`, { method: 'PATCH', json: changes })

// Deletes the business with all its orders, quotes and KYC details. It cannot be undone.
export const deleteBusiness = (businessId: number) => send<Account>(`/api/account/businesses/${businessId}`, { method: 'DELETE' })

export const claimBusiness = (businessId: number) => send<Account>(`/api/account/claim/${businessId}`, { method: 'POST' })
