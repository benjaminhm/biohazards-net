/*
 * app/field/jobs/[id]/page.tsx
 *
 * Stable team-member job detail surface. This intentionally does not import
 * the admin job tabs from /jobs/[id], so admin redesigns cannot change what
 * technicians see in the field.
 */
'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface FieldJob {
  id: string
  status: string
  urgency: string
  job_type: string
  site_address: string
  access_notes: string | null
  scheduled_at: string | null
  schedule_note: string | null
}

interface FieldTeamContact {
  id: string
  name: string
  role: string
  phone: string | null
  email: string | null
  app_role: string
}

interface FieldPhoto {
  id: string
  file_url: string
  caption: string
  area_ref: string
  category: string
  uploaded_at: string
  uploaded_by_name?: string | null
  taken_at?: string | null
  location_lat?: number | null
  location_lng?: number | null
  location_accuracy_m?: number | null
  location_label?: string | null
  location_place_id?: string | null
}

interface FieldPreStartBriefing {
  id: string
  job_id: string
  title: string
  description: string
  video_url: string
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

interface FieldPreStartAcknowledgement {
  id: string
  briefing_id: string
  job_id: string
  person_id: string
  viewed_at: string | null
  acknowledged_at: string | null
  updated_at: string
}

interface FieldJobResponse {
  job?: FieldJob
  contacts?: FieldTeamContact[]
  photos?: FieldPhoto[]
  prestart_briefings?: FieldPreStartBriefing[]
  prestart_acknowledgements?: FieldPreStartAcknowledgement[]
  current_person_id?: string | null
  error?: string
}

const JOB_TYPE_LABELS: Record<string, string> = {
  crime_scene: 'Crime Scene',
  hoarding: 'Hoarding',
  mold: 'Mould',
  sewage: 'Sewage',
  trauma: 'Trauma',
  unattended_death: 'Unattended Death',
  flood: 'Flood',
  other: 'Other',
}

function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function firstAddressLine(address: string) {
  return address.split(',')[0]?.trim() || address
}

function formatSchedule(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  return {
    date: date.toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
  }
}

function contactRoleLabel(contact: FieldTeamContact) {
  if (contact.app_role === 'admin') return 'Manager'
  if (contact.app_role === 'manager' || contact.app_role === 'team_lead') return 'Manager'
  return titleCase(contact.role)
}

export default function FieldJobPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [job, setJob] = useState<FieldJob | null>(null)
  const [contacts, setContacts] = useState<FieldTeamContact[]>([])
  const [photos, setPhotos] = useState<FieldPhoto[]>([])
  const [prestartBriefings, setPrestartBriefings] = useState<FieldPreStartBriefing[]>([])
  const [prestartAcknowledgements, setPrestartAcknowledgements] = useState<FieldPreStartAcknowledgement[]>([])
  const [currentPersonId, setCurrentPersonId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [ackBusyId, setAckBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/field/jobs/${id}`)
      .then(async res => {
        const data = (await res.json()) as FieldJobResponse
        if (!res.ok) throw new Error(data.error || 'Could not load job')
        if (cancelled) return
        setJob(data.job ?? null)
        setContacts(data.contacts ?? [])
        setPhotos(data.photos ?? [])
        setPrestartBriefings(data.prestart_briefings ?? [])
        setPrestartAcknowledgements(data.prestart_acknowledgements ?? [])
        setCurrentPersonId(data.current_person_id ?? null)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load job')
        setJob(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [id])

  async function refreshPhotos() {
    const res = await fetch(`/api/field/jobs/${id}`)
    const data = (await res.json()) as FieldJobResponse
    if (!res.ok) throw new Error(data.error || 'Could not refresh photos')
    setPhotos(data.photos ?? [])
  }

  async function acknowledgeBriefing(briefingId: string) {
    if (ackBusyId) return
    setAckBusyId(briefingId)
    try {
      const res = await fetch(`/api/field/jobs/${id}/prestart-briefings/${briefingId}/acknowledge`, {
        method: 'POST',
      })
      const data = (await res.json()) as { acknowledgement?: FieldPreStartAcknowledgement; error?: string }
      if (!res.ok || !data.acknowledgement) throw new Error(data.error || 'Could not acknowledge briefing')
      setPrestartAcknowledgements(prev => {
        const without = prev.filter(ack => ack.briefing_id !== briefingId)
        return [data.acknowledgement!, ...without]
      })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not acknowledge briefing')
    } finally {
      setAckBusyId(null)
    }
  }

  async function handlePhotoSelected(file: File | undefined) {
    if (!file || uploadingPhoto) return
    setUploadingPhoto(true)
    setPhotoError('')

    try {
      const location = await getCurrentLocation()

      const signRes = await fetch(`/api/field/jobs/${id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sign',
          fileName: file.name,
          contentType: file.type || 'image/jpeg',
        }),
      })
      const signData = (await signRes.json()) as { signedUrl?: string; publicUrl?: string; error?: string }
      if (!signRes.ok || !signData.signedUrl || !signData.publicUrl) {
        throw new Error(signData.error || 'Could not prepare photo upload')
      }

      const uploadRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Photo upload failed')

      const saveRes = await fetch(`/api/field/jobs/${id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: signData.publicUrl,
          category: 'during',
          capture_phase: 'progress',
          taken_at: new Date(file.lastModified || Date.now()).toISOString(),
          location_lat: location?.lat ?? null,
          location_lng: location?.lng ?? null,
          location_accuracy_m: location?.accuracy ?? null,
          location_label: null,
          location_place_id: null,
        }),
      })
      const saveData = (await saveRes.json()) as { photo?: FieldPhoto; error?: string }
      if (!saveRes.ok) throw new Error(saveData.error || 'Could not save photo metadata')

      if (saveData.photo) setPhotos(prev => [saveData.photo!, ...prev])
      else await refreshPhotos()
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text-muted)' }}>
        <span className="spinner" />
      </div>
    )
  }

  if (error || !job) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{error || 'Job not found'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 18 }}>This job may not be assigned to you.</div>
          <button className="btn btn-secondary" onClick={() => router.replace('/field')}>Back to My Jobs</button>
        </div>
      </div>
    )
  }

  const serviceLabel = JOB_TYPE_LABELS[job.job_type] ?? titleCase(job.job_type)
  const schedule = formatSchedule(job.scheduled_at)
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(job.site_address)}`
  const manager = contacts.find(contact => contact.app_role === 'admin' || contact.app_role === 'manager' || contact.app_role === 'team_lead')
  const otherContacts = contacts.filter(contact => contact.id !== manager?.id)

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', paddingBottom: 44 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '12px 16px 14px' }}>
          <button
            className="btn btn-ghost"
            onClick={() => router.push('/field')}
            style={{ padding: '4px 0', fontSize: 13, marginBottom: 8 }}
          >
            Back to My Jobs
          </button>
          <div style={{ fontSize: 22, fontWeight: 850, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {serviceLabel}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
            {firstAddressLine(job.site_address)}
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px' }}>
        {manager && (
          <ContactCard title="Your Manager" contact={manager} highlight />
        )}

        <InfoCard title="Job Summary">
          <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)' }}>
            Attend the site for {serviceLabel.toLowerCase()} works. This field view is read-only and only includes details needed for attendance and coordination.
          </div>
        </InfoCard>

        <InfoCard title="Site Address">
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, lineHeight: 1.45 }}>{job.site_address}</div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '9px 15px',
              borderRadius: 8,
              background: 'var(--accent)',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Open in Maps
          </a>
        </InfoCard>

        {(schedule || job.schedule_note || job.access_notes) && (
          <InfoCard title="Schedule and Access">
            {schedule && (
              <div style={{ marginBottom: job.schedule_note || job.access_notes ? 14 : 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>{schedule.date}</div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 3, fontWeight: 700 }}>{schedule.time}</div>
              </div>
            )}
            {job.schedule_note && <NoteBlock label="Schedule Note" value={job.schedule_note} />}
            {job.access_notes && <NoteBlock label="Access Notes" value={job.access_notes} />}
          </InfoCard>
        )}

        {prestartBriefings.length > 0 && (
          <InfoCard title={`Pre-start Briefing (${prestartBriefings.length})`}>
            <div style={{ display: 'grid', gap: 12 }}>
              {prestartBriefings.map(briefing => {
                const acknowledgement = prestartAcknowledgements.find(ack => ack.briefing_id === briefing.id)
                return (
                  <PreStartBriefingCard
                    key={briefing.id}
                    briefing={briefing}
                    acknowledgement={acknowledgement}
                    canAcknowledge={!!currentPersonId}
                    busy={ackBusyId === briefing.id}
                    onAcknowledge={() => acknowledgeBriefing(briefing.id)}
                  />
                )
              })}
            </div>
          </InfoCard>
        )}

        <InfoCard
          title={`Photos (${photos.length})`}
          action={
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 8,
              background: uploadingPhoto ? 'var(--surface-2)' : 'var(--accent)',
              color: uploadingPhoto ? 'var(--text-muted)' : '#fff',
              fontSize: 12,
              fontWeight: 850,
              cursor: uploadingPhoto ? 'wait' : 'pointer',
            }}>
              {uploadingPhoto ? 'Uploading...' : 'Take / Upload'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploadingPhoto}
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.currentTarget.value = ''
                  void handlePhotoSelected(file)
                }}
                style={{ display: 'none' }}
              />
            </label>
          }
        >
          {photoError && (
            <div style={{ fontSize: 13, color: '#F87171', lineHeight: 1.45, marginBottom: 12 }}>
              {photoError}
            </div>
          )}
          {photos.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 10 }}>
              {photos.map(photo => (
                <a key={photo.id} href={photo.file_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{
                    aspectRatio: '1 / 1',
                    borderRadius: 10,
                    background: `url(${photo.file_url}) center / cover`,
                    border: '1px solid var(--border)',
                  }} />
                </a>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)' }}>
              No photos have been added yet.
            </div>
          )}
        </InfoCard>

        {otherContacts.length > 0 && (
          <InfoCard title="Team Contacts">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {otherContacts.map(contact => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          </InfoCard>
        )}
      </main>
    </div>
  )
}

function InfoCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '16px 18px',
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function NoteBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 9,
      background: 'rgba(255,107,53,0.06)',
      border: '1px solid rgba(255,107,53,0.22)',
      fontSize: 13,
      lineHeight: 1.55,
      marginTop: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 850, color: 'var(--accent)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      {value}
    </div>
  )
}

function PreStartBriefingCard({
  briefing,
  acknowledgement,
  canAcknowledge,
  busy,
  onAcknowledge,
}: {
  briefing: FieldPreStartBriefing
  acknowledgement?: FieldPreStartAcknowledgement
  canAcknowledge: boolean
  busy: boolean
  onAcknowledge: () => void
}) {
  const acknowledged = !!acknowledgement?.acknowledged_at
  return (
    <div style={{
      border: acknowledged ? '1px solid rgba(74,222,128,0.35)' : '1px solid var(--border)',
      background: acknowledged ? 'rgba(74,222,128,0.06)' : 'var(--surface-2)',
      borderRadius: 12,
      padding: 13,
    }}>
      {briefing.thumbnail_url && (
        <a href={briefing.video_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 10 }}>
          <div
            aria-label=""
            style={{
              width: '100%',
              height: 180,
              background: `url(${briefing.thumbnail_url}) center / cover`,
              borderRadius: 10,
              border: '1px solid var(--border)',
            }}
          />
        </a>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 850, lineHeight: 1.25 }}>{briefing.title}</div>
          <div style={{ color: acknowledged ? '#4ADE80' : 'var(--text-muted)', fontSize: 11, fontWeight: 800, marginTop: 4 }}>
            {acknowledged ? `Acknowledged ${formatDateTime(acknowledgement!.acknowledged_at!)}` : 'Acknowledgement required'}
          </div>
        </div>
        <a href={briefing.video_url} target="_blank" rel="noreferrer" style={contactActionStyle(true)}>
          Watch
        </a>
      </div>
      {briefing.description && (
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
          {briefing.description}
        </div>
      )}
      <button
        className={acknowledged ? 'btn btn-secondary' : 'btn btn-primary'}
        disabled={busy || acknowledged || !canAcknowledge}
        onClick={onAcknowledge}
        style={{ width: '100%', fontSize: 13 }}
      >
        {acknowledged ? 'Watched and Understood' : busy ? 'Saving...' : 'I watched and understand'}
      </button>
    </div>
  )
}

