/*
 * app/portal/company/page.tsx
 *
 * The trade account application: one form, four sections, one Submit button.
 *
 * This lives with the client rather than with our staff because they know their
 * registered name, ABN, directors and pay run better than we do, and because
 * these are the details a credit check is run against — re-keyed from a phone
 * call they would be wrong often enough to matter.
 *
 * Saving is separate from submitting on purpose: the admin officer usually has
 * to go and ask someone for the reference details, so partial progress must
 * survive. Submitting is the explicit "this is complete, review it" signal, and
 * from that point the form is read-only.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePortal } from '@/components/portal/PortalContext'
import {
  APPLICATION_SECTIONS,
  missingApplicationFields,
  type ApplicationField,
} from '@/lib/portal/application'
import {
  LINE,
  MUTED,
  Notice,
  buttonStyle,
  card,
  eyebrow,
  h1,
  h2,
  input,
  label,
  meta,
  shortDate,
} from '@/components/portal/portalUi'

type TextField = Exclude<ApplicationField, 'purchase_order_required'>

type FormState = Record<TextField, string> & { purchase_order_required: boolean }

const EMPTY_FORM: FormState = {
  legal_name: '',
  trading_as: '',
  abn: '',
  head_office_address: '',
  phone: '',
  director_name: '',
  director_email: '',
  director_phone: '',
  finance_contact_name: '',
  finance_contact_title: '',
  finance_contact_email: '',
  finance_contact_phone: '',
  billing_email: '',
  billing_address: '',
  payment_terms: '',
  payment_run_days: '',
  payment_method: '',
  purchase_order_required: false,
  reference1_company: '',
  reference1_contact: '',
  reference1_phone: '',
  reference1_email: '',
  reference2_company: '',
  reference2_contact: '',
  reference2_phone: '',
  reference2_email: '',
}

const section: React.CSSProperties = { ...card, marginBottom: 16 }

const sectionIntro: React.CSSProperties = { ...meta, margin: '6px 0 20px' }

/** Two columns on anything wider than a phone, one below. */
const pair: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
  marginBottom: 18,
}

