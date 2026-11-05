import { useEffect, useState } from 'react'
import AdvisorChat from './AdvisorChat'
import CataloguePage from './CataloguePage'
import GuidedForm from './GuidedForm'
import KycPage from './KycPage'
import OrderPage from './OrderPage'
import PageHeader from './PageHeader'
import QuotePage from './QuotePage'
import StaffPage from './StaffPage'
import { useLanguage } from './i18n'
import { fetchAdvisorStatus, type Profile, type Recommendation } from './api'

type Screen = 'advisor' | 'form' | 'quote' | 'order' | 'kyc' | 'catalogue' | 'staff'

const TITLES: Record<Screen, { title: string; intro: string }> = {
  advisor: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  form: { title: 'Find the right bundle', intro: 'Answer a few questions and see one clear monthly price.' },
  quote: { title: 'Your quote', intro: 'Switch things on or off and the price updates straight away.' },
  order: { title: 'Your order', intro: 'Check here any time. There is no need to call to find out where things stand.' },
  kyc: { title: 'Verify your business', intro: 'Upload your documents and see the result straight away.' },
  staff: { title: 'Staff and partners', intro: 'Reviews, call-backs, installations and the funnel, all in one place.' },
  catalogue: { title: 'Rate list for your business', intro: 'See what each service costs and what it needs before you buy. Your quote confirms the exact price.' },
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

export default function App() {
  const { t } = useLanguage()
  const [session, setSession] = useState<OrderSession | null>(loadSession)
  // Staff stay signed in until the tab closes, so a reload returns them to their page.
  const [screen, setScreen] = useState<Screen>(sessionStorage.getItem('accel-staff-key') ? 'staff' : session ? 'order' : 'form')
  const [formNotice, setFormNotice] = useState<string>()
  const [profile, setProfile] = useState<Profile>()
  const [recommendation, setRecommendation] = useState<Recommendation>()
  const [city, setCity] = useState<string | null>(null)

  // Open the chat only if the LLM is switched on. Otherwise the form is the way in.
  useEffect(() => {
    fetchAdvisorStatus()
      .then((status) => {
        if (status.available) setScreen((current) => (current === 'form' ? 'advisor' : current))
      })
      .catch(() => {})
  }, [])

  function goTo(newScreen: Screen) {
    setScreen(newScreen)
    window.scrollTo(0, 0)
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
    goTo('form')
  }

  return (
    <div className="min-h-screen">
      <PageHeader {...TITLES[screen]} />
      {screen === 'catalogue' ? (
        <CataloguePage />
      ) : (
        <main className="mx-auto max-w-3xl px-4">
          {screen === 'advisor' && <AdvisorChat onDone={showQuote} onUseForm={openForm} />}
          {/* Kept on the page while hidden, so "Change my answers" does not lose them. */}
          <div hidden={screen !== 'form'}>
            <GuidedForm notice={formNotice} onDone={showQuote} />
          </div>
          {screen === 'quote' && profile && recommendation && (
            <QuotePage
              profile={profile}
              recommendation={recommendation}
              city={city}
              onBack={() => openForm()}
              onSaved={(saved) => {
                const newSession = {
                  orderId: saved.order_id,
                  businessId: saved.business_id,
                  token: saved.access_token,
                  hasGstin: profile.has_gstin,
                }
                localStorage.setItem(SESSION_KEY, JSON.stringify(newSession))
                setSession(newSession)
                goTo('order')
              }}
            />
          )}
          {screen === 'order' && session && (
            <OrderPage
              orderId={session.orderId}
              token={session.token}
              onVerify={() => goTo('kyc')}
              onStartAgain={startAgain}
            />
          )}
          {screen === 'kyc' && session && (
            <KycPage
              businessId={session.businessId}
              token={session.token}
              hasGstin={session.hasGstin}
              onBack={() => goTo('order')}
            />
          )}
          {screen === 'staff' && <StaffPage onExit={() => goTo(session ? 'order' : 'form')} />}
        </main>
      )}
      {(screen === 'advisor' || screen === 'form' || screen === 'catalogue') && (
        <p className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 pb-10">
          <button
            type="button"
            className="font-semibold underline underline-offset-4"
            onClick={() => setScreen(screen === 'catalogue' ? 'form' : 'catalogue')}
          >
            {t(screen === 'catalogue' ? 'Find the right bundle' : 'See the full rate list')}
          </button>
          <button type="button" className="text-muted underline underline-offset-4" onClick={() => goTo('staff')}>
            {t('Staff sign in')}
          </button>
        </p>
      )}
    </div>
  )
}
