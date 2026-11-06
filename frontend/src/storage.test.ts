import { describe, expect, it } from 'vitest'
import {
  DRAFT_MAX_AGE_MS,
  KEYS,
  clearDeviceData,
  clearOrderPointer,
  readLanguage,
  readOrderPointer,
  readProfileDraft,
  saveLanguage,
  saveOrderPointer,
  saveProfileDraft,
  type StorageLike,
} from './storage'

// A stand-in for the browser's localStorage, so these tests run without a browser.
function fakeStorage(start: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(start))
  return {
    data,
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  }
}

// A browser that blocks or fills localStorage, as some private windows do.
const brokenStorage: StorageLike = {
  length: 0,
  key: () => {
    throw new Error('blocked')
  },
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

const NOW = 1_800_000_000_000
const DRAFT = { full_name: 'Asha', phone: '9876543210', businesses: { '7': { business_name: 'Ganesh Woodcraft', business_type: 'Furniture' } } }

describe('order pointer', () => {
  it('saves and reads back only the three harmless fields', () => {
    const storage = fakeStorage()
    saveOrderPointer({ orderId: 3, businessId: 5, hasGstin: true, token: 'secret' } as never, storage)
    expect(JSON.parse(storage.data.get(KEYS.order)!)).toEqual({ orderId: 3, businessId: 5, hasGstin: true })
    expect(readOrderPointer(storage)).toEqual({ pointer: { orderId: 3, businessId: 5, hasGstin: true }, legacyToken: null })
  })

  it('removes a secret token left by an older version, and hands it back once to move into a cookie', () => {
    const storage = fakeStorage({ [KEYS.order]: JSON.stringify({ orderId: 3, businessId: 5, hasGstin: false, token: 'old-secret' }) })
    const result = readOrderPointer(storage)
    expect(result.legacyToken).toBe('old-secret')
    expect(storage.data.get(KEYS.order)).not.toContain('old-secret')
    expect(readOrderPointer(storage).legacyToken).toBeNull()
  })

  it.each([
    ['broken JSON', '{not json'],
    ['a list', '[1,2]'],
    ['a missing field', JSON.stringify({ orderId: 3, businessId: 5 })],
    ['a negative id', JSON.stringify({ orderId: -1, businessId: 5, hasGstin: true })],
    ['a text id', JSON.stringify({ orderId: '3', businessId: 5, hasGstin: true })],
    ['null', 'null'],
  ])('discards %s', (_name, stored) => {
    const storage = fakeStorage({ [KEYS.order]: stored })
    expect(readOrderPointer(storage)).toEqual({ pointer: null, legacyToken: null })
    expect(storage.data.has(KEYS.order)).toBe(false)
  })

  it('can be cleared', () => {
    const storage = fakeStorage()
    saveOrderPointer({ orderId: 1, businessId: 1, hasGstin: true }, storage)
    clearOrderPointer(storage)
    expect(storage.data.size).toBe(0)
  })
})

describe('profile draft', () => {
  it('reads back a draft for the same account', () => {
    const storage = fakeStorage()
    saveProfileDraft(1, DRAFT, storage, NOW)
    expect(readProfileDraft(1, storage, NOW + 1000)).toEqual(DRAFT)
  })

  it('never shows one account the draft of another account on a shared device', () => {
    const storage = fakeStorage()
    saveProfileDraft(1, DRAFT, storage, NOW)
    expect(readProfileDraft(2, storage, NOW)).toBeNull()
  })

  it('discards a draft older than a week', () => {
    const storage = fakeStorage()
    saveProfileDraft(1, DRAFT, storage, NOW)
    expect(readProfileDraft(1, storage, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull()
    expect(storage.data.has(KEYS.profileDraft)).toBe(false)
  })

  it('discards a draft dated in the future', () => {
    const storage = fakeStorage()
    saveProfileDraft(1, DRAFT, storage, NOW + 60_000)
    expect(readProfileDraft(1, storage, NOW)).toBeNull()
  })

  it.each([
    ['broken JSON', '{"version":1,'],
    ['an old version', JSON.stringify({ version: 0, userId: 1, savedAt: NOW, draft: DRAFT })],
    ['a missing date', JSON.stringify({ version: 1, userId: 1, draft: DRAFT })],
    ['a wrong field type', JSON.stringify({ version: 1, userId: 1, savedAt: NOW, draft: { ...DRAFT, full_name: 42 } })],
    ['an oversized name', JSON.stringify({ version: 1, userId: 1, savedAt: NOW, draft: { ...DRAFT, full_name: 'x'.repeat(500) } })],
  ])('discards %s', (_name, stored) => {
    const storage = fakeStorage({ [KEYS.profileDraft]: stored })
    expect(readProfileDraft(1, storage, NOW)).toBeNull()
    expect(storage.data.has(KEYS.profileDraft)).toBe(false)
  })

  it('skips a broken business entry but keeps the rest', () => {
    const stored = { version: 1, userId: 1, savedAt: NOW, draft: { ...DRAFT, businesses: { '7': DRAFT.businesses['7'], abc: {}, '9': { business_name: 5 } } } }
    const storage = fakeStorage({ [KEYS.profileDraft]: JSON.stringify(stored) })
    expect(readProfileDraft(1, storage, NOW)?.businesses).toEqual(DRAFT.businesses)
  })

  it('has no place for a password or token', () => {
    const storage = fakeStorage()
    saveProfileDraft(1, { ...DRAFT, password: 'secret', token: 'x' } as never, storage, NOW)
    expect(storage.data.get(KEYS.profileDraft)).not.toMatch(/secret|token|password/)
  })
})

describe('language', () => {
  it('remembers the choice and falls back to English for anything else', () => {
    const storage = fakeStorage()
    saveLanguage('hi', storage)
    expect(readLanguage(storage)).toBe('hi')
    storage.data.set(KEYS.language, 'klingon')
    expect(readLanguage(storage)).toBe('en')
  })
})

describe('clearing', () => {
  it('removes everything this app stored, and nothing else', () => {
    const storage = fakeStorage({ 'accel-order': '{}', 'accel-language': 'hi', 'accel-profile-draft': '{}', 'other-site': 'keep' })
    clearDeviceData(storage)
    expect([...storage.data.keys()]).toEqual(['other-site'])
  })
})

describe('a browser with storage blocked or full', () => {
  it('never throws, and behaves as if nothing is stored', () => {
    expect(readOrderPointer(brokenStorage)).toEqual({ pointer: null, legacyToken: null })
    expect(readProfileDraft(1, brokenStorage)).toBeNull()
    expect(readLanguage(brokenStorage)).toBe('en')
    expect(() => saveOrderPointer({ orderId: 1, businessId: 1, hasGstin: true }, brokenStorage)).not.toThrow()
    expect(() => saveProfileDraft(1, DRAFT, brokenStorage)).not.toThrow()
    expect(() => saveLanguage('hi', brokenStorage)).not.toThrow()
    expect(() => clearDeviceData(brokenStorage)).not.toThrow()
    expect(() => clearOrderPointer(brokenStorage)).not.toThrow()
  })

  it('also copes with no storage at all', () => {
    expect(readOrderPointer(null)).toEqual({ pointer: null, legacyToken: null })
    expect(readProfileDraft(1, null)).toBeNull()
    expect(() => clearDeviceData(null)).not.toThrow()
  })
})