export default function PortalCompanyPage() {
  const { me, loading, refresh } = usePortal()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const submittedAt = me?.account.application_submitted_at ?? null

  useEffect(() => {
    if (!me) return
    const a = me.account
    setForm({
      ...EMPTY_FORM,
      legal_name: a.legal_name ?? '',
      trading_as: a.trading_as ?? '',
      abn: a.abn ?? '',
      head_office_address: a.head_office_address ?? '',
      phone: a.phone ?? '',
      director_name: a.director_name ?? '',
      director_email: a.director_email ?? '',
      director_phone: a.director_phone ?? '',
      finance_contact_name: a.finance_contact_name ?? '',
      finance_contact_title: a.finance_contact_title ?? '',
      finance_contact_email: a.finance_contact_email ?? '',
      finance_contact_phone: a.finance_contact_phone ?? '',
      billing_email: a.billing_email ?? '',
      billing_address: a.billing_address ?? '',
      payment_terms: a.payment_terms ?? '',
      payment_run_days: a.payment_run_days ?? '',
      payment_method: a.payment_method ?? '',
      purchase_order_required: !!a.purchase_order_required,
      reference1_company: a.reference1_company ?? '',
      reference1_contact: a.reference1_contact ?? '',
      reference1_phone: a.reference1_phone ?? '',
      reference1_email: a.reference1_email ?? '',
      reference2_company: a.reference2_company ?? '',
      reference2_contact: a.reference2_contact ?? '',
      reference2_phone: a.reference2_phone ?? '',
      reference2_email: a.reference2_email ?? '',
    })
  }, [me])

  const missing = useMemo(() => missingApplicationFields(form), [form])

  function set(key: TextField, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function persist(): Promise<boolean> {
    const res = await fetch('/api/portal/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? 'Could not save your details')
    return true
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving || submitting) return
    setSaving(true)
    setError('')
    try {
      await persist()
      setSaved(true)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details')
    } finally {
      setSaving(false)
    }
  }

  /*
   * Save first, then submit. The server validates against the stored row, so
   * skipping the save would reject details the client can plainly see on screen.
   */
  async function submitForReview() {
    if (saving || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await persist()
      const res = await fetch('/api/portal/company/submit', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const detail = Array.isArray(body?.missing) && body.missing.length
          ? ` Still needed: ${body.missing.join(', ')}.`
          : ''
        throw new Error(`${body?.error ?? 'Could not submit your details'}${detail}`)
      }
      setSaved(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your details')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !me) return <p style={meta}>Loading…</p>

  if (submittedAt) {
    return (
      <div style={{ maxWidth: 620 }}>
        <div style={eyebrow}>Your details</div>
        <h1 style={h1}>Trade account application</h1>

        <div style={{ marginTop: 20 }}>
          <Notice tone="success">
            Submitted for review on {shortDate(submittedAt)}. We will be in touch once your account
            has been reviewed. To change anything, contact us at{' '}
            {me.brand.email || 'our office'} and we will reopen the form.
          </Notice>
        </div>

        {APPLICATION_SECTIONS.map(group => (
          <div key={group.title} style={section}>
            <h2 style={{ ...h2, marginBottom: 16 }}>{group.title}</h2>
            {group.fields.map(([field, text]) => (
              <ReadOnlyRow key={field} label={text} value={displayValue(form, field)} />
            ))}
          </div>
        ))}

        <SignedInCard />
      </div>
    )
  }

  const busy = saving || submitting

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={eyebrow}>Your details</div>
      <h1 style={h1}>Trade account application</h1>
      <p style={{ ...meta, margin: '10px 0 24px' }}>
        We use these details to set up your account, run a standard credit check and agree terms
        that suit how you pay. Your company details also appear on your quotes and invoices. Save as
        you go &mdash; nothing is sent to us until you submit.
      </p>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Saved. You can come back and finish this later.</Notice>}

      <form onSubmit={save}>
        <div style={section}>
          <h2 style={h2}>Company</h2>
          <p style={sectionIntro}>The registered entity we will be contracting with.</p>

          <div style={{ marginBottom: 18 }}>
            <Text
              id="legal_name"
              field="legal_name"
              text="Registered company name"
              value={form.legal_name}
              onChange={set}
              required
            />
          </div>
          <div style={pair}>
            <Text
              id="trading_as"
              field="trading_as"
              text="Trading as"
              value={form.trading_as}
              onChange={set}
            />
            <Text id="abn" field="abn" text="ABN" value={form.abn} onChange={set} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="head_office_address" style={label}>
              Head office address
            </label>
            <textarea
              id="head_office_address"
              rows={3}
              value={form.head_office_address}
              onChange={e => set('head_office_address', e.target.value)}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <Text
            id="phone"
            field="phone"
            text="Main phone"
            type="tel"
            value={form.phone}
            onChange={set}
          />
        </div>

        <div style={section}>
          <h2 style={h2}>Director</h2>
          <p style={sectionIntro}>
            A director or owner of the company. Required for the credit check.
          </p>

          <div style={{ marginBottom: 18 }}>
            <Text
              id="director_name"
              field="director_name"
              text="Name"
              value={form.director_name}
              onChange={set}
            />
          </div>
          <div style={pair}>
            <Text
              id="director_email"
              field="director_email"
              text="Email"
              type="email"
              value={form.director_email}
              onChange={set}
            />
            <Text
              id="director_phone"
              field="director_phone"
              text="Phone"
              type="tel"
              value={form.director_phone}
              onChange={set}
            />
          </div>
        </div>

        <div style={section}>
          <h2 style={h2}>Accounts payable</h2>
          <p style={sectionIntro}>
            Who receives and pays our invoices, and how your payment process works. Telling us your
            pay run up front saves both of us chasing.
          </p>

          <div style={pair}>
            <Text
              id="finance_contact_name"
              field="finance_contact_name"
              text="Contact name"
              value={form.finance_contact_name}
              onChange={set}
            />
            <Text
              id="finance_contact_title"
              field="finance_contact_title"
              text="Title"
              placeholder="Finance Manager"
              value={form.finance_contact_title}
              onChange={set}
            />
          </div>
          <div style={pair}>
            <Text
              id="finance_contact_email"
              field="finance_contact_email"
              text="Contact email"
              type="email"
              value={form.finance_contact_email}
              onChange={set}
            />
            <Text
              id="finance_contact_phone"
              field="finance_contact_phone"
              text="Contact phone"
              type="tel"
              value={form.finance_contact_phone}
              onChange={set}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <Text
              id="billing_email"
              field="billing_email"
              text="Invoice email"
              type="email"
              placeholder="accounts@yourcompany.com.au"
              value={form.billing_email}
              onChange={set}
              hint="Where we send invoices. Can be a shared inbox."
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="billing_address" style={label}>
              Billing address
            </label>
            <textarea
              id="billing_address"
              rows={3}
              value={form.billing_address}
              onChange={e => set('billing_address', e.target.value)}
              style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div style={pair}>
            <Text
              id="payment_terms"
              field="payment_terms"
              text="Payment terms"
              placeholder="30 days from invoice"
              value={form.payment_terms}
              onChange={set}
            />
            <Text
              id="payment_run_days"
              field="payment_run_days"
              text="Payment run days"
              placeholder="Fridays"
              value={form.payment_run_days}
              onChange={set}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <Text
              id="payment_method"
              field="payment_method"
              text="Payment method"
              placeholder="EFT"
              value={form.payment_method}
              onChange={set}
            />
          </div>
          <label
            htmlFor="purchase_order_required"
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}
          >
            <input
              id="purchase_order_required"
              type="checkbox"
              checked={form.purchase_order_required}
              onChange={e => {
                setForm(prev => ({ ...prev, purchase_order_required: e.target.checked }))
                setSaved(false)
              }}
              style={{ width: 18, height: 18, marginTop: 1, accentColor: '#FF6B35' }}
            />
            <span>
              A purchase order number must appear on our invoices
              <span style={{ display: 'block', color: MUTED, fontSize: 13, marginTop: 2 }}>
                We will ask for a PO before starting work.
              </span>
            </span>
          </label>
        </div>

        <div style={section}>
          <h2 style={h2}>Trade references</h2>
          <p style={sectionIntro}>
            Two suppliers you hold an account with. We contact them only to confirm your payment
            history.
          </p>

          <ReferenceFields index={1} form={form} onChange={set} />
          <div style={{ borderTop: `1px solid ${LINE}`, margin: '22px 0' }} />
          <ReferenceFields index={2} form={form} onChange={set} />
        </div>

        <button type="submit" disabled={busy} style={buttonStyle('secondary', busy)}>
          {saving ? 'Saving…' : 'Save progress'}
        </button>
      </form>

      <div style={{ ...card, marginTop: 16, borderColor: missing.length ? LINE : '#FDBA74' }}>
        <h2 style={h2}>Submit for review</h2>
        {missing.length ? (
          <>
            <p style={{ ...meta, margin: '8px 0 12px' }}>
              {missing.length} {missing.length === 1 ? 'detail is' : 'details are'} still needed:
            </p>
            <ul style={{ ...meta, margin: '0 0 16px', paddingLeft: 20 }}>
              {missing.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ ...meta, margin: '8px 0 16px' }}>
            Everything we need is filled in. Submitting locks the form and sends it to us to review
            &mdash; contact us if you need to change something afterwards.
          </p>
        )}
        <button
          type="button"
          onClick={submitForReview}
          disabled={busy || missing.length > 0}
          style={buttonStyle('primary', busy || missing.length > 0)}
        >
          {submitting ? 'Submitting…' : 'Submit for review'}
        </button>
      </div>

      <SignedInCard />
    </div>
  )
}

