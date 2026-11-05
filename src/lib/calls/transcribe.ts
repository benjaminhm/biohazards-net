/*
 * lib/calls/transcribe.ts
 *
 * Download a call recording and transcribe it with OpenAI speech-to-text.
 *
 * Env:
 *   OPENAI_API_KEY             required
 *   OPENAI_TRANSCRIBE_MODEL    optional, default whisper-1
 *   VOIP_RECORDING_AUTH        optional Authorization header value for the
 *                              recording download (e.g. "Bearer …" or "Basic …")
 */

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** Domain words that speech-to-text otherwise mishears. */
const VOCABULARY =
  'Biohazard cleaning call, Queensland. Words: biohazard, decomposition, unattended death, trauma, hoarding, squalor, ' +
  'contents clearance, cubic metres, square metres, mould, sewage, bodily fluids, deceased estate, property manager, ' +
  'ensuite, granny flat, Brisbane, Gold Coast, Sunshine Coast, Ipswich, Logan, Toowoomba.'

function extensionFor(contentType: string, url: string): string {
  if (contentType.includes('wav')) return 'wav'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('webm')) return 'webm'
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'm4a'
  const fromUrl = url.split('?')[0].split('.').pop()?.toLowerCase()
  return fromUrl && ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4', 'mpeg', 'mpga', 'flac'].includes(fromUrl) ? fromUrl : 'mp3'
}

export async function transcribeRecording(recordingUrl: string): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

  const headers: Record<string, string> = {}
  if (process.env.VOIP_RECORDING_AUTH) headers.Authorization = process.env.VOIP_RECORDING_AUTH
  const audioRes = await fetch(recordingUrl, { headers })
  if (!audioRes.ok) throw new Error(`Recording download failed (${audioRes.status})`)
  const audio = await audioRes.arrayBuffer()
  if (audio.byteLength === 0) throw new Error('Recording is empty')
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new Error('Recording is over 25 MB, too large to transcribe in one pass')

  const contentType = audioRes.headers.get('content-type') ?? 'audio/mpeg'
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: contentType }), `call.${extensionFor(contentType, recordingUrl)}`)
  form.append('model', model)
  form.append('language', 'en')
  form.append('prompt', VOCABULARY)
  form.append('response_format', 'json')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(`Transcription failed: ${data.error?.message ?? res.status}`)
  const text = (data.text ?? '').trim()
  if (!text) throw new Error('Transcription came back empty')
  return { text, model }
}
