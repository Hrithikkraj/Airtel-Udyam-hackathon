import { describe, expect, it } from 'vitest'
import { trimAdvisorMessages, type ChatMessage } from './api'

describe('advisor conversation context', () => {
  it('sends only the most recent messages', () => {
    const messages: ChatMessage[] = Array.from({ length: 42 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index}`,
    }))

    const context = trimAdvisorMessages(messages)

    expect(context).toHaveLength(20)
    expect(context[0].content).toBe('message 22')
    expect(context[19].content).toBe('message 41')
  })

  it('caps older assistant replies at the API message limit', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'x'.repeat(1200) }]

    expect(trimAdvisorMessages(messages)[0].content).toHaveLength(1000)
  })
})
