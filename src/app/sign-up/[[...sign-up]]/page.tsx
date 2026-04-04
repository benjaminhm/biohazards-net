/*
 * app/sign-up/[[...sign-up]]/page.tsx
 *
 * Sign-up page — used by invite links to onboard new team members.
 * Invite page redirects here (not /login) so new users land on the
 * SignUp component rather than SignIn, avoiding "couldn't find account".
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
