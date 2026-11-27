import { describe, expect, it } from 'vitest'
import { pickVoice, speechTag } from './voice'

describe('reading replies aloud', () => {
  it('maps the chat language to a phone voice language', () => {
    expect(speechTag('Hindi')).toBe('hi-IN')
    expect(speechTag('Tamil')).toBe('ta-IN')
    // Hindi in English letters still sounds right in a Hindi voice.
    expect(speechTag('Hinglish')).toBe('hi-IN')
    expect(speechTag('Klingon')).toBe('en-IN')
  })

  it('prefers the exact voice, then any voice of the same language', () => {
    const voices = [{ lang: 'en-US' }, { lang: 'en-IN' }, { lang: 'hi_IN' }]
    expect(pickVoice(voices, 'en-IN')).toBe(voices[1])
    // Android writes hi_IN with an underscore.
    expect(pickVoice(voices, 'hi-IN')).toBe(voices[2])
    expect(pickVoice([{ lang: 'en-US' }], 'en-IN')).toEqual({ lang: 'en-US' })
  })

  it('stays silent rather than reading Tamil with an English voice', () => {
    expect(pickVoice([{ lang: 'en-IN' }, { lang: 'hi-IN' }], 'ta-IN')).toBeNull()
  })
})
