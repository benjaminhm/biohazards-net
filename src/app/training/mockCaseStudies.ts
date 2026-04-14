export type StudyStatus = 'draft' | 'authorized_admin_only' | 'published_students'

export interface CaseStudy {
  id: string
  title: string
  slug: string
  overview: string
  hazardType: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  readTimeMin: number
  status: StudyStatus
  hostedFileUrl: string
  authorisedBy: string | null
  authorisedAt: string | null
  publishedAt: string | null
  studentVisible: boolean
}

export const seedStudies: CaseStudy[] = [
  {
    id: 'cs1',
    title: 'Meth Lab Decontamination - Multi-Room Unit',
    slug: 'meth-lab-multi-room-unit',
    overview: 'Residential unit requiring staged decontamination and room-by-room clearance controls.',
    hazardType: 'Methamphetamine',
    difficulty: 'Advanced',
    readTimeMin: 12,
    status: 'draft',
    hostedFileUrl: '/training/case-studies/meth-lab-multi-room-unit',
    authorisedBy: null,
    authorisedAt: null,
    publishedAt: null,
    studentVisible: false,
  },
  {
    id: 'cs2',
    title: 'Flood Event With Category 3 Contamination',
    slug: 'flood-category-3-response',
    overview: 'Water intrusion with sewage contamination across mixed hard and porous materials.',
    hazardType: 'Flood and Sewage',
    difficulty: 'Intermediate',
    readTimeMin: 10,
    status: 'authorized_admin_only',
    hostedFileUrl: '/training/case-studies/flood-category-3-response',
    authorisedBy: 'Ben Mustonen',
    authorisedAt: '2026-04-12T02:00:00.000Z',
    publishedAt: null,
    studentVisible: false,
  },
  {
    id: 'cs3',
    title: 'Trauma Scene Protocol and Handover',
    slug: 'trauma-scene-handover',
    overview: 'End-to-end incident response, verification points, and handover sequencing for compliant completion.',
    hazardType: 'Trauma',
    difficulty: 'Beginner',
    readTimeMin: 8,
    status: 'published_students',
    hostedFileUrl: '/training/case-studies/trauma-scene-handover',
    authorisedBy: 'Ben Mustonen',
    authorisedAt: '2026-04-01T03:30:00.000Z',
    publishedAt: '2026-04-02T01:10:00.000Z',
    studentVisible: true,
  },
]

