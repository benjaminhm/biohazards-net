/**
 * One-off backfill: normalize legacy phone columns to strict E.164 (AU default),
 * matching lib/phone formatToTwilioE164 used on write.
 *
 * Usage (from repo root, with .env.local containing Supabase URL + service role key):
 *   npx tsx scripts/migrate-phones-to-e164.ts           # apply
 *   npx tsx scripts/migrate-phones-to-e164.ts --dry-run # log only
 *
 * Non-empty values that fail parsing are left unchanged and logged.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { formatToTwilioE164 } from '../src/lib/phone'

function loadEnvLocal() {
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvLocal()

const dryRun = process.argv.includes('--dry-run')

/** PostgREST: table not in schema cache (missing table, wrong project, or API schema not refreshed). */
function isMissingTableError(err: { code?: string } | null): boolean {
  return err?.code === 'PGRST205'
}

function logProjectHint(supabaseUrl: string) {
  try {
    const host = new URL(supabaseUrl).hostname
    console.error(`Connected API host: ${host}`)
    console.error('Confirm this matches your Supabase project: Settings → API → Project URL.\n')
  } catch {
    /* ignore */
  }
}

function normalizeOrWarn(
  table: string,
  id: string,
  column: string,
  raw: string | null | undefined
): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s) return undefined
  const e164 = formatToTwilioE164(s)
  if (!e164) {
    console.warn(`[skip invalid] ${table} ${id} ${column}: ${JSON.stringify(raw)}`)
    return undefined
  }
  if (e164 === s) return undefined
  return e164
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  let rowsUpdated = 0

  // ── people ─────────────────────────────────────────
  const { data: people, error: peErr } = await supabase
    .from('people')
    .select('id, phone, emergency_phone')
  if (peErr) {
    if (isMissingTableError(peErr)) {
      logProjectHint(url)
      console.error(
        `[skip] Table "people" not found via the API. Apply repo SQL migrations to this project ` +
          `(e.g. supabase-migration-006.sql), or fix NEXT_PUBLIC_SUPABASE_URL if this is the wrong project.\n`
      )
    } else throw peErr
  } else {
  for (const row of people ?? []) {
    const patch: Record<string, string> = {}
    const np = normalizeOrWarn('people', row.id, 'phone', row.phone)
    if (np !== undefined) patch.phone = np
    const ne = normalizeOrWarn('people', row.id, 'emergency_phone', row.emergency_phone)
    if (ne !== undefined) patch.emergency_phone = ne
    if (Object.keys(patch).length === 0) continue
    if (dryRun) {
      console.log('[dry-run] people', row.id, patch)
      rowsUpdated++
      continue
    }
    const { error } = await supabase.from('people').update(patch).eq('id', row.id)
    if (error) throw error
    rowsUpdated++
  }
  }

  // ── company_profile ─────────────────────────────────
  const { data: companies, error: coErr } = await supabase
    .from('company_profile')
    .select('id, phone')
  if (coErr) {
    if (isMissingTableError(coErr)) {
      console.error(`[skip] Table "company_profile" not found (PGRST205).\n`)
    } else throw coErr
  } else {
  for (const row of companies ?? []) {
    const np = normalizeOrWarn('company_profile', row.id, 'phone', row.phone)
    if (np === undefined) continue
    if (dryRun) {
      console.log('[dry-run] company_profile', row.id, { phone: np })
      rowsUpdated++
      continue
    }
    const { error } = await supabase.from('company_profile').update({ phone: np }).eq('id', row.id)
    if (error) throw error
    rowsUpdated++
  }
  }

  // ── jobs (client_phone + client_phones JSON) ───────
  const { data: jobs, error: jErr } = await supabase
    .from('jobs')
    .select('id, client_phone, client_phones')
  if (jErr) {
    if (isMissingTableError(jErr)) {
      console.error(`[skip] Table "jobs" not found (PGRST205).\n`)
    } else throw jErr
  } else {
  for (const row of jobs ?? []) {
    const patch: Record<string, string | unknown> = {}
    const cp = normalizeOrWarn('jobs', row.id, 'client_phone', row.client_phone)
    if (cp !== undefined) patch.client_phone = cp

    const rawPhones = row.client_phones
    if (Array.isArray(rawPhones) && rawPhones.length > 0) {
      let phonesChanged = false
      const next = rawPhones.map((item: unknown) => {
        if (!item || typeof item !== 'object') return item
        const o = item as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label : ''
        const num = typeof o.number === 'string' ? o.number : ''
        if (!String(num).trim()) return { label, number: num }
        const e164 = formatToTwilioE164(num)
        if (!e164) {
          console.warn(`[skip invalid] jobs ${row.id} client_phones.number: ${JSON.stringify(num)}`)
          return { label, number: num }
        }
        if (e164 !== String(num).trim()) phonesChanged = true
        return { label, number: e164 }
      })
      if (phonesChanged) patch.client_phones = next
    }

    if (Object.keys(patch).length === 0) continue
    if (dryRun) {
      console.log('[dry-run] jobs', row.id, patch)
      rowsUpdated++
      continue
    }
    const { error } = await supabase.from('jobs').update(patch).eq('id', row.id)
    if (error) throw error
    rowsUpdated++
  }
  }

  // ── messages (paginated) ────────────────────────────
  const pageSize = 500
  let offset = 0
  for (;;) {
    const { data: msgs, error: mErr } = await supabase
      .from('messages')
      .select('id, from_number, to_number')
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (mErr) {
      if (isMissingTableError(mErr)) {
        if (offset === 0) console.error(`[skip] Table "messages" not found (PGRST205).\n`)
        break
      }
      throw mErr
    }
    if (!msgs?.length) break

    for (const row of msgs) {
      const patch: Record<string, string> = {}
      const nf = normalizeOrWarn('messages', row.id, 'from_number', row.from_number)
      if (nf !== undefined) patch.from_number = nf
      const nt = normalizeOrWarn('messages', row.id, 'to_number', row.to_number)
      if (nt !== undefined) patch.to_number = nt
      if (Object.keys(patch).length === 0) continue
      if (dryRun) {
        console.log('[dry-run] messages', row.id, patch)
        rowsUpdated++
        continue
      }
      const { error } = await supabase.from('messages').update(patch).eq('id', row.id)
      if (error) throw error
      rowsUpdated++
    }

    if (msgs.length < pageSize) break
    offset += pageSize
  }

  console.log(
    dryRun
      ? `Dry run complete. Rows that would update: ${rowsUpdated} (see logs above).`
      : `Done. Rows updated: ${rowsUpdated}.`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
