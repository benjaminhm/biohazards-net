import type { AssessmentDocumentCapture, ContentBlock } from '@/lib/types'
import { CONTENT_BLOCKS_VERSION } from '@/lib/types'

const MAX_BLOCK_BODY = 8000
const MAX_BLOCKS = 32

const FIELD_SPECS: { id: string; key: keyof AssessmentDocumentCapture; title: string }[] = [
  { id: 'assessment_doc.site_summary', key: 'site_summary', title: 'Site summary' },
  { id: 'assessment_doc.hazards_overview', key: 'hazards_overview', title: 'Hazards overview' },
  { id: 'assessment_doc.risks_overview', key: 'risks_overview', title: 'Risks overview' },
  { id: 'assessment_doc.control_measures', key: 'control_measures', title: 'Control measures' },
  { id: 'assessment_doc.recommendations', key: 'recommendations', title: 'Recommendations' },
  { id: 'assessment_doc.limitations', key: 'limitations', title: 'Limitations' },
]

function clip(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max)
}

/** Build job content blocks from Assessment → Document capture (sync on save). */
export function contentBlocksFromAssessmentDocumentCapture(
  capture: AssessmentDocumentCapture,
): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const { id, key, title } of FIELD_SPECS) {
    const body = clip(typeof capture[key] === 'string' ? capture[key] : '', MAX_BLOCK_BODY)
    if (!body) continue
    out.push({ id, type: 'prose', title, body })
    if (out.length >= MAX_BLOCKS) break
  }
  return out
}

export function assessmentSaveContentBlocksPayload(capture: AssessmentDocumentCapture): {
  content_blocks: ContentBlock[]
  content_blocks_version: typeof CONTENT_BLOCKS_VERSION
} {
  return {
    content_blocks: contentBlocksFromAssessmentDocumentCapture(capture),
    content_blocks_version: CONTENT_BLOCKS_VERSION,
  }
}
