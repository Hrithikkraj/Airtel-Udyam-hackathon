import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowRight, Bot, Clock, Link2, ListChecks, Lock, MessageSquarePlus, Mic, SendHorizontal, Sparkles, Square, Unlink, Volume2, VolumeX } from 'lucide-react'
import { m, useInView, useReducedMotion } from 'motion/react'
import { useLanguage } from './i18n'
import { ApiError, sendAdvisorMessage, transcribeAudio, type AdvisorAnswers, type ChatMessage, type Profile, type Recommendation } from './api'
import { rupees } from './format'
import { canRecord, canSpeak, useSpeech, useVoiceRecorder, type VoiceProblem } from './voice'
import AnimatedNumber from './ui/AnimatedNumber'
import Button from './ui/Button'
import Chip from './ui/Chip'
import Spinner from './ui/Spinner'
import { cx } from './ui/cx'
import { DURATION, EASE_OUT } from './ui/motionTokens'

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
  // The order this chat belongs to. A quote accepted here updates that order, so the owner is told.
  linkedOrderId?: number
  // False once the linked order is placed: a quote accepted here then starts a new order instead.
  linkedOrderCanChange?: boolean
  // Clears this conversation. With separate = true it also stops following the linked order, so the
  // next quote starts a new order. The old order stays on the owner's profile.
  onNewChat: (separate: boolean) => void
}

