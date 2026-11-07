import { useState, type FormEvent } from 'react'
import { signIn, signUp, type Account } from './api'
import { useLanguage } from './i18n'

export type AuthMode = 'signin' | 'signup'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_PATTERN = /^[6-9]\d{9}$/
const MIN_PASSWORD = 8
const inputStyle = 'mt-1 w-full border bg-white px-3 py-2.5 text-base'

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

  const fieldError = (name: string) =>
    problems[name] ? (
      <span id={`${name}-problem`} className="mt-1 block text-sm font-medium text-danger">
        {problems[name]}
      </span>
    ) : null

  return (
    <form onSubmit={handleSubmit} noValidate className="panel my-6 max-w-md space-y-5">
      <p>{t(isSignUp ? 'Save your orders and details, and see them on any device.' : 'Welcome back. Sign in to see your orders and details.')}</p>

      {isSignUp && (
        <div>
        <label className="block font-semibold">
          {t('Your name')}
          <input
            className={inputStyle}
            autoComplete="name"
            maxLength={80}
            value={fullName}
            aria-invalid={Boolean(problems.fullName)}
            aria-describedby={problems.fullName ? 'fullName-problem' : undefined}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        {fieldError('fullName')}
        </div>
      )}

      <div>
      <label className="block font-semibold">
        {t('Email')}
        <input
          type="email"
          className={inputStyle}
          autoComplete="email"
          maxLength={254}
          value={email}
          aria-invalid={Boolean(problems.email)}
          aria-describedby={problems.email ? 'email-problem' : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {fieldError('email')}
      </div>

      {isSignUp && (
        <div>
        <label className="block font-semibold">
          {t('Mobile number (optional)')}
          <input
            type="tel"
            inputMode="numeric"
            className={inputStyle}
            autoComplete="tel-national"
            maxLength={10}
            value={phone}
            aria-invalid={Boolean(problems.phone)}
            aria-describedby={problems.phone ? 'phone-problem' : undefined}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
          />
        </label>
        {fieldError('phone')}
        </div>
      )}

      <div>
        <label className="block font-semibold">
          {t('Password')}
          <input
            type={showPassword ? 'text' : 'password'}
            className={inputStyle}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            maxLength={128}
            value={password}
            aria-invalid={Boolean(problems.password)}
            aria-describedby={problems.password ? 'password-problem' : isSignUp ? 'password-hint' : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {fieldError('password')}
        {isSignUp && !problems.password && (
          <span id="password-hint" className="mt-1 block text-sm text-muted">
            {t('At least 8 characters.')}
          </span>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-accent" checked={showPassword} onChange={() => setShowPassword(!showPassword)} />
          {t('Show password')}
        </label>
      </div>

      {error && (
        <p role="alert" className="notice-error font-medium">
          {error}
        </p>
      )}

      <button type="submit" disabled={isBusy} className="w-full bg-accent px-6 py-3 text-lg font-semibold text-white disabled:opacity-60">
        {t(isBusy ? (isSignUp ? 'Creating your account…' : 'Signing in…') : isSignUp ? 'Create account' : 'Sign in')}
      </button>

      <p>
        {t(isSignUp ? 'Already have an account?' : 'New here?')}{' '}
        <button type="button" className="font-medium text-accent underline underline-offset-4" onClick={() => onSwitch(isSignUp ? 'signin' : 'signup')}>
          {t(isSignUp ? 'Sign in' : 'Create an account')}
        </button>
      </p>
    </form>
  )
}
