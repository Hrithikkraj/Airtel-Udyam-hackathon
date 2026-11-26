import { useState, type FormEvent } from 'react'
import { useLanguage } from './i18n'
import { ApiError, sendAdvisorMessage, type AdvisorAnswers, type ChatMessage, type Profile, type Recommendation } from './api'
import { rupees } from './format'

const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Kannada', 'Gujarati', 'Telugu', 'Tamil', 'Bengali', 'Punjabi', 'Malayalam']
const GREETING = "Hi! Tell me a little about your business and what you're hoping to improve. No need to have all the details ready—we can figure them out together."
const EXAMPLES = [
  'I run a kirana shop in Patna with 2 people',
  'I run a dental clinic in Pune with 8 staff',
  'We have 5 restaurants in Bengaluru',
]
const APPROVAL = /^(?:(?:yes|yeah|yep|sure)(?:[, ]+(?:please|let'?s see the quote))?|looks good|that'?s right|that is right|okay|ok|go ahead|show me the quote|let'?s see the quote|continue|हाँ|हां|ठीक है|सही है|दिखाइए|कोटेशन दिखाएँ)[.!।\s]*$/i
const DECLINE = /^(no|nope|not yet|change it|i want to change|नहीं|नही)[.!।\s]*$/i

type ProposedQuote = { profile: Profile; recommendation: Recommendation; city: string | null }

function answersChanged(before: AdvisorAnswers, after: AdvisorAnswers) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

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
  const [proposal, setProposal] = useState<ProposedQuote | null>(null)
  const [chatError, setChatError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const typed = text.trim()
    if (!typed || isBusy) return

    if (proposal?.recommendation.bundle && APPROVAL.test(typed)) {
      showQuote(proposal, typed)
      return
    }

    const updated: ChatMessage[] = [...messages, { role: 'user', content: typed }]
    setMessages(updated)
    setText('')
    setChatError('')
    if (proposal && DECLINE.test(typed)) {
      setMessages([...updated, { role: 'assistant', content: t("No problem. What should I change? You can correct anything we've talked about.") }])
      return
    }

    const revisingProposal = proposal !== null
    setIsBusy(true)
    try {
      const answer = await sendAdvisorMessage(updated, language, answers)
      setAnswers(answer.answers)
      if (answer.profile && answer.recommendation) {
        const nextProposal = {
          profile: answer.profile,
          recommendation: answer.recommendation,
          city: answer.answers.city ?? null,
        }
        setProposal(nextProposal)
        setMessages([
          ...updated,
          {
            role: 'assistant',
            content: revisingProposal
              ? t("Ah, thanks for clarifying. I've adjusted the suggestion—does this feel closer?")
              : t("Okay, I have a clearer picture now. Here's a place to start."),
          },
        ])
        return
      }
      if (revisingProposal && answersChanged(answers, answer.answers)) setProposal(null)
      setMessages([...updated, { role: 'assistant', content: answer.reply }])
    } catch (error) {
      setMessages(messages)
      setText(typed)
      setChatError(
        error instanceof ApiError && error.status === 503
          ? t('The advisor is having trouble connecting. Your message is still here—try again in a moment, or use the short form if you prefer.')
          : t('That message did not go through. Your message is still here—please try again.'),
      )
    } finally {
      setIsBusy(false)
    }
  }

  function showQuote(nextProposal: ProposedQuote, confirmation: string) {
    setMessages((current) => [
      ...current,
      { role: 'user', content: confirmation },
      { role: 'assistant', content: t("Sounds good—let's go through the full quote together. You can still adjust any service there.") },
    ])
    setProposal(null)
    onDone(nextProposal.profile, nextProposal.recommendation, nextProposal.city)
  }

  function quoteSummary(recommendation: Recommendation) {
    const quote = recommendation.bundle?.quote
    if (!quote) return recommendation.explanation
    const items = quote.lines.map((line) => `${line.name}${line.quantity > 1 ? ` × ${line.quantity}` : ''}`).join(', ')
    const setup = quote.setup_total_inr > 0 ? ` ${t('Plus')} ${rupees(quote.setup_total_inr)} ${t('one-time setup')}.` : ''
    return `${items}: ${rupees(quote.monthly_total_inr)} ${t('a month')}.${setup} ${quote.contract_months} ${t('month contract')}.`
  }

  return (
    <div className="panel my-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="font-semibold">
          {t('Language')}{' '}
          <select
            className="ml-1 border border-field bg-white px-2 py-1 font-normal"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={() => onUseForm()}>
          {t('Use a short form instead')}
        </button>
      </div>

      <ul aria-live="polite" className="mt-6 space-y-3">
        <li className="bubble-advisor max-w-[85%]">
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
                  className="rounded-full border border-field bg-white px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent"
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
                ? 'bubble-owner ml-auto w-fit max-w-[85%]'
                : 'bubble-advisor max-w-[85%]'
            }
          >
            {message.content}
          </li>
        ))}
        {proposal && (
          <li className="notice mt-4 max-w-[90%]">
            <p className="font-semibold">{t("Here's a starting point based on what you've told me")}</p>
            <p className="mt-1">{quoteSummary(proposal.recommendation)}</p>
            {proposal.recommendation.bundle && (
              <p className="mt-1 text-sm">
                {t('Ready in about')} {proposal.recommendation.bundle.quote.install_days}{' '}
                {t(proposal.recommendation.bundle.quote.install_days === 1 ? 'day' : 'days')}.
              </p>
            )}
            {proposal.recommendation.bundle ? (
              <>
                <p className="mt-2">{t('How does this feel? Tell me here if you want to add, remove or change anything. If it looks good, we can go through the full quote.')}</p>
                <button
                  type="button"
                  disabled={isBusy}
                  className="mt-3 bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60"
                  onClick={() => showQuote(proposal, t("Yes, let's see the quote"))}
                >
                  {t("Yes, let's see the quote")}
                </button>
              </>
            ) : (
              <p className="mt-2">{t('I could not find a suitable bundle yet. Tell me what you would like to change, and I can try again.')}</p>
            )}
          </li>
        )}
        {isBusy && <li className="text-muted">{t('Thinking…')}</li>}
      </ul>

      {chatError && (
        <p role="alert" className="notice-error mt-4 text-sm">
          {chatError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
        <label className="flex-1">
          <span className="sr-only">{t('Your answer')}</span>
          <input
            className="w-full border border-field bg-white px-3 py-2 text-lg"
            value={text}
            maxLength={1000}
            disabled={isBusy}
            onChange={(e) => setText(e.target.value)}
            placeholder={t(proposal ? 'Tell me what to change, or say “looks good”' : 'Write a message')}
          />
        </label>
        <button type="submit" disabled={isBusy} className="bg-accent px-5 py-2 font-semibold text-white disabled:opacity-60">
          {t('Send')}
        </button>
      </form>
      <p className="mt-2 text-sm text-muted">{t('Quick privacy note: please do not share ID numbers. For GSTIN, yes or no is all I need.')}</p>
    </div>
  )
}
