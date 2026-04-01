import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getOrgId(userId: string) {
  const { data } = await supabase
    .from('org_users')
    .select('org_id')
    .eq('clerk_user_id', userId)
    .single()
  return data?.org_id ?? null
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await getOrgId(userId)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 403 })
  const { id: personId } = await params

  const body = await req.json()
  const { data, error } = await supabase
    .from('people_documents')
    .insert({ ...body, person_id: personId, org_id: orgId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ document: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: personId } = await params
  const { docId } = await req.json()

  const { error } = await supabase
    .from('people_documents')
    .delete()
    .eq('id', docId)
    .eq('person_id', personId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
