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

export type RecommendedBundle = {
  quote: Quote
  reasons: Record<string, string>
  score: { needs_covered: number; size_fit: number; simplicity: number; total: number }
}

export type AddOn = {
  product_id: string
  name: string
  quantity: number
  monthly_inr: number
  setup_inr: number
  reason: string
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
}

export type City = { city: string; city_tier: number }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type AdvisorAnswers = Record<string, unknown> & { city?: string | null }
export type AdvisorReply = {
  reply: string
  answers: AdvisorAnswers
  profile: Profile | null
  recommendation: Recommendation | null
}

// Sends a request and returns the reply. Rule errors from the server become readable text.
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const isRuleList = Array.isArray(error?.detail) && typeof error.detail[0] === 'string'
    throw new Error(isRuleList ? error.detail.join('. ') : `Server replied with status ${response.status}`)
  }
  return response.json()
}

export const fetchProducts = () => request<Product[]>('/api/catalogue/products')
export const fetchCities = () => request<City[]>('/api/advisor/cities')
export const fetchAdvisorStatus = () => request<{ available: boolean }>('/api/advisor/status')

export const sendAdvisorMessage = (messages: ChatMessage[], language: string, answers: AdvisorAnswers) =>
  request<AdvisorReply>('/api/advisor/message', { messages, preferred_language: language, answers })

export const fetchRecommendation = (profile: Profile) =>
  request<Recommendation>('/api/bundles/recommend', profile)

export const priceBundle = (profile: Profile, items: BundleItem[]) =>
  request<Quote>('/api/bundles/quote', { profile, items })

export type SavedQuote = {
  quote_id: number
  order_id: number
  business_id: number
  access_token: string
  status: string
  quote: Quote
}

export const saveQuote = (profile: Profile, items: BundleItem[], city: string | null) =>
  request<SavedQuote>('/api/quotes', { profile, items, city })

// ---------- KYC ----------

export type KycDocument = {
  document_type: string
  name: string
  status: string
  reasons: string[]
  fields: Record<string, string>
}

export type KycStatus = {
  status: string
  has_consent: boolean
  documents: KycDocument[]
  waiting_for: string[]
  problems_across_documents: string[]
  review_note: string | null
}

export type KycNotice = { version: string; purpose: string; points: string[] }

// KYC calls carry the owner's secret token, because they return personal details.
async function kycRequest(businessId: number, token: string, path: string, method: string, body?: BodyInit, json = false) {
  const response = await fetch(`/api/kyc/${businessId}${path}`, {
    method,
    headers: { 'X-Access-Token': token, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'That did not work. Try again.')
  }
  return (await response.json()) as KycStatus
}

export const fetchKycNotice = () => request<KycNotice>('/api/kyc/notice')

export const fetchKycStatus = (businessId: number, token: string) => kycRequest(businessId, token, '/status', 'GET')

export const giveKycConsent = (businessId: number, token: string, version: string) =>
  kycRequest(businessId, token, '/consent', 'POST', JSON.stringify({ notice_version: version }), true)

export const withdrawKycConsent = (businessId: number, token: string) =>
  kycRequest(businessId, token, '/consent', 'DELETE')

export const uploadKycDocument = (businessId: number, token: string, documentType: string, file: File) => {
  const form = new FormData()
  form.append('document_type', documentType)
  form.append('file', file)
  return kycRequest(businessId, token, '/documents', 'POST', form)
}

export const declareNoUdyam = (businessId: number, token: string) =>
  kycRequest(businessId, token, '/no-udyam', 'POST')

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
  help_requested: boolean
  demo_mode: boolean
}

async function orderRequest(orderId: number, token: string, action = '') {
  const response = await fetch(`/api/orders/${orderId}${action && `/${action}`}`, {
    method: action ? 'POST' : 'GET',
    headers: { 'X-Access-Token': token },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'That did not work. Try again.')
  }
  return (await response.json()) as Order
}

export const fetchOrder = (orderId: number, token: string) => orderRequest(orderId, token)
export const placeOrder = (orderId: number, token: string) => orderRequest(orderId, token, 'place')
export const cancelOrder = (orderId: number, token: string) => orderRequest(orderId, token, 'cancel')
export async function requestHelp(orderId: number, token: string, phone: string) {
  const response = await fetch(`/api/orders/${orderId}/help`, {
    method: 'POST',
    headers: { 'X-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  if (!response.ok) throw new Error('That did not work. Check the number and try again.')
  return (await response.json()) as Order
}
export const advanceDemoOrder = (orderId: number, token: string) => orderRequest(orderId, token, 'demo-advance')

export async function requestCallback(profile: Profile, city: string | null, phone: string) {
  const response = await fetch('/api/callbacks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, city, phone, agreed_to_be_called: true }),
  })
  if (!response.ok) throw new Error('That did not work. Check the number and try again.')
}

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
