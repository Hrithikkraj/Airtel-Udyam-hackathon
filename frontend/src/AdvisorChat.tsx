import { useState, type FormEvent } from 'react'
import { useLanguage } from './i18n'
import { sendAdvisorMessage, type AdvisorAnswers, type ChatMessage, type Profile, type Recommendation } from './api'

const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Kannada', 'Gujarati', 'Telugu', 'Tamil', 'Bengali', 'Punjabi', 'Malayalam']
const GREETING = 'Tell me about your business. What do you do, and where are you based?'
const EXAMPLES = [
  'I run a kirana shop in Patna with 2 people',
  'I run a dental clinic in Pune with 8 staff',
  'We have 5 restaurants in Bengaluru',
]

type Props = {
  onDone: (profile: Profile, recommendation: Recommendation, city: string | null) => void
  onUseForm: (notice?: string) => void
}

export default function AdvisorChat({ onDone, onUseForm }: Props) {
  const { t, languageName } = useLanguage()
  const [language, setLanguage] = useState(languageName)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [answers, setAnswers] = useState<AdvisorAnswers>({})
  const [text, setText] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const typed = text.trim()
    if (!typed || isBusy) return

    const updated: ChatMessage[] = [...messages, { role: 'user', content: typed }]
    setMessages(updated)
    setText('')
    setIsBusy(true)
    try {
      const answer = await sendAdvisorMessage(updated, language, answers)
      setAnswers(answer.answers)
      if (answer.profile && answer.recommendation) {
        onDone(answer.profile, answer.recommendation, answer.answers.city ?? null)
        return
      }
      setMessages([...updated, { role: 'assistant', content: answer.reply }])
    } catch {
      onUseForm('The chat is not available right now. These few questions will get you the same bundle.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="font-semibold">
          {t('Language')}{' '}
          <select
            className="ml-1 border-2 border-ink bg-white px-2 py-1 font-normal"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="font-semibold underline underline-offset-4" onClick={() => onUseForm()}>
          {t('Use a short form instead')}
        </button>
      </div>

      <ul aria-live="polite" className="mt-6 space-y-3">
        <li className="max-w-[85%] border-l-4 border-marigold bg-white px-3 py-2">
          <span className="block text-sm font-semibold text-muted">{t('Advisor')}</span>
          {t(GREETING)}
        </li>
        {messages.length === 0 && (
          <li>
            <p className="text-sm text-muted">{t('For example:')}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="border-2 border-rule bg-white px-3 py-1.5 text-left hover:border-ink"
                  onClick={() => setText(t(example))}
                >
                  {t(example)}
                </button>
              ))}
            </div>
          </li>
        )}
        {messages.map((message, index) => (
          <li
            key={index}
            className={
              message.role === 'user'
                ? 'ml-auto w-fit max-w-[85%] bg-ink px-3 py-2 text-paper'
                : 'max-w-[85%] border-l-4 border-marigold bg-white px-3 py-2'
            }
          >
            {message.content}
          </li>
        ))}
        {isBusy && <li className="text-muted">{t('Thinking…')}</li>}
      </ul>

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
        <label className="flex-1">
          <span className="sr-only">{t('Your answer')}</span>
          <input
            className="w-full border-2 border-ink bg-white px-3 py-2 text-lg"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('Type your answer')}
          />
        </label>
        <button type="submit" disabled={isBusy} className="bg-ink px-5 py-2 font-semibold text-paper disabled:opacity-60">
          {t('Send')}
        </button>
      </form>
      <p className="mt-2 text-sm text-muted">{t('Please do not type ID numbers here. We only need yes or no for now.')}</p>
    </div>
  )
}
