import { useCallback, useEffect, useRef, useState } from 'react'
import AdvisorChat from './AdvisorChat'
import AuthPage from './AuthPage'
import CataloguePage from './CataloguePage'
import GuidedForm from './GuidedForm'
import JourneySteps, { type StepKey } from './JourneySteps'
import KycPage from './KycPage'
import OrderPage from './OrderPage'
import PageHeader from './PageHeader'
import ProfilePage from './ProfilePage'
import QuotePage from './QuotePage'
import StaffPage from './StaffPage'
import { useLanguage } from './i18n'
import {
  claimBusiness,
  fetchAccount,
  fetchAdvisorStatus,
  rememberOrder,
  signOut,
  SIGNED_OUT_EVENT,
  type Account,
  type Profile,
  type Recommendation,
} from './api'
import { clearOrderPointer, clearProfileDraft, readOrderPointer, saveOrderPointer, type OrderPointer } from './storage'

type Screen = 'advisor' | 'form' | 'quote' | 'order' | 'kyc' | 'catalogue' | 'staff' | 'signin' | 'signup' | 'profile'
const SCREENS: Screen[] = ['advisor', 'form', 'quote', 'order', 'kyc', 'catalogue', 'staff', 'signin', 'signup', 'profile']

const TITLES: Record<Screen, { title: string; intro: string }> = {
  advisor: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  form: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  quote: { title: 'Your quote', intro: 'Switch things on or off and the price updates straight away.' },
  order: { title: 'Your order', intro: 'Check here any time. There is no need to call to find out where things stand.' },
  kyc: { title: 'Verify your business', intro: 'Upload your documents and see the result straight away.' },
  staff: { title: 'Staff and partners', intro: 'Reviews, call-backs, installations and the funnel, all in one place.' },
  catalogue: { title: 'Rate list for your business', intro: 'See what each service costs and what it needs before you buy. Your quote confirms the exact price.' },
  signin: { title: 'Welcome to Accel Business', intro: 'Sign in or create an account to find the right bundle for your business.' },
  signup: { title: 'Create your account', intro: 'It takes a minute. Then find the right bundle for your business.' },
  profile: { title: 'Your profile', intro: 'Your details, your businesses and your orders.' },
}

// Where the Back button goes when there is no earlier page in this visit, such as after a reload.
const PARENT: Partial<Record<Screen, Screen | 'home'>> = {
  quote: 'home',
  order: 'home',
  kyc: 'order',
  catalogue: 'home',
  staff: 'home',
  signin: 'home',
  signup: 'home',
  profile: 'home',
}

const STEP_FOR_SCREEN: Partial<Record<Screen, StepKey>> = {
  advisor: 'choose',
  form: 'choose',
  quote: 'quote',
  kyc: 'verify',
  order: 'order',
}

function screenInAddress(): Screen | null {
  const name = window.location.hash.replace('#/', '')
  return SCREENS.includes(name as Screen) ? (name as Screen) : null
}

// How many pages deep this visit is. Back only steps through the browser history while above zero.
function historyDepth(): number {
  return window.history.state?.depth ?? 0
}

// Read once, at start-up. An older version kept the order secret here, and this removes it.
const startingOrder = readOrderPointer()
// A page asked for by its address, such as #/form, must not be swapped for another one.
const openedByAddress = screenInAddress() !== null

