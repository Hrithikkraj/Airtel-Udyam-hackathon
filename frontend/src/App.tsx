import { useCallback, useEffect, useState } from 'react'
import AdvisorChat from './AdvisorChat'
import CataloguePage from './CataloguePage'
import GuidedForm from './GuidedForm'
import JourneySteps, { type StepKey } from './JourneySteps'
import KycPage from './KycPage'
import OrderPage from './OrderPage'
import PageHeader from './PageHeader'
import QuotePage from './QuotePage'
import StaffPage from './StaffPage'
import { useLanguage } from './i18n'
import { fetchAdvisorStatus, type Profile, type Recommendation } from './api'

type Screen = 'advisor' | 'form' | 'quote' | 'order' | 'kyc' | 'catalogue' | 'staff'
const SCREENS: Screen[] = ['advisor', 'form', 'quote', 'order', 'kyc', 'catalogue', 'staff']

const TITLES: Record<Screen, { title: string; intro: string }> = {
  advisor: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  form: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  quote: { title: 'Your quote', intro: 'Switch things on or off and the price updates straight away.' },
  order: { title: 'Your order', intro: 'Check here any time. There is no need to call to find out where things stand.' },
  kyc: { title: 'Verify your business', intro: 'Upload your documents and see the result straight away.' },
  staff: { title: 'Staff and partners', intro: 'Reviews, call-backs, installations and the funnel, all in one place.' },
  catalogue: { title: 'Rate list for your business', intro: 'See what each service costs and what it needs before you buy. Your quote confirms the exact price.' },
}

// Where the Back button goes when there is no earlier page in this visit, such as after a reload.
const PARENT: Partial<Record<Screen, Screen | 'home'>> = {
  quote: 'home',
  order: 'home',
  kyc: 'order',
  catalogue: 'home',
  staff: 'home',
}

const STEP_FOR_SCREEN: Partial<Record<Screen, StepKey>> = {
  advisor: 'choose',
  form: 'choose',
  quote: 'quote',
  kyc: 'verify',
  order: 'order',
}

// What the browser remembers, so the owner can come back to their tracker later.
type OrderSession = { orderId: number; businessId: number; token: string; hasGstin: boolean }
const SESSION_KEY = 'accel-order'

function loadSession(): OrderSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

function screenInAddress(): Screen | null {
  const name = window.location.hash.replace('#/', '')
  return SCREENS.includes(name as Screen) ? (name as Screen) : null
}

// How many pages deep this visit is. Back only steps through the browser history while above zero.
function historyDepth(): number {
  return window.history.state?.depth ?? 0
}

