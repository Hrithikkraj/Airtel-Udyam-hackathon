import { useState, type FormEvent } from 'react'
import { BadgeCheck, Eye, EyeOff, ReceiptText, ShieldCheck } from 'lucide-react'
import { signIn, signUp, type Account } from './api'
import { useLanguage } from './i18n'
import Button from './ui/Button'
import { TextField } from './ui/Field'
import IconButton from './ui/IconButton'
import Logo from './ui/Logo'

export type AuthMode = 'signin' | 'signup'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_PATTERN = /^[6-9]\d{9}$/
const MIN_PASSWORD = 8

// Only promises the app keeps: one monthly price, a tracker, and documents read but not stored.
const TRUST_POINTS = [
  { icon: ReceiptText, text: 'One clear monthly price, before you buy.' },
  { icon: BadgeCheck, text: 'Track your order here. No need to call.' },
  { icon: ShieldCheck, text: 'Your documents are read, never kept.' },
]

type Props = { mode: AuthMode; onDone: (account: Account) => void; onSwitch: (mode: AuthMode) => void }

// Sign in and sign up share one page, so the two stay consistent.
export default function AuthPage({ mode, onDone, onSwitch }: Props) {
  const { t } = useLanguage()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const isSignUp = mode === 'signup'

  // Checked in the browser for quick feedback. The server checks everything again.
  function findProblems() {
    const found: Record<string, string> = {}
    if (isSignUp && !fullName.trim()) found.fullName = t('Enter your name.')
    if (!EMAIL_PATTERN.test(email.trim())) found.email = t('Enter a valid email address.')
    if (isSignUp && phone && !PHONE_PATTERN.test(phone)) found.phone = t('Enter a 10-digit mobile number')
    if (isSignUp && password.length < MIN_PASSWORD) found.password = t('Use at least 8 characters.')
    if (!isSignUp && !password) found.password = t('Enter your password.')
    return found
  }

  // When the owner leaves a field they have typed in, check just that field, so a mistake shows
  // straight away instead of only after pressing the button.
  function checkField(name: string, value: string) {
    if (!value) return
    const found = findProblems()
    setProblems((current) => {
      const next = { ...current }
      if (found[name]) next[name] = found[name]
      else delete next[name]
      return next
    })
  }

  // Once a field shows a problem, it clears as soon as the owner fixes it.
  function clearIfFixed(name: string) {
    if (!problems[name]) return
    setProblems((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = findProblems()
    setProblems(found)
    setError('')
    if (Object.keys(found).length > 0) return
    setIsBusy(true)
    try {
      const account = isSignUp
        ? await signUp({ full_name: fullName.trim(), email: email.trim(), password, phone: phone || null })
        : await signIn(email.trim(), password)
      setPassword('') // The password is not kept once it has been used.
      onDone(account)
    } catch (caught) {
      setError(caught instanceof Error ? t(caught.message) : t('That did not work. Try again.'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="my-6 grid overflow-hidden rounded-card bg-white shadow-e3 md:grid-cols-[0.9fr_1.1fr]">
      {/* The brand side: who we are and why it is safe. A band on a phone, a full panel on a computer. */}
      <aside className="brand-mesh relative overflow-hidden px-6 py-7 md:px-8 md:py-10">
        <span aria-hidden="true" className="absolute -top-10 -right-10 size-40 rounded-full bg-white/10" />
        <span aria-hidden="true" className="absolute -bottom-16 -left-8 size-48 rounded-full bg-white/5" />
        <Logo inverted className="relative" />
        <p className="relative mt-5 text-title-2 font-extrabold md:text-title-1">
          {t(isSignUp ? 'Save your orders and details, and see them on any device.' : 'Welcome back. Sign in to see your orders and details.')}
        </p>
        <ul className="relative mt-5 hidden space-y-3 md:block">
          {TRUST_POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Icon size={18} />
              </span>
              <span className="pt-1.5 font-medium text-white">{t(text)}</span>
            </li>
          ))}
        </ul>
      </aside>

      <form onSubmit={handleSubmit} noValidate className="space-y-4 px-5 py-6 md:px-8 md:py-10">
        {isSignUp && (
          <TextField
            floating
            label={t('Your name')}
            autoComplete="name"
            maxLength={80}
            value={fullName}
            error={problems.fullName}
            onChange={(event) => {
              setFullName(event.target.value)
              clearIfFixed('fullName')
            }}
            onBlur={(event) => checkField('fullName', event.target.value)}
          />
        )}

        <TextField
          floating
          type="email"
          label={t('Email')}
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={email}
          error={problems.email}
          onChange={(event) => {
            setEmail(event.target.value)
            clearIfFixed('email')
          }}
          onBlur={(event) => checkField('email', event.target.value)}
        />

        {isSignUp && (
          <TextField
            floating
            type="tel"
            inputMode="numeric"
            label={t('Mobile number (optional)')}
            autoComplete="tel-national"
            maxLength={10}
            value={phone}
            error={problems.phone}
            onChange={(event) => {
              setPhone(event.target.value.replace(/\D/g, ''))
              clearIfFixed('phone')
            }}
            onBlur={(event) => checkField('phone', event.target.value)}
          />
        )}

        <TextField
          floating
          type={showPassword ? 'text' : 'password'}
          label={t('Password')}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          maxLength={128}
          value={password}
          error={problems.password}
          hint={isSignUp ? t('At least 8 characters.') : undefined}
          onChange={(event) => {
            setPassword(event.target.value)
            clearIfFixed('password')
          }}
          onBlur={(event) => checkField('password', event.target.value)}
          trailing={
            <IconButton
              label={t(showPassword ? 'Hide password' : 'Show password')}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
            </IconButton>
          }
        />

        {error && (
          <p role="alert" className="notice-error font-medium">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          block
          isLoading={isBusy}
          loadingText={t(isSignUp ? 'Creating your account…' : 'Signing in…')}
          className="mt-6"
        >
          {t(isSignUp ? 'Create account' : 'Sign in')}
        </Button>

        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-ink-600">
          {t(isSignUp ? 'Already have an account?' : 'New here?')}
          <button type="button" className="link" onClick={() => onSwitch(isSignUp ? 'signin' : 'signup')}>
            {t(isSignUp ? 'Sign in' : 'Create an account')}
          </button>
        </p>

        <p className="flex items-center justify-center gap-1.5 text-caption text-ink-500 md:hidden">
          <ShieldCheck aria-hidden="true" size={14} />
          {t('Your documents are read, never kept.')}
        </p>
      </form>
    </div>
  )
}
