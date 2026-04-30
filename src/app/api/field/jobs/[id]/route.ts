/*
 * app/api/field/jobs/[id]/route.ts
 *
 * Stable team-member job detail API. It never returns client PII or document
 * internals, and members must be assigned to the job unless their role/caps can
 * view all jobs.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { getOrgId } from '@/lib/org'
import {
  FIELD_JOB_SELECT,
  type FieldJobRow,
  type FieldPhoto,
  type FieldTeamContact,
  type OrgUserAccessRow,
  resolveFieldAccess,
  sanitizeFieldJob,
} from '@/lib/fieldJobs'

interface AssignmentRow {
  person_id: string
  people: PersonJoin | PersonJoin[] | null
}

interface PersonJoin {
  id: string
  name: string
  role: string
  phone: string | null
  email: string | null
}

interface OrgRoleRow {
  person_id: string
  role: string
}

function firstPerson(value: PersonJoin | PersonJoin[] | null): PersonJoin | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function rankContact(contact: FieldTeamContact) {
  if (contact.app_role === 'admin') return 0
  if (contact.app_role === 'manager' || contact.app_role === 'team_lead') return 1
  return 2
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: jobId } = await params
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgId } = await getOrgId(req, userId)
    if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: orgUser, error: orgUserError } = await supabase
      .from('org_users')
      .select('role, person_id, capabilities')
      .eq('clerk_user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (orgUserError) throw orgUserError

    const access = resolveFieldAccess(orgUser as OrgUserAccessRow | null)
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let isAssigned = false
    if (access.personId) {
      const { data: assignment, error: assignmentError } = await supabase
        .from('job_assignments')
        .select('id')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .eq('person_id', access.personId)
        .maybeSingle()

      if (assignmentError) throw assignmentError
      isAssigned = !!assignment
    }

    if (!access.canViewAllJobs && !isAssigned) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(FIELD_JOB_SELECT)
      .eq('id', jobId)
      .eq('org_id', orgId)
      .is('archived_at', null)
      .maybeSingle()

    if (jobError) throw jobError
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const [
      { data: assignmentRows, error: teamError },
      { data: photoRows, error: photoError },
      { data: briefingRows, error: briefingError },
      { data: acknowledgementRows, error: acknowledgementError },
    ] = await Promise.all([
      supabase
        .from('job_assignments')
        .select('person_id, people(id, name, role, phone, email)')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('created_at'),
      access.canViewAllJobs || access.capabilities.upload_photos_any || access.capabilities.upload_photos_assigned
        ? supabase
            .from('photos')
            .select('id, job_id, file_url, caption, area_ref, category, capture_phase, uploaded_at, uploaded_by_user_id, uploaded_by_person_id, uploaded_by_name, taken_at, location_lat, location_lng, location_accuracy_m, location_label, location_place_id')
            .eq('job_id', jobId)
            .order('uploaded_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('job_prestart_briefings')
        .select('id, job_id, title, description, video_url, thumbnail_url, created_at, updated_at')
        .eq('job_id', jobId)
        .eq('org_id', orgId)
        .order('created_at', { ascending: true }),
      access.personId
        ? supabase
            .from('job_prestart_acknowledgements')
            .select('id, briefing_id, job_id, person_id, viewed_at, acknowledged_at, updated_at')
            .eq('job_id', jobId)
            .eq('org_id', orgId)
            .eq('person_id', access.personId)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (teamError) throw teamError
    if (photoError) throw photoError
    if (briefingError) throw briefingError
    if (acknowledgementError) throw acknowledgementError

    const assignments = (assignmentRows ?? []) as AssignmentRow[]
    const personIds = assignments.map(assignment => assignment.person_id).filter(Boolean)
    const { data: orgRoles, error: orgRolesError } = personIds.length > 0
      ? await supabase
          .from('org_users')
          .select('person_id, role')
          .eq('org_id', orgId)
          .in('person_id', personIds)
      : { data: [], error: null }

    if (orgRolesError) throw orgRolesError

    const roleMap = new Map(
      ((orgRoles ?? []) as OrgRoleRow[]).map(roleRow => [roleRow.person_id, roleRow.role])
    )
    const contacts = assignments
      .map<FieldTeamContact | null>((assignment) => {
        const person = firstPerson(assignment.people)
        if (!person) return null
        return {
          id: person.id,
          name: person.name,
          role: person.role,
          phone: person.phone,
          email: person.email,
          app_role: roleMap.get(person.id) ?? 'member',
        }
      })
      .filter((contact): contact is FieldTeamContact => !!contact)
      .sort((a, b) => rankContact(a) - rankContact(b))

    return NextResponse.json({
      job: sanitizeFieldJob(job as unknown as FieldJobRow),
      contacts,
      photos: (photoRows ?? []) as FieldPhoto[],
      prestart_briefings: briefingRows ?? [],
      prestart_acknowledgements: acknowledgementRows ?? [],
      current_person_id: access.personId,
      permissions: access.capabilities,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