export default function AdvisorChat({ onDone, onUseForm, linkedOrderId, linkedOrderCanChange = false, onNewChat }: Props) {
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
  const reduceMotion = useReducedMotion()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isLatestVisible = useInView(endRef)

  // Voice: the microphone fills the chat box, and replies can be read aloud.
  const [voiceInput] = useState(canRecord)
  const [voiceOutput] = useState(canSpeak)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  // Once the owner turns reading aloud on or off, the microphone no longer turns it on for them.
  const readAloudChosenRef = useRef(false)
  const [voiceNotice, setVoiceNotice] = useState('')
  const speech = useSpeech()
  const recorder = useVoiceRecorder({ onRecorded: handleRecorded, onProblem: handleVoiceProblem })

  // Reads an advisor reply aloud when the owner asked for that. The phone may have no voice for the
  // chat's language; the reply is still on screen, and the owner is told once.
  function speakReply(content: string, language: string) {
    if (!readAloud) return
    if (!speech.speak(content, language)) {
      setVoiceNotice(t('This phone has no voice for this language, so replies are shown as text only.'))
    }
  }

  function toggleReadAloud() {
    readAloudChosenRef.current = true
    const next = !readAloud
    setReadAloud(next)
    setVoiceNotice('')
    if (!next) {
      speech.stop()
      return
    }
    // Turning it on reads the latest advisor message, so the owner hears that it works.
    const latest = [...messages].reverse().find((message) => message.role === 'assistant')
    const content = latest?.content ?? t(GREETING)
    if (!speech.speak(content, latest ? chatLanguage : languageName)) {
      setVoiceNotice(t('This phone has no voice for this language, so replies are shown as text only.'))
    }
  }

  function toggleRecording() {
    if (recorder.isRecording) {
      recorder.stop()
      return
    }
    // The advisor stops talking, so the microphone does not hear it.
    speech.stop()
    setChatError('')
    setVoiceNotice('')
    void recorder.start()
  }

  async function handleRecorded(audio: Blob) {
    // Someone who talks to the advisor most likely wants to hear it too, until they say otherwise.
    if (voiceOutput && !readAloudChosenRef.current) setReadAloud(true)
    setIsTranscribing(true)
    try {
      const heard = (await transcribeAudio(audio, chatLanguage)).text.trim()
      if (!heard) {
        setChatError(t("I didn't catch that. Please try again, or type your message."))
        return
      }
      // The words go into the chat box, so the owner can check them before sending.
      setText((current) => (current.trim() ? `${current.trim()} ${heard}` : heard).slice(0, 1000))
      inputRef.current?.focus()
    } catch (error) {
      setChatError(
        error instanceof ApiError && error.status === 503
          ? t('Voice is not available right now. Please type your message.')
          : t('That recording did not go through. Please try again, or type your message.'),
      )
    } finally {
      setIsTranscribing(false)
    }
  }

  function handleVoiceProblem(problem: VoiceProblem) {
    const messagesFor: Record<VoiceProblem, string> = {
      denied: 'Allow the microphone for this site to speak your message. You can always type instead.',
      noMicrophone: 'No microphone was found. Please type your message.',
      tooShort: 'That was too short. Tap the microphone, speak, then tap again to finish.',
      failed: 'The microphone did not start. Please try again, or type your message.',
    }
    setChatError(t(messagesFor[problem]))
  }

  // Keep the newest message in view as the conversation grows. Not before the first message, so
  // opening the page does not jump.
  useEffect(() => {
    if (messages.length === 0) return
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages.length, isBusy, proposal, reduceMotion])

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
      speakReply(chatLine('whatToChange', replyLanguage), replyLanguage)
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
        const proposalLine = chatLine(revisingProposal ? 'revisedProposal' : 'firstProposal', replyLanguage)
        setMessages([...updated, { role: 'assistant', content: proposalLine }])
        speakReply(proposalLine, replyLanguage)
        return
      }
      if (revisingProposal && answersChanged(answers, answer.answers)) setProposal(null)
      setMessages([...updated, { role: 'assistant', content: answer.reply }])
      speakReply(answer.reply, replyLanguage)
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
    // The quote page is read on screen, so the advisor stops talking.
    speech.stop()
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

  // Starting over asks first only when there is something to lose.
  function startNewChat(separate: boolean) {
    if (messages.length > 0 && !window.confirm(t('Start a new chat? This conversation will be cleared.'))) return
    speech.stop()
    onNewChat(separate)
  }

  const bundle = proposal?.recommendation.bundle
  // New messages rise in gently. Earlier ones are already on screen and stay still.
  const entrance = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: DURATION.slow, ease: EASE_OUT } }

  return (
    <div className="card my-6 p-0!">
      {/* The advisor's name card. No language picker: it replies in the language the owner writes in. */}
      {/* Two calm rows: who you are talking to (with the voice switch), then the chat's own actions. */}
      <div className="border-b border-ink-100 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <AdvisorAvatar size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-tight">{t('Advisor')}</p>
            <p className="mt-1 flex items-center gap-1.5 text-caption text-ink-500">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success-500" />
              <span className="truncate">{t('Replies in your language')}</span>
            </p>
          </div>
          {voiceOutput && (
            // Grey when off, filled red when on, so its state is clear at a glance.
            <button
              type="button"
              onClick={toggleReadAloud}
              aria-pressed={readAloud}
              aria-label={t('Read replies aloud')}
              title={t('Read replies aloud')}
              className={cx(
                'flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,box-shadow] duration-200 ease-spring active:scale-90',
                readAloud ? 'bg-brand-600 text-white shadow-brand hover:bg-brand-700' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50',
              )}
            >
              {readAloud ? <Volume2 aria-hidden="true" size={20} /> : <VolumeX aria-hidden="true" size={20} />}
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 sm:pl-14">
          <Button variant="secondary" size="sm" icon={<MessageSquarePlus aria-hidden="true" size={18} />} onClick={() => startNewChat(false)}>
            {t('New chat')}
          </Button>
          <Button variant="secondary" size="sm" icon={<ListChecks aria-hidden="true" size={18} />} onClick={() => onUseForm()}>
            {t('Use a short form instead')}
          </Button>
        </div>
      </div>

      {/* Which order this conversation belongs to, so a quote never lands on the wrong order. */}
      {linkedOrderId !== undefined && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-100 bg-info-50 px-4 py-2.5 text-small sm:px-5">
          <Link2 aria-hidden="true" size={16} className="shrink-0 text-info-700" />
          <p className="min-w-0 flex-1">
            <span className="font-bold">
              {t('Linked to')} {t('Order')} #{linkedOrderId}.
            </span>{' '}
            {t(
              linkedOrderCanChange
                ? 'A quote you accept here updates that order. Your documents stay as they are.'
                : 'That order is already placed, so a quote you accept here starts a new order.',
            )}
          </p>
          {/* The way to a brand-new business: empty chat, no quote, no order. Shown for placed orders too. */}
          <Button variant="secondary" size="sm" className="bg-white" icon={<Unlink aria-hidden="true" size={16} />} onClick={() => onNewChat(true)}>
            {t('Start fresh for a new business')}
          </Button>
        </div>
      )}

      <ul role="log" aria-live="polite" className="space-y-4 px-4 pt-5 pb-2 sm:px-5">
        <li className="flex items-end gap-2">
          <AdvisorAvatar size="sm" />
          <p className="bubble-advisor max-w-[85%]">{t(GREETING)}</p>
        </li>
        {messages.length === 0 && (
          <li className="pl-10">
            <p className="eyebrow">{t('For example:')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <Chip
                  key={example}
                  className="whitespace-normal! text-left"
                  icon={<Sparkles size={16} className="text-brand-600" />}
                  onClick={() => {
                    setText(t(example))
                    inputRef.current?.focus()
                  }}
                >
                  {t(example)}
                </Chip>
              ))}
            </div>
          </li>
        )}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <m.li key={index} {...entrance} className="flex justify-end">
              <p className="bubble-owner max-w-[85%] break-words">{message.content}</p>
            </m.li>
          ) : (
            <m.li key={index} {...entrance} className="flex items-end gap-2">
              <AdvisorAvatar size="sm" />
              <p className="bubble-advisor max-w-[85%] break-words">{message.content}</p>
            </m.li>
          ),
        )}
        {proposal && (
          <m.li {...entrance} className="pl-0 sm:pl-10">
            <div className="overflow-hidden rounded-card bg-white shadow-e3 ring-1 ring-brand-100">
              <div className="brand-mesh px-5 py-4">
                <p className="flex items-center gap-2 text-small font-semibold text-white">
                  <Sparkles aria-hidden="true" size={16} />
                  {t("Here's a starting point based on what you've told me")}
                </p>
                {bundle && (
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                    <AnimatedNumber value={bundle.quote.monthly_total_inr} countFrom={0} format={rupees} className="text-price font-extrabold" />
                    <span className="font-semibold text-white">{t('a month')}</span>
                  </p>
                )}
              </div>
              <div className="space-y-3 px-5 py-4">
                {bundle ? (
                  <>
                    <ul className="flex flex-wrap gap-2">
                      {bundle.quote.lines.map((line) => (
                        <li key={line.product_id} className="badge badge-neutral whitespace-normal!">
                          {line.name}
                          {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                        </li>
                      ))}
                    </ul>
                    <p className="text-small text-ink-600">
                      {bundle.quote.setup_total_inr > 0 ? `${t('Plus')} ${rupees(bundle.quote.setup_total_inr)} ${t('one-time setup')}. ` : ''}
                      {bundle.quote.contract_months} {t('month contract')}.
                    </p>
                    {topReasons(proposal.recommendation).length > 0 && (
                      <p className="rounded-control bg-ink-50 px-3 py-2 text-small">
                        <span className="font-bold">{t('Why this bundle')}:</span> {topReasons(proposal.recommendation).join(' ')}
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-small text-ink-600">
                      <Clock aria-hidden="true" size={16} />
                      {t('Ready in about')} {bundle.quote.install_days} {t(bundle.quote.install_days === 1 ? 'day' : 'days')}.
                    </p>
                    <p className="text-small">
                      {t('How does this feel? Tell me here if you want to add, remove or change anything. If it looks good, we can go through the full quote.')}
                    </p>
                    <Button
                      block
                      disabled={isBusy}
                      iconAfter={<ArrowRight aria-hidden="true" size={18} />}
                      onClick={() => showQuote(proposal, t("Yes, let's see the quote"), chatLanguage)}
                    >
                      {t("Yes, let's see the quote")}
                    </Button>
                  </>
                ) : (
                  <p>{quoteSummary(proposal.recommendation)} {t('I could not find a suitable bundle yet. Tell me what you would like to change, and I can try again.')}</p>
                )}
              </div>
            </div>
          </m.li>
        )}
        {isBusy && (
          <m.li {...entrance} className="flex items-end gap-2">
            <AdvisorAvatar size="sm" />
            <span className="bubble-advisor flex items-center gap-1.5 py-3.5!">
              <span className="sr-only">{t('Thinking…')}</span>
              {[0, 150, 300].map((delay) => (
                <span key={delay} aria-hidden="true" className="size-2 animate-typing rounded-full bg-ink-400" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          </m.li>
        )}
      </ul>
      <div ref={endRef} aria-hidden="true" className="h-px" />

      {chatError && (
        <p role="alert" className="notice-error mx-4 mb-3 text-small sm:mx-5">
          {chatError}
        </p>
      )}

      {/* The composer stays at the bottom of the screen, above the navigation, while the chat scrolls. */}
      <div className="sticky bottom-(--nav-offset) z-20 rounded-b-card">
        {!isLatestVisible && messages.length > 1 && (
          <div className="pointer-events-none absolute -top-14 right-4 flex justify-end">
            <button
              type="button"
              aria-label={t('Go to the latest message')}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-white text-ink-800 shadow-e3 ring-1 ring-ink-200"
              onClick={() => endRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' })}
            >
              <ArrowDown aria-hidden="true" size={20} />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="glass flex items-center gap-2 rounded-b-card border-t border-ink-100 px-3 py-3 sm:px-4">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('Your answer')}</span>
            <input
              ref={inputRef}
              className="input chat-input"
              value={text}
              maxLength={1000}
              disabled={isBusy}
              onChange={(e) => setText(e.target.value)}
              placeholder={t(
                recorder.isRecording
                  ? 'Listening… tap the red button when you finish'
                  : isTranscribing
                    ? 'Writing down what you said…'
                    : proposal
                      ? 'Tell me what to change, or say “looks good”'
                      : voiceInput
                        ? 'Write or speak a message'
                        : 'Write a message',
              )}
            />
          </label>
          {voiceInput && (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={isBusy || isTranscribing}
              aria-pressed={recorder.isRecording}
              aria-label={t(recorder.isRecording ? 'Stop recording' : 'Speak your message')}
              className={cx(
                'flex size-12 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200 ease-spring active:scale-90',
                recorder.isRecording ? 'animate-pulse bg-brand-600 text-white shadow-brand' : 'bg-ink-100 text-ink-700 hover:bg-ink-200',
              )}
            >
              {isTranscribing ? (
                <Spinner size={20} />
              ) : recorder.isRecording ? (
                <Square aria-hidden="true" size={18} fill="currentColor" />
              ) : (
                <Mic aria-hidden="true" size={20} />
              )}
            </button>
          )}
          {/* Screen readers hear when listening starts and stops. */}
          <span className="sr-only" aria-live="polite">
            {recorder.isRecording ? t('Listening') : isTranscribing ? t('Writing down what you said…') : ''}
          </span>
          <button
            type="submit"
            disabled={isBusy || !text.trim()}
            aria-label={t('Send')}
            className={cx(
              'flex size-12 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-200 ease-spring active:scale-90',
              text.trim() && !isBusy ? 'bg-brand-600 text-white shadow-brand hover:bg-brand-700' : 'bg-ink-100 text-ink-400',
            )}
          >
            <SendHorizontal aria-hidden="true" size={20} />
          </button>
        </form>
      </div>
      <p className="flex items-start gap-1.5 px-4 pt-1 pb-4 text-caption text-ink-500 sm:px-5">
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          {t('Quick privacy note: please do not share ID numbers. For GSTIN, yes or no is all I need.')}
          {voiceInput && ` ${t('Voice messages are turned into text and never stored.')}`}
        </span>
      </p>
      {voiceNotice && (
        <p role="status" className="px-4 pb-4 text-caption text-ink-500 sm:px-5">
          {voiceNotice}
        </p>
      )}
    </div>
  )
}

// The advisor's round picture: our bot mark on brand red. Decorative, as the name is written nearby.
function AdvisorAvatar({ size }: { size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-brand-500 to-brand-800 text-white shadow-e1',
        size === 'sm' ? 'size-8' : 'size-11',
      )}
    >
      <Bot size={size === 'sm' ? 16 : 22} />
    </span>
  )
}