export default function App() {
  const { t, setLanguage } = useLanguage()
  // The order this browser is following. Only its numbers are stored. Its secret is an HttpOnly cookie.
  const [session, setSession] = useState<OrderPointer | null>(startingOrder.pointer)
  // undefined while checking, null when nobody is signed in on this browser.
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [homeScreen, setHomeScreen] = useState<Screen>('form')
  const [profile, setProfile] = useState<Profile>()
  const [recommendation, setRecommendation] = useState<Recommendation>()
  const [acceptedRecommendation, setAcceptedRecommendation] = useState<Recommendation>()
  const [city, setCity] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string>()
  const [authNotice, setAuthNotice] = useState('')
  const legacyToken = useRef(startingOrder.legacyToken)

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

  // Find out whether this browser is signed in. The answer comes from the server's HttpOnly cookie.
  useEffect(() => {
    fetchAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])

  // An order secret left in page storage by an older version is moved into an HttpOnly cookie, once.
  useEffect(() => {
    const token = legacyToken.current
    legacyToken.current = null
    if (token && session) rememberOrder(session.orderId, token).catch(() => {})
  }, [session])

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
          if (current !== 'form' || openedByAddress) return current
          window.history.replaceState({ depth: historyDepth() }, '', '#/advisor')
          return 'advisor'
        })
      })
      .catch(() => {})
  }, [])

  // If the server ends the session mid-journey, return to the sign-in page and say why.
  useEffect(() => {
    function onSignedOut() {
      setAccount(null)
      setAuthNotice(t('Your session has ended. Sign in again to continue.'))
    }
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [t])

  // The profile always shows fresh orders, including any accepted since the page loaded.
  useEffect(() => {
    if (screen === 'profile') {
      fetchAccount()
        .then(setAccount)
        .catch(() => {})
    }
  }, [screen])

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

  function followOrder(pointer: OrderPointer) {
    saveOrderPointer(pointer)
    setSession(pointer)
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
    clearOrderPointer()
    setSession(null)
    setAcceptedRecommendation(undefined)
    goTo(homeScreen)
  }

  async function afterSignIn(signedIn: Account) {
    setAccount(signedIn)
    setLanguage(signedIn.preferred_language === 'Hindi' ? 'hi' : 'en')
    setAuthNotice('')
    // An order started on this browser before signing in is added to the account.
    const alreadyLinked = signedIn.businesses.some((business) => business.business_id === session?.businessId)
    if (session && !alreadyLinked) {
      try {
        setAccount(await claimBusiness(session.businessId))
      } catch {
        // Not every saved order can be claimed, for example one owned by another account. That is fine.
      }
    }
    // Straight on to the main task. A page asked for by its address, such as an order, opens instead.
    if (screen === 'signin' || screen === 'signup') goTo(homeScreen)
    else window.scrollTo(0, 0)
  }

  async function signOutHere() {
    await signOut()
    // The server removed this browser's session and order cookies. Clear what the page remembers too.
    clearOrderPointer()
    clearProfileDraft()
    setSession(null)
    setAccount(null)
    setAcceptedRecommendation(undefined)
    setAuthNotice(t('You are signed out.'))
    goTo('signin')
  }

  function openStep(step: StepKey) {
    const target: Record<StepKey, Screen> = { choose: homeScreen, quote: 'quote', verify: 'kyc', order: 'order' }
    goTo(target[step])
  }

  const isHome = screen === 'advisor' || screen === 'form'
  const step = STEP_FOR_SCREEN[screen]
  const firstName = account?.full_name.split(' ')[0]
  const accountButton = account && screen !== 'staff' ? { label: firstName ?? t('Your profile'), onClick: () => goTo('profile') } : undefined

  // Staff have their own sign-in. Everything else starts with an owner's sign-in or sign-up.
  if (screen !== 'staff' && !account) {
    const authScreen: Screen = screen === 'signup' ? 'signup' : 'signin'
    return (
      <div className="flex min-h-screen flex-col">
        <PageHeader {...TITLES[authScreen]} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4">
          {account === undefined ? (
            <p className="py-8">{t('Loading…')}</p>
          ) : (
            <>
              {authNotice && (
                <p role="status" className="mt-6 border-l-4 border-marigold bg-white px-3 py-2 font-semibold">
                  {authNotice}
                </p>
              )}
              <AuthPage
                mode={authScreen}
                onDone={afterSignIn}
                onSwitch={(mode) => {
                  setAuthNotice('')
                  goTo(mode)
                }}
              />
            </>
          )}
        </main>
        <footer className="mt-10 border-t border-rule">
          <p className="mx-auto max-w-3xl px-4 py-5">
            <button type="button" className="text-muted underline underline-offset-4" onClick={() => goTo('staff')}>
              {t('Staff sign in')}
            </button>
          </p>
        </footer>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        {...TITLES[screen]}
        isCompact={!isHome && screen !== 'catalogue'}
        onBack={isHome ? undefined : goBack}
        account={accountButton}
      />
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
                followOrder({ orderId: saved.order_id, businessId: saved.business_id, hasGstin: profile.has_gstin })
                setAcceptedRecommendation(recommendation)
                goTo('order')
              }}
            />
          )}
          {screen === 'order' && session && (
            <OrderPage orderId={session.orderId} onVerify={() => goTo('kyc')} onStartAgain={startAgain} />
          )}
          {screen === 'kyc' && session && (
            <KycPage businessId={session.businessId} hasGstin={session.hasGstin} onBack={() => goTo('order')} />
          )}
          {/* Signed in already, so the sign-in pages have nothing to show. Offer the main task instead. */}
          {(screen === 'signin' || screen === 'signup') && (
            <div className="py-8">
              <p>{t('You are signed in.')}</p>
              <button type="button" className="mt-3 bg-ink px-6 py-3 font-semibold text-paper" onClick={() => goTo(homeScreen)}>
                {t('Find the right bundle')}
              </button>
            </div>
          )}
          {screen === 'profile' && account && (
            <ProfilePage
              key={account.user_id}
              account={account}
              onAccountChange={setAccount}
              onOpenOrder={(business, orderId) => {
                followOrder({ orderId, businessId: business.business_id, hasGstin: business.has_gstin })
                goTo('order')
              }}
              onSignOut={signOutHere}
            />
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
