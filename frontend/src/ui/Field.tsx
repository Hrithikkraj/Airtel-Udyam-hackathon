import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { CircleExclamationPoint } from 'lucide-react'
import { cx } from './cx'

type Messages = {
  hint?: ReactNode
  error?: ReactNode // Shown under the field and read out with it. Also marks the field as invalid.
}

function describedBy(id: string, { hint, error }: Messages, extra?: string) {
  return [error ? `${id}-error` : hint ? `${id}-hint` : null, extra].filter(Boolean).join(' ') || undefined
}

function FieldMessages({ id, hint, error }: Messages & { id: string }) {
  if (error) {
    return (
      <span id={`${id}-error`} className="field-error">
        <CircleExclamationPoint aria-hidden="true" size={16} strokeWidth={2.5} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </span>
    )
  }
  return hint ? (
    <span id={`${id}-hint`} className="field-hint">
      {hint}
    </span>
  ) : null
}

type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'size'> &
  Messages & {
    label: ReactNode
    floating?: boolean // The label sits inside the field and moves up when there is text.
    size?: 'md' | 'lg'
    trailing?: ReactNode // A button inside the field on the right, such as "show password".
    wrapperClassName?: string
  }

/** A labelled text input with its hint or error wired up for screen readers. */
export function TextField({
  label,
  hint,
  error,
  floating = false,
  size = 'md',
  trailing,
  wrapperClassName,
  className,
  id: givenId,
  placeholder,
  'aria-describedby': extraDescription,
  ...rest
}: TextFieldProps) {
  const autoId = useId()
  const id = givenId ?? autoId
  const input = (
    <input
      id={id}
      {...rest}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, { hint, error }, extraDescription)}
      // A floating label needs a placeholder to know when the field is empty. A space shows nothing.
      placeholder={floating ? (placeholder ?? ' ') : placeholder}
      className={cx('input', size === 'lg' && 'input-lg', trailing ? 'pr-14' : undefined, className)}
    />
  )
  return (
    <div className={wrapperClassName}>
      {floating ? (
        <div className="float-field relative">
          {input}
          <label htmlFor={id} className="float-label">
            {label}
          </label>
          {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
      ) : (
        <>
          <label htmlFor={id} className="field-label">
            {label}
          </label>
          <div className="relative">
            {input}
            {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
          </div>
        </>
      )}
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  )
}

type SelectFieldProps = ComponentPropsWithRef<'select'> &
  Messages & {
    label: ReactNode
    wrapperClassName?: string
  }

/** A labelled native select. Native on purpose: phones show their own easy picker. */
export function SelectField({ label, hint, error, wrapperClassName, className, id: givenId, children, ...rest }: SelectFieldProps) {
  const autoId = useId()
  const id = givenId ?? autoId
  return (
    <div className={wrapperClassName}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cx('input', className)}
      >
        {children}
      </select>
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  )
}
