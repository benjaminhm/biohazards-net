/*
 * app/sign-up/[[...sign-up]]/page.tsx
 *
 * Sign-up page — new users must hit <SignUp />, not <SignIn />.
 * Staff invite (/invite/…) redirects here; middleware sends Clerk admin
 * invitation links (/login?__clerk_ticket=…) here too so invitees create
 * an account instead of getting "Couldn't find your account."
 */
import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
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
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 12px',
        }}>
          ☣️
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)' }}>biohazards.net</div>
      </div>
      <SignUp routing="path" path="/sign-up" />
    </div>
  )
}
