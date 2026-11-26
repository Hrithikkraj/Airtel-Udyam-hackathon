import { useState, type FormEvent } from 'react'
import { useLanguage } from './i18n'
import { ApiError, sendAdvisorMessage, type AdvisorAnswers, type ChatMessage, type Profile, type Recommendation } from './api'
import { rupees } from './format'

const GREETING = "Hi! Tell me a little about your business and what you're hoping to improve. No need to have all the details ready—we can figure them out together."
const EXAMPLES = [
  'I run a kirana shop in Patna with 2 people',
  'I run a dental clinic in Pune with 8 staff',
  'We have 5 restaurants in Bengaluru',
]

// Matches only when the whole message is one of these, so "haan but add CCTV" goes to the advisor.
const wholeMessage = (choices: string[]) =>
  new RegExp(`^(?:${choices.join('|')})(?:[, ]+(?:ji|जी|please|plz|pls))?[.!।\\s]*$`, 'i')

const APPROVAL = wholeMessage([
  "(?:yes|yeah|yep|sure)(?:[, ]+(?:please|let'?s see the quote))?",
  'looks good', "that'?s right", 'that is right', 'okay', 'ok', 'go ahead', 'show me the quote', "let'?s see the quote", 'continue',
  // Hindi, in Devanagari and in English letters
  '(?:हाँ|हां)(?:[, ]+(?:ठीक है|दिखाइए|दिखाओ))?', 'जी हाँ', 'ठीक है', 'सही है', 'दिखाइए', 'दिखाओ', 'कोटेशन दिखाएँ',
  '(?:haa?n|ha|ji haa?n)(?:[, ]+(?:theek hai|thik hai|dikhao|dikha do|quote dikhao))?',
  '(?:theek|thik) (?:hai|h)', '(?:sab )?sahi hai', 'achha', 'accha', 'acha', 'chalega', 'dikhao', 'dikha do', 'quote dikhao', 'kar do', 'aage badho',
  // Marathi
  'होय', 'हो', 'ठीक आहे', 'बरोबर', 'चालेल', 'दाखवा',
  // Tamil
  'ஆமா', 'ஆமாம்', 'சரி', 'seri', 'sari', 'aama', 'aamam',
  // Telugu
  'అవును', 'సరే', 'avunu', 'sare',
  // Kannada
  'ಹೌದು', 'ಸರಿ', 'ಆಯ್ತು', 'houdu', 'haudu', 'aaytu',
  // Gujarati
  'હા', 'બરાબર', 'ચાલશે', 'બતાવો', 'barabar', 'chalshe',
  // Bengali
  'হ্যাঁ', 'হ্যা', 'ঠিক আছে', 'আচ্ছা', 'দেখান', 'hyan', 'thik ache',
  // Punjabi
  'ਹਾਂ', 'ਠੀਕ ਹੈ', 'ਸਹੀ ਹੈ', 'ਦਿਖਾਓ',
  // Malayalam
  'അതെ', 'ശരി', 'shari', 'athe',
])

const DECLINE = wholeMessage([
  'no', 'nope', 'not yet', 'change it', 'i want to change',
  // Hindi, in Devanagari and in English letters
  'नहीं', 'नही', 'अभी नहीं', 'बदलना है',
  'nahi', 'nahin', 'nhi', 'nai', 'na', 'abhi nahi', 'badalna (?:hai|h)', 'change karna (?:hai|h)', 'kuch badalna hai', 'badlo', 'badal do',
  // Marathi
  'नाही', 'नको', 'बदलायचं आहे', 'बदलायचे आहे', 'nako',
  // Tamil
  'இல்லை', 'வேண்டாம்', 'மாற்றணும்', 'illa', 'illai', 'vendam', 'venam',
  // Telugu
  'లేదు', 'వద్దు', 'మార్చాలి', 'ledu', 'vaddu',
  // Kannada
  'ಇಲ್ಲ', 'ಬೇಡ', 'ಬದಲಾಯಿಸಬೇಕು', 'beda',
  // Gujarati
  'ના', 'નથી', 'બદલવું છે', 'naa',
  // Bengali
  'না', 'বদলাতে চাই', 'chai na',
  // Punjabi
  'ਨਹੀਂ', 'ਨਹੀ', 'ਬਦਲਣਾ ਹੈ',
  // Malayalam
  'ഇല്ല', 'വേണ്ട', 'മാറ്റണം', 'venda',
])

