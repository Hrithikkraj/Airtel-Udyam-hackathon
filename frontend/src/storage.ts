// Everything this app keeps in the browser's localStorage goes through this file.
//
// Only non-sensitive convenience data is kept here: which order this browser is following, the
// language choice, and an unsaved profile draft. Passwords, sign-in tokens, order secrets and KYC
// details are never stored here. Those stay on the server or in HttpOnly cookies scripts cannot read.
//
// Stored data can be broken, old, or from an earlier version of the app, so every read checks the
// shape and quietly removes anything that does not fit.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  readonly length: number
  key: (index: number) => string | null
}

export const KEYS = {
  order: 'accel-order',
  profileDraft: 'accel-profile-draft',
  language: 'accel-language',
}
const OUR_PREFIX = 'accel-'
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DRAFT_VERSION = 1
const MAX_TEXT_LENGTH = 120

// localStorage can be switched off or full, for example in some private windows. The app must still work.
function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readJson(key: string, storage: StorageLike | null): unknown {
  if (!storage) return undefined
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    remove(key, storage) // Broken data is removed, so it cannot cause trouble again.
    return undefined
  }
}

function write(key: string, value: unknown, storage: StorageLike | null): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false // Storage full or blocked. Nothing here is essential, so carry on.
  }
}

function remove(key: string, storage: StorageLike | null) {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing more can be done, and the app does not depend on it.
  }
}

const isPositiveWhole = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const shortText = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : null

// ---------- The order this browser is following ----------

export type OrderPointer = { orderId: number; businessId: number; hasGstin: boolean }

/** Returns the saved order, plus any secret token an older version of the app left behind.
 *  That token is removed from storage at once. It is handed back only so it can be moved into a cookie. */
export function readOrderPointer(storage = browserStorage()): { pointer: OrderPointer | null; legacyToken: string | null } {
  const value = readJson(KEYS.order, storage)
  if (value === undefined) return { pointer: null, legacyToken: null }
  if (!isObject(value) || !isPositiveWhole(value.orderId) || !isPositiveWhole(value.businessId) || typeof value.hasGstin !== 'boolean') {
    remove(KEYS.order, storage)
    return { pointer: null, legacyToken: null }
  }
  const pointer = { orderId: value.orderId, businessId: value.businessId, hasGstin: value.hasGstin }
  const legacyToken = typeof value.token === 'string' && value.token ? value.token : null
  if ('token' in value) write(KEYS.order, pointer, storage)
  return { pointer, legacyToken }
}

export function saveOrderPointer(pointer: OrderPointer, storage = browserStorage()) {
  // Only these three fields are written, whatever else the object holds.
  write(KEYS.order, { orderId: pointer.orderId, businessId: pointer.businessId, hasGstin: pointer.hasGstin }, storage)
}

export function clearOrderPointer(storage = browserStorage()) {
  remove(KEYS.order, storage)
}

// ---------- Unsaved profile changes ----------

export type BusinessDraft = { business_name: string; business_type: string }
export type ProfileDraft = { full_name: string; phone: string; businesses: Record<string, BusinessDraft> }

/** A draft is kept only for the account that wrote it, and only for a week. */
export function readProfileDraft(userId: number, storage = browserStorage(), now = Date.now()): ProfileDraft | null {
  const value = readJson(KEYS.profileDraft, storage)
  if (value === undefined) return null
  const isValid =
    isObject(value) &&
    value.version === DRAFT_VERSION &&
    typeof value.savedAt === 'number' &&
    now - value.savedAt <= DRAFT_MAX_AGE_MS &&
    value.savedAt <= now &&
    isObject(value.draft)
  if (!isValid) {
    remove(KEYS.profileDraft, storage)
    return null
  }
  if (value.userId !== userId) return null // Another account's draft on a shared device is never shown.

  const draft = value.draft as Record<string, unknown>
  const fullName = shortText(draft.full_name)
  const phone = shortText(draft.phone)
  const businesses: Record<string, BusinessDraft> = {}
  if (isObject(draft.businesses)) {
    for (const [id, business] of Object.entries(draft.businesses)) {
      if (!/^\d+$/.test(id) || !isObject(business)) continue
      const name = shortText(business.business_name)
      const type = shortText(business.business_type)
      if (name !== null && type !== null) businesses[id] = { business_name: name, business_type: type }
    }
  }
  if (fullName === null || phone === null) {
    remove(KEYS.profileDraft, storage)
    return null
  }
  return { full_name: fullName, phone, businesses }
}

export function saveProfileDraft(userId: number, draft: ProfileDraft, storage = browserStorage(), now = Date.now()) {
  const businesses: Record<string, BusinessDraft> = {}
  for (const [id, business] of Object.entries(draft.businesses)) {
    businesses[id] = {
      business_name: business.business_name.slice(0, MAX_TEXT_LENGTH),
      business_type: business.business_type.slice(0, MAX_TEXT_LENGTH),
    }
  }
  write(
    KEYS.profileDraft,
    {
      version: DRAFT_VERSION,
      userId,
      savedAt: now,
      draft: { full_name: draft.full_name.slice(0, MAX_TEXT_LENGTH), phone: draft.phone.slice(0, MAX_TEXT_LENGTH), businesses },
    },
    storage,
  )
}

export function clearProfileDraft(storage = browserStorage()) {
  remove(KEYS.profileDraft, storage)
}

// ---------- Language ----------

export function readLanguage(storage = browserStorage()): 'en' | 'hi' {
  try {
    return storage?.getItem(KEYS.language) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

export function saveLanguage(language: 'en' | 'hi', storage = browserStorage()) {
  try {
    storage?.setItem(KEYS.language, language)
  } catch {
    // Not essential.
  }
}

// ---------- Clearing ----------

/** Removes everything this app has stored in this browser, and nothing belonging to other sites. */
export function clearDeviceData(storage = browserStorage()) {
  if (!storage) return
  const ours: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(OUR_PREFIX)) ours.push(key)
    }
  } catch {
    return
  }
  ours.forEach((key) => remove(key, storage))
}