function Text({
  id,
  field,
  text,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  hint,
}: {
  id: string
  field: TextField
  text: string
  value: string
  onChange: (field: TextField, value: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  hint?: string
}) {
  return (
    <div>
      <label htmlFor={id} style={label}>
        {text}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(field, e.target.value)}
        style={input}
      />
      {hint && <p style={{ ...meta, marginTop: 6, fontSize: 12 }}>{hint}</p>}
    </div>
  )
}

function ReferenceFields({
  index,
  form,
  onChange,
}: {
  index: 1 | 2
  form: FormState
  onChange: (field: TextField, value: string) => void
}) {
  const company = `reference${index}_company` as TextField
  const contact = `reference${index}_contact` as TextField
  const phone = `reference${index}_phone` as TextField
  const email = `reference${index}_email` as TextField

  return (
    <>
      <div style={{ ...label, color: '#111', marginBottom: 12 }}>Reference {index}</div>
      <div style={{ marginBottom: 18 }}>
        <Text
          id={company}
          field={company}
          text="Company"
          value={form[company]}
          onChange={onChange}
        />
      </div>
      <div style={pair}>
        <Text
          id={contact}
          field={contact}
          text="Contact name"
          value={form[contact]}
          onChange={onChange}
        />
        <Text
          id={phone}
          field={phone}
          text="Phone"
          type="tel"
          value={form[phone]}
          onChange={onChange}
        />
      </div>
      <Text
        id={email}
        field={email}
        text="Email"
        type="email"
        value={form[email]}
        onChange={onChange}
      />
    </>
  )
}

function ReadOnlyRow({ label: text, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={label}>{text}</div>
      <div style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>
        {value || <span style={{ color: MUTED }}>Not provided</span>}
      </div>
    </div>
  )
}

function displayValue(form: FormState, field: ApplicationField): string {
  if (field === 'purchase_order_required') return form.purchase_order_required ? 'Yes' : 'No'
  return form[field]
}

function SignedInCard() {
  const { me } = usePortal()
  if (!me) return null
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={label}>Signed in as</div>
      <div style={{ fontSize: 15 }}>
        {me.contact.name}
        {me.contact.title ? ` · ${me.contact.title}` : ''}
      </div>
      <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{me.contact.email}</div>
      <p style={{ ...meta, marginTop: 12, fontSize: 12 }}>
        To add or remove people who can access this account, or to change who can approve quotes,
        contact us at {me.brand.email || 'our office'}.
      </p>
    </div>
  )
}