// The few chat lines our page writes itself follow the chat's language, not the website's language.
// Other languages get the English line. Buttons and the quote card still follow the website's language.
type ChatLine = 'firstProposal' | 'revisedProposal' | 'toQuote' | 'whatToChange'
const CHAT_LINES: Record<string, Record<ChatLine, string>> = {
  English: {
    firstProposal: "Okay, I have a clearer picture now. Here's a place to start.",
    revisedProposal: "Ah, thanks for clarifying. I've adjusted the suggestion—does this feel closer?",
    toQuote: "Sounds good—let's go through the full quote together. You can still adjust any service there.",
    whatToChange: "No problem. What should I change? You can correct anything we've talked about.",
  },
  Hindi: {
    firstProposal: 'ठीक है, अब मुझे आपकी ज़रूरत बेहतर समझ आ गई है। यहाँ से शुरुआत कर सकते हैं।',
    revisedProposal: 'अच्छा, बताने के लिए शुक्रिया। मैंने सुझाव बदल दिया है—क्या यह अब बेहतर लग रहा है?',
    toQuote: 'ठीक है—आइए पूरा कोटेशन साथ में देखते हैं। वहाँ आप कोई भी सेवा बदल सकते हैं।',
    whatToChange: 'कोई बात नहीं। आप क्या बदलना चाहेंगे? अब तक बताई गई कोई भी बात सुधार सकते हैं।',
  },
  Hinglish: {
    firstProposal: 'Theek hai, ab mujhe aapki zaroorat achhe se samajh aa gayi hai. Yahan se shuru kar sakte hain.',
    revisedProposal: 'Achha, batane ke liye shukriya. Maine suggestion badal diya hai—kya ab yeh behtar lag raha hai?',
    toQuote: 'Theek hai—chaliye poora quote saath mein dekhte hain. Wahan aap koi bhi service badal sakte hain.',
    whatToChange: 'Koi baat nahi. Aap kya badalna chahenge? Ab tak batayi gayi koi bhi baat sudhaar sakte hain.',
  },
}
const chatLine = (line: ChatLine, language: string) => (CHAT_LINES[language] ?? CHAT_LINES.English)[line]

// "haan" or "नहीं" is answered by our page without the server, so the page guesses its language.
const DEVANAGARI = /[ऀ-ॿ]/
const HINDI_IN_ENGLISH_LETTERS = /\b(?:haa?n|ha|theek|thik|sahi|achha|accha|acha|chalega|dikhao|dikha|kar do|nahi|nahin|nhi|nai|badalna|badlo|badal)\b/i
function shortReplyLanguage(typed: string, current: string) {
  if (DEVANAGARI.test(typed) && (current === 'English' || current === 'Hinglish')) return 'Hindi'
  if (HINDI_IN_ENGLISH_LETTERS.test(typed) && (current === 'English' || current === 'Hindi')) return 'Hinglish'
  return current
}

type ProposedQuote = { profile: Profile; recommendation: Recommendation; city: string | null }

// The two most important reasons from the product details already in the reply. No extra request.
function topReasons(recommendation: Recommendation) {
  const bundle = recommendation.bundle
  if (!bundle?.details) return []
  const reasons = bundle.quote.lines
    .map((line) => bundle.details?.[line.product_id]?.why?.[0])
    .filter((reason): reason is string => Boolean(reason))
  return [...new Set(reasons)].slice(0, 2)
}

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
  // The language the advisor found in the owner's messages. Until the first reply, the website's
  // language is the hint. It is sent with each message so "2" or "ok" keeps the chat's language.
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  const chatLanguage = detectedLanguage ?? languageName
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
      showQuote(proposal, typed, shortReplyLanguage(typed, chatLanguage))
      return
    }

    const updated: ChatMessage[] = [...messages, { role: 'user', content: typed }]
    setMessages(updated)
    setText('')
    setChatError('')
    if (proposal && DECLINE.test(typed)) {
      const replyLanguage = shortReplyLanguage(typed, chatLanguage)
      setDetectedLanguage(replyLanguage)
      setMessages([...updated, { role: 'assistant', content: chatLine('whatToChange', replyLanguage) }])
      return
    }

    const revisingProposal = proposal !== null
    setIsBusy(true)
    try {
      const answer = await sendAdvisorMessage(updated, chatLanguage, answers)
      // Only a reply that arrived changes the chat's language. A failed request keeps it as it was.
      const replyLanguage = answer.language || chatLanguage
      setDetectedLanguage(replyLanguage)
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
            content: chatLine(revisingProposal ? 'revisedProposal' : 'firstProposal', replyLanguage),
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

  function showQuote(nextProposal: ProposedQuote, confirmation: string, replyLanguage: string) {
    setDetectedLanguage(replyLanguage)
    setMessages((current) => [
      ...current,
      { role: 'user', content: confirmation },
      { role: 'assistant', content: chatLine('toQuote', replyLanguage) },
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
      {/* No language picker: the advisor replies in the language the owner writes in. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
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
            {topReasons(proposal.recommendation).length > 0 && (
              <p className="mt-1 text-sm">
                <span className="font-semibold">{t('Why this bundle')}:</span> {topReasons(proposal.recommendation).join(' ')}
              </p>
            )}
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
                  onClick={() => showQuote(proposal, t("Yes, let's see the quote"), chatLanguage)}
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
