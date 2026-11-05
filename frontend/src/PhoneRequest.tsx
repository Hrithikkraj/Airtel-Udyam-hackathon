import { useState, type FormEvent } from 'react'
import { useLanguage } from './i18n'

type Props = {
  buttonText: string
  doneText: string
  onSend: (phone: string) => Promise<unknown>
}

// Asks for a phone number only when an owner chooses to talk to a person.
export default function PhoneRequest({ buttonText, doneText, onSend }: Props) {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [isDone, setIsDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await onSend(phone)
      setIsDone(true)
    } catch {
      setError(t('That did not work. Check the number and try again.'))
    }
  }

  if (isDone) return <p className="font-semibold">{t(doneText)}</p>

  if (!isOpen) {
    return (
      <button type="button" className="font-semibold underline underline-offset-4" onClick={() => setIsOpen(true)}>
        {t(buttonText)}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm">
      <label className="block font-semibold">
        {t('Your mobile number')}
        <input
          required
          type="tel"
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          title={t('Enter a 10-digit mobile number')}
          className="mt-1 w-full border-2 border-ink bg-white px-3 py-2 text-lg"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>
      <p className="mt-1 text-sm text-muted">
        {t('We use this number only to call you about this request, and delete it when the request is closed.')}
      </p>
      {error && <p role="alert" className="mt-1 font-semibold">{error}</p>}
      <button type="submit" className="mt-2 bg-ink px-5 py-2 font-semibold text-paper">{t('Ask for a call')}</button>
    </form>
  )
}