export default function App() {
  const { t } = useLanguage()
  const [session, setSession] = useState<OrderSession | null>(loadSession)
  const [homeScreen, setHomeScreen] = useState<Screen>('form')
  const [profile, setProfile] = useState<Profile>()
  const [recommendation, setRecommendation] = useState<Recommendation>()
  const [acceptedRecommendation, setAcceptedRecommendation] = useState<Recommendation>()
  const [city, setCity] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string>()

  // A screen can only open if what it shows still exists. After a reload the quote is gone, for example.
  const canShow = useCallback(
    (wanted: Screen | null): wanted is Screen => {
      if (wanted === null) return false
      if (wanted === 'quote') return Boolean(recommendation && profile)
      if (wanted === 'order' || wanted === 'kyc') return Boolean(session)
      return true
    },
    [recommendation, profile, session],
  )

  const [screen, setScreen] = useState<Screen>(() => {
    if (sessionStorage.getItem('accel-staff-key')) return 'staff'
    const inAddress = screenInAddress()
    if (inAddress === 'order' || inAddress === 'kyc') return session ? inAddress : 'form'
    if (inAddress && inAddress !== 'quote') return inAddress
    return session ? 'order' : 'form'
  })

  // Record the first page, so the browser address always matches what is on screen.
  useEffect(() => {
    window.history.replaceState({ depth: historyDepth() }, '', `#/${screen}`)
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The browser's own back and forward buttons, and swipe-back on phones.
  useEffect(() => {
    function onBrowserBack() {
      const wanted = screenInAddress()
      setScreen(canShow(wanted) ? wanted : session ? 'order' : homeScreen)
    }
    window.addEventListener('popstate', onBrowserBack)
    return () => window.removeEventListener('popstate', onBrowserBack)
  }, [canShow, session, homeScreen])

  // Open the chat only if the LLM is switched on. Otherwise the form is the way in.
  useEffect(() => {
    fetchAdvisorStatus()
      .then((status) => {
        if (!status.available) return
        setHomeScreen('advisor')
        setScreen((current) => {
          if (current !== 'form') return current
          window.history.replaceState({ depth: historyDepth() }, '', '#/advisor')
          return 'advisor'
        })
      })
      .catch(() => {})
  }, [])

  function goTo(newScreen: Screen) {
    if (newScreen !== screen) {
      window.history.pushState({ depth: historyDepth() + 1 }, '', `#/${newScreen}`)
      setScreen(newScreen)
    }
    window.scrollTo(0, 0)
  }

  function goBack() {
    if (historyDepth() > 0) {
      window.history.back()
      return
    }
    const parent = PARENT[screen]
    goTo(parent === 'home' || parent === undefined ? homeScreen : parent)
  }

  function showQuote(newProfile: Profile, newRecommendation: Recommendation, newCity: string | null = null) {
    setProfile(newProfile)
    setRecommendation(newRecommendation)
    setCity(newCity)
    goTo('quote')
  }

  function openForm(notice?: string) {
    setFormNotice(notice)
    goTo('form')
  }

  function startAgain() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setAcceptedRecommendation(undefined)
    goTo(homeScreen)
  }

  function openStep(step: StepKey) {
    const target: Record<StepKey, Screen> = { choose: homeScreen, quote: 'quote', verify: 'kyc', order: 'order' }
    goTo(target[step])
  }

  const isHome = screen === 'advisor' || screen === 'form'
  const step = STEP_FOR_SCREEN[screen]

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader {...TITLES[screen]} isCompact={!isHome && screen !== 'catalogue'} onBack={isHome ? undefined : goBack} />
      {step && (
        <JourneySteps
          current={step}
          onOpen={openStep}
          canOpen={(key) => (key === 'choose' ? true : key === 'quote' ? canShow('quote') : Boolean(session))}
        />
      )}
      {screen === 'catalogue' ? (
        <CataloguePage />
      ) : (
        <main className="mx-auto w-full max-w-3xl flex-1 px-4">
          {screen === 'advisor' && <AdvisorChat onDone={showQuote} onUseForm={openForm} />}
          {/* Kept on the page while hidden, so going back does not lose the answers. */}
          <div hidden={screen !== 'form'}>
            <GuidedForm notice={formNotice} onDone={showQuote} />
          </div>
          {screen === 'quote' && profile && recommendation && (
            <QuotePage
              profile={profile}
              recommendation={recommendation}
              city={city}
              isAccepted={Boolean(session) && recommendation === acceptedRecommendation}
              onBack={goBack}
              onViewOrder={() => goTo('order')}
              onSaved={(saved) => {
                const newSession = {
                  orderId: saved.order_id,
                  businessId: saved.business_id,
                  token: saved.access_token,
                  hasGstin: profile.has_gstin,
                }
                localStorage.setItem(SESSION_KEY, JSON.stringify(newSession))
                setSession(newSession)
                setAcceptedRecommendation(recommendation)
                goTo('order')
              }}
            />
          )}
          {screen === 'order' && session && (
            <OrderPage orderId={session.orderId} token={session.token} onVerify={() => goTo('kyc')} onStartAgain={startAgain} />
          )}
          {screen === 'kyc' && session && (
            <KycPage businessId={session.businessId} token={session.token} hasGstin={session.hasGstin} onBack={() => goTo('order')} />
          )}
          {screen === 'staff' && <StaffPage onExit={() => goTo(session ? 'order' : homeScreen)} />}
        </main>
      )}
      {screen !== 'staff' && (
        <footer className="mt-10 border-t border-rule">
          <p className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-5">
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={() => (screen === 'catalogue' ? goBack() : goTo('catalogue'))}
            >
              {t(screen === 'catalogue' ? 'Find the right bundle' : 'See the full rate list')}
            </button>
            {session && screen !== 'order' && (
              <button type="button" className="font-semibold underline underline-offset-4" onClick={() => goTo('order')}>
                {t('Track my order')}
              </button>
            )}
            <button type="button" className="text-muted underline underline-offset-4" onClick={() => goTo('staff')}>
              {t('Staff sign in')}
            </button>
          </p>
        </footer>
      )}
    </div>
  )
}
