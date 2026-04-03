/*
 * app/login/[[...sign-in]]/page.tsx
 *
 * Login page — wraps Clerk's <SignIn> component in a branded shell.
 * The [[...sign-in]] catch-all route allows Clerk's embedded routing to handle
 * multi-step flows (OTP, social auth, etc.) within the same URL path.
 *
 * routing="path" + path="/login" tells Clerk to use path-based routing rather
 * than hash routing, which is required for Next.js App Router.
 *
 * After sign-in, Clerk redirects to the URL in the afterSignInUrl env var
 * (set to "/") which UserProvider then interprets based on has_org + role.
 */
import { SignIn } from '@clerk/nextjs'

export default function LoginPage() {
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
      <SignIn routing="path" path="/login" />
    </div>
  )
}
