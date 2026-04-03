import { createServiceClient } from '@/lib/supabase'

// Signature validation temporarily disabled for debugging
// Re-enable once inbound is confirmed working
export async function POST(req: Request) {
  const body = await req.text()
  const params = Object.fromEntries(new URLSearchParams(body))

  const from  = params.From  ?? ''
  const to    = params.To    ?? ''
  const body2 = params.Body  ?? ''
  const sid   = params.MessageSid ?? null

  if (!from || !body2) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  const supabase = createServiceClient()

  // Normalise the incoming number to last 9 digits for matching
  // Twilio sends +61400000000, DB might have 0400000000 or 0400 000 000
  const digitsOnly = from.replace(/\D/g, '')
  const last9 = digitsOnly.slice(-9) // e.g. 400000000

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, org_id, client_phone')
    .ilike('client_phone', `%${last9}%`)
    .order('created_at', { ascending: false })
    .limit(5)

  // Pick the most recent active job for this number
  let jobId: string | null = null
  let orgId: string | null = null

  if (jobs && jobs.length > 0) {
    jobId = jobs[0].id
    orgId = jobs[0].org_id
  }

  // If no job found, still try to get org from the first org (single-tenant fallback)
  if (!orgId) {
    const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
    orgId = org?.id ?? null
  }

  if (!orgId) {
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  // Insert inbound message (unread — read_at null)
  if (jobId) {
    await supabase.from('messages').insert({
      org_id: orgId,
      job_id: jobId,
      direction: 'inbound',
      from_number: from,
      to_number: to,
      body: body2,
      twilio_sid: sid,
      read_at: null,
    })
  }

  // TwiML empty response — don't auto-reply
  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
