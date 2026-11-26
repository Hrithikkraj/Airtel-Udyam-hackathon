import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { House, LayoutGrid, Package, ReceiptText, User } from 'lucide-react'
import AdvisorChat from './AdvisorChat'
import AuthPage from './AuthPage'
import BottomNav from './BottomNav'
import CataloguePage, { type Plan } from './CataloguePage'
import GuidedForm from './GuidedForm'
import JourneySteps, { type StepKey } from './JourneySteps'
import OfflineBanner from './OfflineBanner'
import OrderPage from './OrderPage'
import PageHeader from './PageHeader'
import ProfilePage from './ProfilePage'
import QuotePage from './QuotePage'
import { useLanguage } from './i18n'
import type { NavItem } from './navigation'
import PageTransition from './ui/PageTransition'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import { Loading, Skeleton } from './ui/Skeleton'
import { useToast } from './ui/useToast'

// Loaded only when opened, so the first screen arrives sooner on a slow network. Most owners never
// see the staff tools, and verification comes later in the journey.
const KycPage = lazy(() => import('./KycPage'))
const StaffPage = lazy(() => import('./StaffPage'))
import {
  claimBusiness,
  fetchAcceptedQuote,
  fetchAccount,
  fetchAdvisorStatus,
  fetchOrder,
  FIXED_ORDER_STATUSES,
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
  const toast = useToast()
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
  // What the owner has picked on the rate list. Kept here so going back to the list keeps it.
  const [plan, setPlan] = useState<Plan>({})
  const [authNotice, setAuthNotice] = useState('')
  // The order's status, so the quote page knows whether accepting may still change that order.
  const [orderStatus, setOrderStatus] = useState<string>()
  const [quoteLoadFailed, setQuoteLoadFailed] = useState(false)
  const [quoteLoadAttempt, setQuoteLoadAttempt] = useState(0)
  // A new number makes the quote page start fresh when a different quote is shown.
  const [quoteVersion, setQuoteVersion] = useState(0)
  const legacyToken = useRef(startingOrder.legacyToken)
  // Which way the owner is moving, so the next page slides in from the right side (forward) or the
  // left side (back). The history depth tells the browser's own back button apart from forward.
  const [direction, setDirection] = useState<1 | -1>(1)
  const depthRef = useRef(historyDepth())

  // A screen can only open if what it shows still exists. A quote that was accepted can always be
  // loaded again from the server, so it stays reachable from every later step, even after a reload.
  const canShow = useCallback(
    (wanted: Screen | null): wanted is Screen => {
      if (wanted === null) return false
      if (wanted === 'quote') return Boolean((recommendation && profile) || session)
      if (wanted === 'order' || wanted === 'kyc') return Boolean(session)
      return true
    },
    [recommendation, profile, session],
  )

  const [screen, setScreen] = useState<Screen>(() => {
    if (sessionStorage.getItem('accel-staff-key')) return 'staff'
    const inAddress = screenInAddress()
    if (inAddress === 'order' || inAddress === 'kyc' || inAddress === 'quote') return session ? inAddress : 'form'
    if (inAddress) return inAddress
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
      const depth = historyDepth()
      setDirection(depth < depthRef.current ? -1 : 1)
      depthRef.current = depth
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

  // Opening the quote with nothing in memory (after a reload, or from a later step): load the quote
  // behind the order from the server.
  const needsAcceptedQuote = screen === 'quote' && !(profile && recommendation) && Boolean(session)
  useEffect(() => {
    if (!needsAcceptedQuote || !session) return
    let isCurrent = true
    fetchAcceptedQuote(session.orderId)
      .then((accepted) => {
        if (!isCurrent) return
        setQuoteLoadFailed(false)
        setProfile(accepted.profile)
        setRecommendation(accepted.recommendation)
        setAcceptedRecommendation(accepted.recommendation)
        setCity(accepted.city)
        setQuoteVersion((version) => version + 1)
      })
      .catch(() => {
        if (isCurrent) setQuoteLoadFailed(true)
      })
    return () => {
      isCurrent = false
    }
  }, [needsAcceptedQuote, session, quoteLoadAttempt])

  // Whether the order can still take a changed quote. Checked again on every page change, as the
  // order moves on without this page knowing.
  useEffect(() => {
    if (!session) return
    let isCurrent = true
    fetchOrder(session.orderId)
      .then((order) => {
        if (isCurrent) setOrderStatus(order.status)
      })
      .catch(() => {})
    return () => {
      isCurrent = false
    }
  }, [session, screen])

  // The profile always shows fresh orders, including any accepted since the page loaded.
  useEffect(() => {
    if (screen === 'profile') {
      fetchAccount()
        .then(setAccount)
        .catch(() => {})
    }
  }, [screen])

  function goTo(newScreen: Screen, towards: 1 | -1 = 1) {
    if (newScreen !== screen) {
      const depth = historyDepth() + 1
      window.history.pushState({ depth }, '', `#/${newScreen}`)
      depthRef.current = depth
      setDirection(towards)
      setScreen(newScreen)
    }
    window.scrollTo(0, 0)
  }

  function goBack() {
    if (historyDepth() > 0) {
      window.history.back() // The popstate handler above sets the direction.
      return
    }
    const parent = PARENT[screen]
    goTo(parent === 'home' || parent === undefined ? homeScreen : parent, -1)
  }

  function followOrder(pointer: OrderPointer) {
    saveOrderPointer(pointer)
    setSession(pointer)
  }

  function showQuote(newProfile: Profile, newRecommendation: Recommendation, newCity: string | null = null) {
    setProfile(newProfile)
    setRecommendation(newRecommendation)
    setCity(newCity)
    setQuoteVersion((version) => version + 1)
    goTo('quote')
  }

  // Forget the quote in memory, so the next visit to the quote page loads what the server has.
  function forgetQuote() {
    setProfile(undefined)
    setRecommendation(undefined)
    setAcceptedRecommendation(undefined)
    setQuoteLoadFailed(false)
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

  // The order can still take a changed quote: it is not placed, finished or cancelled.
  const orderCanChange = Boolean(session) && orderStatus !== undefined && !FIXED_ORDER_STATUSES.includes(orderStatus)

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
    forgetQuote()
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

  // The main navigation. Quote and Order are dimmed until there is a quote or an order, and say why.
  const navItems: NavItem[] = [
    { key: 'home', label: t('Home'), icon: House, isActive: isHome, isAvailable: true, onSelect: () => goTo(homeScreen) },
    {
      key: 'quote',
      label: t('Quote'),
      icon: ReceiptText,
      isActive: screen === 'quote',
      isAvailable: canShow('quote'),
      unavailableMessage: t('Your quote appears here once you tell us about your business.'),
      onSelect: () => goTo('quote'),
    },
    {
      key: 'order',
      label: t('Order'),
      icon: Package,
      isActive: screen === 'order' || screen === 'kyc',
      isAvailable: Boolean(session),
      unavailableMessage: t('Your order appears here once you accept a quote.'),
      onSelect: () => goTo('order'),
    },
    { key: 'rates', label: t('Rates'), icon: LayoutGrid, isActive: screen === 'catalogue', isAvailable: true, onSelect: () => goTo('catalogue') },
    { key: 'profile', label: t('Profile'), icon: User, isActive: screen === 'profile', isAvailable: true, onSelect: () => goTo('profile') },
  ]
  // Staff use their own tool, which has no owner navigation.
  const hasNav = screen !== 'staff'

  // Staff have their own sign-in. Everything else starts with an owner's sign-in or sign-up.
  if (screen !== 'staff' && !account) {
    const authScreen: Screen = screen === 'signup' ? 'signup' : 'signin'
    return (
      <div className="flex min-h-dvh flex-col">
        <PageHeader {...TITLES[authScreen]} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 md:px-6">
          {account === undefined ? (
            <Loading label={t('Loading…')} className="py-6" />
          ) : (
            <>
              {authNotice && (
                <p role="status" className="notice mt-6 font-medium">
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
        <footer className="mt-12 border-t border-ink-200">
          <p className="mx-auto max-w-3xl px-4 py-4 md:px-6">
            <button type="button" className="link text-small font-medium text-ink-500" onClick={() => goTo('staff')}>
              {t('Staff sign in')}
            </button>
          </p>
        </footer>
      </div>
    )
  }

  return (
    // On a phone the page leaves room at the bottom for the floating navigation.
    <div className={`flex min-h-dvh flex-col ${hasNav ? 'pb-(--nav-offset)' : ''}`}>
      <PageHeader
        {...TITLES[screen]}
        isCompact={!isHome && screen !== 'catalogue'}
        onBack={isHome ? undefined : goBack}
        account={accountButton}
        navItems={hasNav ? navItems : undefined}
        onHome={() => goTo(homeScreen)}
        wide={screen === 'catalogue' || screen === 'staff'}
      />
      <OfflineBanner />
      {step && (
        <JourneySteps
          current={step}
          onOpen={openStep}
          canOpen={(key) => (key === 'choose' ? true : key === 'quote' ? canShow('quote') : Boolean(session))}
        />
      )}
      <PageTransition id={screen} direction={direction} className="flex flex-1 flex-col">
      {screen === 'catalogue' ? (
        <CataloguePage plan={plan} onPlanChange={setPlan} onReviewed={showQuote} />
      ) : (
        <main className={`mx-auto w-full flex-1 px-4 md:px-6 ${screen === 'staff' ? 'max-w-5xl' : 'max-w-3xl'}`}>
          <div hidden={screen !== 'advisor'}>
            <AdvisorChat onDone={showQuote} onUseForm={openForm} />
          </div>
          {/* Kept on the page while hidden, so going back does not lose the answers. */}
          <div hidden={screen !== 'form'}>
            <GuidedForm notice={formNotice} onDone={showQuote} />
          </div>
          {screen === 'quote' && needsAcceptedQuote && (
            quoteLoadFailed ? (
              <EmptyState
                role="alert"
                picture="offline"
                title={t('Your quote did not load. Check your connection, then try again.')}
                action={
                  <>
                    <Button
                      onClick={() => {
                        setQuoteLoadFailed(false)
                        setQuoteLoadAttempt((attempt) => attempt + 1)
                      }}
                    >
                      {t('Try again')}
                    </Button>
                    <Button variant="secondary" onClick={() => goTo('order')}>
                      {t('Back to my order')}
                    </Button>
                  </>
                }
              />
            ) : (
              // The shape of the quote page, so nothing jumps when the real one arrives.
              <Loading label={t('Loading your quote…')} className="space-y-4 pt-6">
                <Skeleton className="h-44 w-full rounded-card" />
                <div className="card space-y-4">
                  <Skeleton className="h-6 w-1/3" />
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="flex items-center gap-3">
                      <Skeleton className="size-11 rounded-control" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </Loading>
            )
          )}
          {screen === 'quote' && profile && recommendation && (
            <>
              {/* Every earlier step stays open: the answers, the short form and the rate list. */}
              <p className="-mb-2 flex flex-wrap gap-x-6 pt-3">
                {homeScreen === 'advisor' && (
                  <button type="button" className="link text-small" onClick={() => goTo('advisor')}>
                    {t('Correct my answers')}
                  </button>
                )}
                <button type="button" className="link text-small" onClick={() => goTo('catalogue')}>
                  {t('See the full rate list')}
                </button>
              </p>
              <QuotePage
                key={quoteVersion}
                profile={profile}
                recommendation={recommendation}
                city={city}
                isAccepted={Boolean(session) && recommendation === acceptedRecommendation}
                replaceOrderId={session && orderCanChange ? session.orderId : undefined}
                onBack={goBack}
                onViewOrder={() => goTo('order')}
                onSaved={(saved) => {
                  followOrder({ orderId: saved.order_id, businessId: saved.business_id, hasGstin: profile.has_gstin })
                  if (recommendation.chosen_by === 'owner') setPlan({}) // The plan is now an order.
                  // The server now holds exactly what was accepted, including any changes made on
                  // the page. The quote page loads that next time, so it never shows an older copy.
                  forgetQuote()
                  setOrderStatus(undefined)
                  toast({ tone: 'success', message: t('Your quote is accepted. Next, verify your business.') })
                  goTo('order')
                }}
              />
            </>
          )}
          {screen === 'order' && session && (
            <OrderPage
              orderId={session.orderId}
              onVerify={() => goTo('kyc')}
              onStartAgain={startAgain}
              onOpenQuote={() => goTo('quote')}
              onFindMore={() => goTo(homeScreen)}
            />
          )}
          {screen === 'kyc' && session && (
            <Suspense fallback={<Loading label={t('Loading…')} className="py-6" />}>
              <KycPage
                businessId={session.businessId}
                hasGstin={session.hasGstin}
                onBack={() => goTo('order')}
                onOpenQuote={() => goTo('quote')}
              />
            </Suspense>
          )}
          {/* Signed in already, so the sign-in pages have nothing to show. Offer the main task instead. */}
          {(screen === 'signin' || screen === 'signup') && (
            <EmptyState
              picture="box"
              title={t('You are signed in.')}
              action={<Button onClick={() => goTo(homeScreen)}>{t('Find the right bundle')}</Button>}
            />
          )}
          {screen === 'profile' && account && (
            <ProfilePage
              key={account.user_id}
              account={account}
              onAccountChange={setAccount}
              onOpenOrder={(business, orderId) => {
                followOrder({ orderId, businessId: business.business_id, hasGstin: business.has_gstin })
                forgetQuote() // A different order has a different quote.
                setOrderStatus(undefined)
                goTo('order')
              }}
              onSignOut={signOutHere}
            />
          )}
          {screen === 'staff' && (
            <Suspense fallback={<Loading label={t('Loading…')} className="py-6" />}>
              <StaffPage onExit={() => goTo(session ? 'order' : homeScreen)} />
            </Suspense>
          )}
        </main>
      )}
      </PageTransition>
      {screen !== 'staff' && (
        <footer className="mt-12 border-t border-ink-200">
          <p className="mx-auto flex max-w-3xl flex-wrap gap-x-6 px-4 py-3 md:px-6">
            <button
              type="button"
              className="link text-small"
              onClick={() => (screen === 'catalogue' ? goBack() : goTo('catalogue'))}
            >
              {t(screen === 'catalogue' ? 'Find the right bundle' : 'See the full rate list')}
            </button>
            {session && screen !== 'order' && (
              <button type="button" className="link text-small" onClick={() => goTo('order')}>
                {t('Track my order')}
              </button>
            )}
            <button type="button" className="link text-small font-medium text-ink-500" onClick={() => goTo('staff')}>
              {t('Staff sign in')}
            </button>
          </p>
        </footer>
      )}
      {hasNav && <BottomNav items={navItems} />}
    </div>
  )
}
