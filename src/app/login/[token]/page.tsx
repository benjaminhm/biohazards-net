/*
 * app/login/[token]/page.tsx
 *
 * The token is consumed only when the visitor submits the form. A mail scanner
 * that merely opens the link cannot spend it. The submit is a normal form POST,
 * not a script, so it still works inside a mail app's browser.
 */
import Link from 'next/link'
import { staffSignInFailureMessage, type StaffConsumeFailure } from '@/lib/staffLogin'

export default async function LoginConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams
  const reason = error === 'used' || error === 'expired' || error === 'invalid' ? error : ''
  const message = reason ? staffSignInFailureMessage(reason as StaffConsumeFailure) : ''

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 24,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)' }}>biohazards.net</div>
      </div>
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 24,
      }}>
        {message ? (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#F87171' }}>{message}</p>
            <Link href="/login" style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 700,
              textDecoration: 'none',
            }}>
              Request a new link
            </Link>
          </>
        ) : (
          <form method="POST" action="/api/auth/consume">
            <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
              Press continue to sign in on this device.
            </p>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--accent)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Continue
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
