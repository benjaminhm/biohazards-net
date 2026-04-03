/*
 * lib/supabase.ts
 *
 * Supabase client factory. There are two clients in this app:
 *
 *   supabase          — anon key, for client-side use (subject to RLS).
 *   createServiceClient() — service role key, for API routes only.
 *
 * IMPORTANT: Row-Level Security is intentionally bypassed in all API routes
 * by using the service role key. Tenancy isolation is enforced manually by
 * scoping every query with .eq('org_id', orgId). Never expose the service
 * role key to the browser.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/*
 * Returns a Supabase client authenticated as the service role.
 * Call inside API route handlers only — never in browser code.
 * persistSession: false prevents session storage in server environments.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
