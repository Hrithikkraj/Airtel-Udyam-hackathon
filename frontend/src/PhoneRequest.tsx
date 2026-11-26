import { useState, type FormEvent } from 'react'
import { CircleCheck, PhoneCall } from 'lucide-react'
import { useLanguage } from './i18n'
import Button from './ui/Button'
import { TextField } from './ui/Field'

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

  if (isDone) {
    return (
      <p role="status" className="notice-success flex items-center gap-2 font-semibold">
        <CircleCheck aria-hidden="true" size={18} className="shrink-0" />
        {t(doneText)}
      </p>
    )
  }

  if (!isOpen) {
    return (
      <button type="button" className="link" onClick={() => setIsOpen(true)}>
        <PhoneCall aria-hidden="true" size={16} />
        {t(buttonText)}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="card-flat w-full max-w-sm">
      <TextField
        label={t('Your mobile number')}
        required
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        pattern="[6-9][0-9]{9}"
        title={t('Enter a 10-digit mobile number')}
        value={phone}
        hint={t('We use this number only to call you about this request, and delete it when the request is closed.')}
        error={error || undefined}
        onChange={(event) => setPhone(event.target.value)}
      />
      <Button type="submit" className="mt-3" icon={<PhoneCall aria-hidden="true" size={18} />}>
        {t('Ask for a call')}
      </Button>
    </form>
  )
}