function ContactCard({ title, contact, highlight }: { title: string; contact: FieldTeamContact; highlight?: boolean }) {
  const colour = highlight ? 'var(--accent)' : 'var(--text-muted)'
  const phone = contact.phone?.replace(/\s/g, '')

  return (
    <section style={{
      background: highlight ? 'rgba(255,107,53,0.06)' : 'var(--surface)',
      border: highlight ? '1.5px solid rgba(255,107,53,0.28)' : '1px solid var(--border)',
      borderRadius: 16,
      padding: 18,
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.08em', color: colour, marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={contact.name} colour={colour} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 850, fontSize: 17, marginBottom: 2 }}>{contact.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{contactRoleLabel(contact)}</div>
        </div>
        <ContactActions phone={phone} email={contact.email} />
      </div>
    </section>
  )
}

function ContactRow({ contact }: { contact: FieldTeamContact }) {
  const phone = contact.phone?.replace(/\s/g, '')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <Avatar name={contact.name} colour="var(--text-muted)" small />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 750, fontSize: 14 }}>{contact.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{contactRoleLabel(contact)}</div>
      </div>
      <ContactActions phone={phone} email={contact.email} compact />
    </div>
  )
}

function ContactActions({ phone, email, compact }: { phone?: string; email?: string | null; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {phone && (
        <a href={`tel:${phone}`} style={contactActionStyle(compact)}>Call</a>
      )}
      {phone && (
        <a href={`sms:${phone}`} style={contactActionStyle(compact)}>SMS</a>
      )}
      {email && (
        <a href={`mailto:${email}`} style={contactActionStyle(compact)}>Email</a>
      )}
    </div>
  )
}

function Avatar({ name, colour, small }: { name: string; colour: string; small?: boolean }) {
  const size = small ? 38 : 52
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      flexShrink: 0,
      background: 'var(--surface-2)',
      border: `1px solid ${colour}`,
      color: colour,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: small ? 13 : 18,
      fontWeight: 850,
    }}>
      {name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase()}
    </div>
  )
}

function contactActionStyle(compact?: boolean): CSSProperties {
  return {
    padding: compact ? '6px 8px' : '8px 10px',
    borderRadius: 8,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    textDecoration: 'none',
    fontSize: compact ? 11 : 12,
    fontWeight: 800,
  }
}

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Time not captured'
  return date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getCurrentLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null)

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  })
}

