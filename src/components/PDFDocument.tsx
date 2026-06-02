/*
 * components/PDFDocument.tsx
 *
 * @react-pdf/renderer component tree that produces binary PDF output when
 * consumed by /api/pdf (server-side renderToBuffer). NOT a browser component —
 * it renders to a PDF byte stream, not to the DOM.
 *
 * Exported: JobPDFDocument — the top-level entry point for the /api/pdf route.
 * Supports DocType 'quote', 'sow', 'report', and 'iaq_multi' (3-part bundle).
 *
 * Architecture:
 *   - QuotePDF: renders the line-items pricing table and GST totals.
 *   - SOWOrReportPDF: renders text sections from the content object. Section
 *     keys differ between sow and report so each has its own key array.
 *   - Header/Footer: shared across all document types. Header uses company logo
 *     if available; falls back to company name text. Footer shows page numbers
 *     via @react-pdf's render prop (evaluated at PDF render time, not React time).
 *   - PhotoSection: 2-up grid of photos. Photos must be pre-fetched as base64
 *     dataUrl (PhotoWithData) because @react-pdf can't load URLs behind auth.
 *     The /api/image-proxy route handles CORS-blocked Supabase Storage URLs.
 *
 * All monetary values use en-AU locale formatting for Australian dollar display.
 * Photos are capped at 6 per section to keep file size manageable.
 */
import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer'
import type {
  DocType,
  QuoteContent,
  SOWContent,
  ReportContent,
  AssessmentDocumentContent,
  CompanyProfile,
  PhotoWithData,
  Area,
  PathophysiologyRow,
  PostRemediationEvaluationContent,
  PreScopeLineResolved,
} from '@/lib/types'
import { filterGroupedStages, groupPhotosByRoomAndStage } from '@/lib/photoGroups'
import { photosForComposedReports } from '@/lib/photosForComposedReports'
import { effectiveAreaDimensions } from '@/lib/areaSubzones'

const ORANGE = '#FF6B35'
const BLACK = '#111111'
const MUTED = '#666666'
const BORDER = '#E5E5E5'
const BG_LIGHT = '#F9F9F9'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: BLACK,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 50,
    lineHeight: 1.5,
  },
  partSubtitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 1, color: MUTED, marginBottom: 14, textTransform: 'uppercase' },
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  companyLogo: { width: 100, height: 40, objectFit: 'contain' },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: BLACK },
  companyTagline: { fontSize: 8, color: MUTED, marginTop: 2 },
  companyContact: { fontSize: 7, color: MUTED, marginTop: 3 },
  headerRight: { alignItems: 'flex-end' },
  refText: { fontSize: 9, color: MUTED },
  dateText: { fontSize: 9, color: MUTED, marginTop: 2 },
  // Orange rule
  rule: { height: 2, backgroundColor: ORANGE, marginBottom: 24 },
  // Title
  docTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: BLACK, marginBottom: 20 },
  // Sections
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase', color: ORANGE, marginBottom: 6 },
  body: { fontSize: 10, color: BLACK, lineHeight: 1.6 },
  // Line items table
  table: { marginTop: 12, marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: BLACK, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3 },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  tableRowAlt: { backgroundColor: BG_LIGHT },
  colDesc: { flex: 3 },
  colQty: { flex: 0.7, textAlign: 'right' },
  colUnit: { flex: 0.7, textAlign: 'center' },
  colRate: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1, textAlign: 'right' },
  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  tdText: { fontSize: 9, color: BLACK },
  // Totals
  totalsBlock: { marginTop: 4, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', gap: 20, marginBottom: 4 },
  totalLabel: { fontSize: 9, color: MUTED, width: 80, textAlign: 'right' },
  totalValue: { fontSize: 9, color: BLACK, width: 70, textAlign: 'right' },
  grandTotalLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BLACK, width: 80, textAlign: 'right' },
  grandTotalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: ORANGE, width: 70, textAlign: 'right' },
  // Photos section
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  photoItem: { width: '47%', marginBottom: 10 },
  photoItemFull: { width: '100%', marginBottom: 10 },
  photoImage: { width: '100%', height: 120, objectFit: 'cover', borderRadius: 4, borderWidth: 1, borderColor: '#E5E5E5' },
  photoImageFull: { width: '100%', objectFit: 'contain', borderRadius: 4, borderWidth: 1, borderColor: '#E5E5E5' },
  photoAreaBadge: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: ORANGE, textTransform: 'uppercase', marginTop: 4, marginBottom: 2 },
  photoNote: { fontSize: 8, color: MUTED, lineHeight: 1.4 },
  photoNoNote: { fontSize: 8, color: '#BBBBBB', fontStyle: 'italic' },
  roomBlock: { marginBottom: 12, padding: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 6, backgroundColor: '#fcfcfc' },
  roomHeading: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BLACK, marginBottom: 4 },
  roomNote: { fontSize: 8, color: MUTED, marginBottom: 6 },
  // Accept block
  acceptBlock: { marginTop: 24, padding: 16, backgroundColor: '#FFF5F1', borderRadius: 6, borderWidth: 1, borderColor: '#FFD4C2' },
  acceptLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase', color: ORANGE, marginBottom: 6 },
  acceptBody: { fontSize: 10, color: BLACK, marginBottom: 10 },
  acceptBtn: { backgroundColor: ORANGE, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'flex-start' },
  acceptBtnText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  acceptUrlText: { fontSize: 8, color: MUTED, marginTop: 6 },
  // Footer
  footer: {
    position: 'absolute', bottom: 20, left: 50, right: 50,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8,
  },
  footerText: { fontSize: 7, color: MUTED },
  footerBrand: { fontSize: 7, color: ORANGE },
  // Areas & Dimensions table (shared between Assessment Document + SOW)
  dimsTable: { marginTop: 4, marginBottom: 16 },
  dimsHeaderRow: { flexDirection: 'row', backgroundColor: BLACK, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 3 },
  dimsRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER },
  dimsTotalRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderTopWidth: 1.5, borderTopColor: BLACK },
  dimsTh: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  dimsTd: { fontSize: 8, color: BLACK },
  dimsTdBold: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BLACK },
  dimsColRoom: { flex: 1.4 },
  dimsColDims: { flex: 1.3 },
  dimsColNum: { flex: 0.9, textAlign: 'right' },
  // Pathophysiology table (Assessment Document only)
  pathoTable: { marginTop: 4, marginBottom: 16 },
  pathoHeaderRow: { flexDirection: 'row', backgroundColor: BLACK, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 3 },
  pathoRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER },
  pathoTh: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  pathoTd: { fontSize: 8, color: BLACK },
  pathoTdBold: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BLACK },
  pathoColDisease: { flex: 1.4, paddingRight: 4 },
  pathoColTrans: { flex: 1.4, paddingRight: 4 },
  pathoColEffects: { flex: 2.3, paddingRight: 4 },
  pathoColIncub: { flex: 0.9, paddingRight: 4 },
  pathoColPpe: { flex: 1.6 },
  pathoMuted: { fontSize: 8, color: '#9ca3af' },
  pathoPathogen: { fontSize: 7, color: MUTED, marginTop: 1 },
})

/** TipTap / rich HTML → plain text for PDF (`Text` has no HTML). */
function plainTextForPdf(raw: string | undefined | null): string {
  const s = String(raw ?? '')
  if (!s.trim()) return ''
  if (!/<[a-z]/i.test(s)) return s
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/li>\s*/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface HeaderProps {
  reference: string
  date: string
  company: CompanyProfile | null
}

function Header({ reference, date, company }: HeaderProps) {
  const name = company?.name || 'Brisbane Biohazard Cleaning'
  const tagline = company?.tagline || 'Professional services'
  const contact = [company?.phone, company?.email, company?.abn ? `ABN: ${company.abn}` : ''].filter(Boolean).join('  ·  ')

  return (
    <>
      <View style={styles.header}>
        <View>
          {company?.logo_url ? (
            <Image src={company.logo_url} style={styles.companyLogo} />
          ) : (
            <>
              <Text style={styles.companyName}>{name}</Text>
              <Text style={styles.companyTagline}>{tagline}</Text>
            </>
          )}
          {contact ? <Text style={styles.companyContact}>{contact}</Text> : null}
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.refText}>{reference}</Text>
          <Text style={styles.dateText}>{date}</Text>
          {company?.licence ? <Text style={styles.dateText}>Lic: {company.licence}</Text> : null}
        </View>
      </View>
      <View style={styles.rule} />
    </>
  )
}

function Footer({ company }: { company: CompanyProfile | null }) {
  const name = company?.name || 'Brisbane Biohazard Cleaning'
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{name} — biohazards.net</Text>
      <Text style={styles.footerBrand} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

function Section({ label, text }: { label: string; text: string }) {
  const plain = plainTextForPdf(text)
  if (!plain.trim()) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.body}>{plain}</Text>
    </View>
  )
}

/**
 * Areas & Dimensions table for the PDF. Mirrors the HTML helper
 * `buildAreasDimensionsHTML` in `src/lib/printDocument.ts` — same source of
 * truth (effectiveAreaDimensions), same column set, same multi-zone nesting.
 * Suppressed entirely when no area has dimensions captured. Used in both
 * IaqMulti Part 1 (Assessment) and Part 2 (SOW), and in the standalone SOW PDF.
 */
function AreasDimensionsPDFSection({ areas, label = 'Areas & Dimensions' }: { areas: Area[]; label?: string }) {
  const all = (areas ?? [])
    .filter(a => (a.name || '').trim().length > 0)
    .map(area => ({ area, dims: effectiveAreaDimensions(area) }))
  const printable = all.filter(b => b.dims.hasDims)
  if (printable.length === 0) return null

  const fmt = (n: number) => Number(n || 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })
  const dimsLabel = (L: number | null, W: number | null, H: number | null) =>
    L && W && L > 0 && W > 0 ? `${L}×${W}${H && H > 0 ? `×${H}` : ''} m` : '—'

  const totals = printable.reduce(
    (acc, b) => ({
      floor: acc.floor + b.dims.floor,
      ceiling: acc.ceiling + b.dims.ceiling,
      walls: acc.walls + b.dims.walls,
      totalSurface: acc.totalSurface + b.dims.totalSurface,
      volume: acc.volume + b.dims.volume,
    }),
    { floor: 0, ceiling: 0, walls: 0, totalSurface: 0, volume: 0 },
  )

  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.dimsTable}>
        <View style={styles.dimsHeaderRow}>
          <Text style={[styles.dimsTh, styles.dimsColRoom]}>Room</Text>
          <Text style={[styles.dimsTh, styles.dimsColDims]}>Dims (L×W×H)</Text>
          <Text style={[styles.dimsTh, styles.dimsColNum]}>Floor</Text>
          <Text style={[styles.dimsTh, styles.dimsColNum]}>Ceiling</Text>
          <Text style={[styles.dimsTh, styles.dimsColNum]}>Walls</Text>
          <Text style={[styles.dimsTh, styles.dimsColNum]}>Total m²</Text>
          <Text style={[styles.dimsTh, styles.dimsColNum]}>Volume</Text>
        </View>
        {(() => {
          const rendered: React.ReactElement[] = []
          all.forEach((b, i) => {
            const dims = b.dims
            if (!dims.hasDims) {
              rendered.push(
                <View key={`area-${i}`} style={styles.dimsRow}>
                  <Text style={[styles.dimsTd, styles.dimsColRoom]}>{b.area.name}</Text>
                  <Text style={[styles.dimsTd, styles.dimsColDims]}>—</Text>
                  <Text style={[styles.dimsTd, styles.dimsColNum]}>—</Text>
                  <Text style={[styles.dimsTd, styles.dimsColNum]}>—</Text>
                  <Text style={[styles.dimsTd, styles.dimsColNum]}>—</Text>
                  <Text style={[styles.dimsTd, styles.dimsColNum]}>—</Text>
                  <Text style={[styles.dimsTd, styles.dimsColNum]}>—</Text>
                </View>,
              )
              return
            }
            const parentDims = dims.isMultiZone
              ? `${dims.subzones.length} rooms`
              : dimsLabel(dims.length, dims.width, dims.height)
            rendered.push(
              <View key={`area-${i}`} style={styles.dimsRow}>
                <Text style={[styles.dimsTdBold, styles.dimsColRoom]}>{b.area.name}</Text>
                <Text style={[styles.dimsTd, styles.dimsColDims]}>{parentDims}</Text>
                <Text style={[styles.dimsTd, styles.dimsColNum]}>{`${fmt(dims.floor)} m²`}</Text>
                <Text style={[styles.dimsTd, styles.dimsColNum]}>{dims.ceiling > 0 ? `${fmt(dims.ceiling)} m²` : '—'}</Text>
                <Text style={[styles.dimsTd, styles.dimsColNum]}>{dims.walls > 0 ? `${fmt(dims.walls)} m²` : '—'}</Text>
                <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{`${fmt(dims.totalSurface)} m²`}</Text>
                <Text style={[styles.dimsTd, styles.dimsColNum]}>{dims.volume > 0 ? `${fmt(dims.volume)} m³` : '—'}</Text>
              </View>,
            )
            if (dims.isMultiZone) {
              dims.subzones.forEach((sz, j) => {
                const szDims = dimsLabel(
                  sz.length_m > 0 ? sz.length_m : null,
                  sz.width_m > 0 ? sz.width_m : null,
                  sz.height_m > 0 ? sz.height_m : null,
                )
                const muted = { color: '#666' }
                rendered.push(
                  <View key={`sub-${i}-${j}`} style={styles.dimsRow}>
                    <Text style={[styles.dimsTd, styles.dimsColRoom, muted, { paddingLeft: 14 }]}>{`↳ ${sz.name}`}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColDims, muted]}>{szDims}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColNum, muted]}>{sz.floor > 0 ? `${fmt(sz.floor)} m²` : '—'}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColNum, muted]}>{sz.ceiling > 0 ? `${fmt(sz.ceiling)} m²` : '—'}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColNum, muted]}>{sz.walls > 0 ? `${fmt(sz.walls)} m²` : '—'}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColNum, muted]}>{sz.totalSurface > 0 ? `${fmt(sz.totalSurface)} m²` : '—'}</Text>
                    <Text style={[styles.dimsTd, styles.dimsColNum, muted]}>{sz.volume > 0 ? `${fmt(sz.volume)} m³` : '—'}</Text>
                  </View>,
                )
              })
            }
          })
          return rendered
        })()}
        {printable.length > 1 && (
          <View style={styles.dimsTotalRow}>
            <Text style={[styles.dimsTdBold, styles.dimsColRoom]}>Total</Text>
            <Text style={[styles.dimsTd, styles.dimsColDims]}> </Text>
            <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{`${fmt(totals.floor)} m²`}</Text>
            <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{totals.ceiling > 0 ? `${fmt(totals.ceiling)} m²` : '—'}</Text>
            <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{totals.walls > 0 ? `${fmt(totals.walls)} m²` : '—'}</Text>
            <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{`${fmt(totals.totalSurface)} m²`}</Text>
            <Text style={[styles.dimsTdBold, styles.dimsColNum]}>{totals.volume > 0 ? `${fmt(totals.volume)} m³` : '—'}</Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 7, fontStyle: 'italic', color: '#666', marginTop: 4 }}>
        Note: dimensions are nominal — captured by hand on site and typically accurate to within ±5%.
        Openings, wall thickness, and irregular ceiling heights are not individually itemised.
      </Text>
    </View>
  )
}

/**
 * "This is a fixed-price quote" banner for the PDF. Companion to
 * EstimateBannerPDF — same position, confident blue palette so the client
 * reads "this is the final number" at a glance.
 */
function FixedPriceBannerPDF() {
  return (
    <View
      style={{
        marginTop: 6,
        marginBottom: 14,
        padding: 10,
        borderLeftWidth: 3,
        borderLeftColor: '#1d4ed8',
        borderTopWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        borderRadius: 4,
      }}
      wrap={false}
    >
      <Text
        style={{
          fontFamily: 'Helvetica-Bold',
          fontSize: 8,
          color: '#1e40af',
          letterSpacing: 0.5,
          marginBottom: 3,
        }}
      >
        THIS IS A FIXED-PRICE QUOTE
      </Text>
      <Text style={{ ...styles.body, color: '#1e3a8a' }}>
        The total below is the agreed fixed price for the scope of works described. It is not
        subject to variation unless the scope itself changes in writing. See Payment Terms below
        for deposit and balance details.
      </Text>
    </View>
  )
}

/**
 * "This is an Estimate, not a fixed-price quote" banner for the PDF. Mirrors
 * the amber banner in the HTML print (`quote-estimate-banner`) — appears at
 * the top of the quote body whenever the rendered pricing includes the
 * user's estimate-flagged per-m³ section.
 */
function EstimateBannerPDF() {
  return (
    <View
      style={{
        marginTop: 6,
        marginBottom: 14,
        padding: 10,
        borderLeftWidth: 3,
        borderLeftColor: '#d97706',
        borderTopWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#fcd34d',
        backgroundColor: '#fffbeb',
        borderRadius: 4,
      }}
      wrap={false}
    >
      <Text
        style={{
          fontFamily: 'Helvetica-Bold',
          fontSize: 8,
          color: '#92400e',
          letterSpacing: 0.5,
          marginBottom: 3,
        }}
      >
        THIS IS AN ESTIMATE — NOT A FIXED-PRICE QUOTE
      </Text>
      <Text style={{ ...styles.body, color: '#7c2d12' }}>
        Pricing reflects estimated volumes / quantities at the rates shown. Final amounts
        are reconciled at completion against actual measured volumes and weighbridge / disposal
        receipts; variance is billed or credited at the same rates. See Payment Terms below for
        deposit and balance details.
      </Text>
    </View>
  )
}

/**
 * Highlighted Payment Terms call-out for the PDF quote. Mirrors the emerald
 * box in the HTML print (`quote-payment-callout`) so the most commonly
 * disputed contractual clause (deposit %, balance, reconciliation) stands out
 * to the client in either render path.
 */
function PaymentTermsCalloutPDF({ text }: { text: string }) {
  const plain = plainTextForPdf(text)
  if (!plain.trim()) return null
  return (
    <View
      style={{
        marginTop: 14,
        marginBottom: 8,
        padding: 12,
        borderLeftWidth: 3,
        borderLeftColor: '#059669',
        borderTopWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#a7f3d0',
        backgroundColor: '#ecfdf5',
        borderRadius: 4,
      }}
      wrap={false}
    >
      <Text
        style={{
          fontFamily: 'Helvetica-Bold',
          fontSize: 9,
          color: '#065f46',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        PAYMENT TERMS
      </Text>
      <Text style={{ ...styles.body, color: '#064e3b' }}>{plain}</Text>
    </View>
  )
}

/**
 * Highlighted Recommendations call-out for the PDF — mirrors the blue box in
 * the HTML print so the section stands out as the most action-bearing part of
 * the Assessment Document. Suppressed when the field flattens to nothing.
 */
function RecommendationsCalloutPDF({ text }: { text: string }) {
  const plain = plainTextForPdf(text)
  if (!plain.trim()) return null
  return (
    <View
      style={{
        marginTop: 12,
        padding: 10,
        borderLeftWidth: 3,
        borderLeftColor: '#2563eb',
        borderTopWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#93c5fd',
        backgroundColor: '#eff6ff',
        borderRadius: 4,
      }}
      wrap={false}
    >
      <Text
        style={{
          fontFamily: 'Helvetica-Bold',
          fontSize: 9,
          color: '#1d4ed8',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        RECOMMENDATIONS
      </Text>
      <Text style={{ ...styles.body, fontFamily: 'Helvetica-Bold', color: '#0f172a' }}>{plain}</Text>
    </View>
  )
}

/**
 * Pathophysiology table — disease reference rows from the per-job pathogen
 * library. Mirrors `buildPathophysiologyTableHTML` in printDocument.ts so the
 * HTML preview and PDF output stay in lockstep. Suppressed when empty.
 */
function PathophysiologyPDFSection({
  rows,
  label = 'Pathophysiology — health effects of identified pathogens',
}: {
  rows: PathophysiologyRow[] | undefined
  label?: string
}) {
  const printable = (rows ?? []).filter(r => (r.disease || '').trim().length > 0)
  if (printable.length === 0) return null
  const cell = (s: string | undefined) => (s && s.trim() ? s.trim() : null)
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={[styles.body, { marginBottom: 8 }]}>
        This table catalogues the disease-causing organisms reasonably expected at this site — how they
        transmit, the human health effects of exposure, typical incubation periods, and the personal
        protective equipment required to work around them safely. The hazards, risks, control measures,
        and PPE selections elsewhere in this assessment are grounded in the references below.
      </Text>
      <View style={styles.pathoTable}>
        <View style={styles.pathoHeaderRow}>
          <Text style={[styles.pathoTh, styles.pathoColDisease]}>Disease / pathogen</Text>
          <Text style={[styles.pathoTh, styles.pathoColTrans]}>Transmission</Text>
          <Text style={[styles.pathoTh, styles.pathoColEffects]}>Effects on humans</Text>
          <Text style={[styles.pathoTh, styles.pathoColIncub]}>Incubation</Text>
          <Text style={[styles.pathoTh, styles.pathoColPpe]}>PPE</Text>
        </View>
        {printable.map((r, i) => {
          const trans = cell(r.transmission)
          const effects = cell(r.effects)
          const incub = cell(r.incubation)
          const ppe = cell(r.ppe)
          return (
            <View key={i} style={styles.pathoRow} wrap={false}>
              <View style={styles.pathoColDisease}>
                <Text style={styles.pathoTdBold}>{r.disease}</Text>
                {r.pathogen ? <Text style={styles.pathoPathogen}>{r.pathogen}</Text> : null}
              </View>
              <Text style={[styles.pathoTd, styles.pathoColTrans, !trans ? styles.pathoMuted : {}]}>{trans ?? '—'}</Text>
              <Text style={[styles.pathoTd, styles.pathoColEffects, !effects ? styles.pathoMuted : {}]}>{effects ?? '—'}</Text>
              <Text style={[styles.pathoTd, styles.pathoColIncub, !incub ? styles.pathoMuted : {}]}>{incub ?? '—'}</Text>
              <Text style={[styles.pathoTd, styles.pathoColPpe, !ppe ? styles.pathoMuted : {}]}>{ppe ?? '—'}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function PhotoSection({
  photos,
  label,
  showAppMetadata = true,
  singleColumn = false,
}: {
  photos: PhotoWithData[]
  label: string
  showAppMetadata?: boolean
  singleColumn?: boolean
}) {
  if (photos.length === 0) return null
  return (
    <View style={styles.section} break={photos.length > 4}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.photoGrid}>
        {photos.map((p, i) => (
          <View key={i} style={singleColumn ? styles.photoItemFull : styles.photoItem}>
            {(p.dataUrl || p.file_url) ? (
              <Image
                src={p.dataUrl || p.file_url}
                style={singleColumn ? styles.photoImageFull : styles.photoImage}
              />
            ) : null}
            {showAppMetadata && p.area_ref ? <Text style={styles.photoAreaBadge}>{p.area_ref}</Text> : null}
            {p.caption
              ? <Text style={styles.photoNote}>{p.caption}</Text>
              : showAppMetadata ? <Text style={styles.photoNoNote}>No note</Text> : null
            }
          </View>
        ))}
      </View>
    </View>
  )
}

function RoomStageSection({
  photos, areas = [], label, stages, showAppMetadata = true, singleColumn = false,
}: {
  photos: PhotoWithData[]
  areas?: Area[]
  label: string
  stages: Array<'assessment' | 'before' | 'during' | 'after'>
  showAppMetadata?: boolean
  singleColumn?: boolean
}) {
  const grouped = filterGroupedStages(groupPhotosByRoomAndStage(photos, areas), stages)
  if (!grouped.length) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {grouped.map(group => (
        <View key={group.room} style={styles.roomBlock}>
          <Text style={styles.roomHeading}>{group.room}</Text>
          {group.note ? <Text style={styles.roomNote}>Room note: {group.note}</Text> : null}
          {showAppMetadata ? stages.map(stage => (
            group.stages[stage].length > 0 ? (
              <PhotoSection
                key={`${group.room}-${stage}`}
                photos={group.stages[stage].slice(0, 6)}
                label={`${stage.charAt(0).toUpperCase() + stage.slice(1)} (${group.stages[stage].length})`}
                showAppMetadata={showAppMetadata}
                singleColumn={singleColumn}
              />
            ) : null
          )) : (
            <PhotoSection
              photos={stages.flatMap(stage => group.stages[stage]).slice(0, 6)}
              label="Photos"
              showAppMetadata={false}
              singleColumn={singleColumn}
            />
          )}
        </View>
      ))}
    </View>
  )
}

function QuotePDF({
  content,
  photos,
  company,
  areas = [],
  siteAddress,
}: {
  content: QuoteContent
  photos: PhotoWithData[]
  company: CompanyProfile | null
  areas?: Area[]
  siteAddress?: string
}) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const beforePhotos = photos.filter(p => p.category === 'before' || p.category === 'assessment').slice(0, 6)
  const site = (siteAddress ?? '').trim()
  const gstMode = content.gst_mode ?? (content.gst > 0 ? 'exclusive' : 'no_gst')
  const subtotalLabel = gstMode === 'inclusive' || gstMode === 'exclusive' ? 'Subtotal (ex GST)' : 'Subtotal'
  const gstLabel = gstMode === 'inclusive' ? 'Includes GST (10%)' : 'GST (10%)'
  const totalLabel = gstMode === 'no_gst' ? 'TOTAL (NO GST)' : 'TOTAL (INC GST)'

  return (
    <Page size="A4" style={styles.page}>
      <Header reference={content.reference} date={today} company={company} />
      <Text style={styles.docTitle}>{content.title}</Text>
      {site ? <Section label="Site address" text={site} /> : null}
      {content.is_estimate ? <EstimateBannerPDF /> : <FixedPriceBannerPDF />}
      <Section label="Overview" text={content.intro} />

      <Text style={styles.sectionLabel}>Scope & Pricing</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.thText, styles.colDesc]}>Description</Text>
          <Text style={[styles.thText, styles.colQty]}>Qty</Text>
          <Text style={[styles.thText, styles.colUnit]}>Unit</Text>
          <Text style={[styles.thText, styles.colRate]}>Rate</Text>
          <Text style={[styles.thText, styles.colTotal]}>Total</Text>
        </View>
        {(content.line_items ?? []).map((item, i) => (
          <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
            <Text style={[styles.tdText, styles.colDesc]}>{item.description}</Text>
            <Text style={[styles.tdText, styles.colQty]}>{item.qty}</Text>
            <Text style={[styles.tdText, styles.colUnit]}>{item.unit}</Text>
            <Text style={[styles.tdText, styles.colRate]}>{fmt(item.rate)}</Text>
            <Text style={[styles.tdText, styles.colTotal]}>{fmt(item.total)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totalsBlock}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{subtotalLabel}</Text>
          <Text style={styles.totalValue}>{fmt(content.subtotal)}</Text>
        </View>
        {content.gst > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{gstLabel}</Text>
            <Text style={styles.totalValue}>{fmt(content.gst)}</Text>
          </View>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.grandTotalLabel}>{totalLabel}</Text>
          <Text style={styles.grandTotalValue}>{fmt(content.total)}</Text>
        </View>
      </View>

      {content.notes && <View style={{ marginTop: 20 }}><Section label="Notes & Conditions" text={content.notes} /></View>}
      <PaymentTermsCalloutPDF text={content.payment_terms} />
      <Section label="Quote Validity" text={content.validity} />

      {/* Before photos as evidence */}
      {beforePhotos.length > 0 && (
        <RoomStageSection photos={beforePhotos} areas={areas} label="Site Condition Photos" stages={['assessment', 'before']} />
      )}

      <Footer company={company} />
    </Page>
  )
}

/** Recommendations is rendered separately at the end of Part 1 as a callout —
 *  see RecommendationsCalloutPDF — so it's intentionally omitted from this loop. */
const ASSESSMENT_PDF_SECTIONS: Array<{ key: keyof AssessmentDocumentContent; label: string }> = [
  { key: 'site_summary', label: 'Site summary' },
  { key: 'hazards_overview', label: 'Hazards overview' },
  { key: 'risks_overview', label: 'Risks overview' },
  { key: 'control_measures', label: 'Control measures' },
  { key: 'limitations', label: 'Limitations' },
]

/** Assessment / Scope / Quote — three wrapped pages (server PDF alternative to HTML print). */
function IaqMultiPDF({
  bundle,
  photos,
  company,
  areas = [],
  siteAddress,
}: {
  bundle: { reference?: string; title?: string; parts?: Array<{ type: DocType; content: Record<string, unknown> }> }
  photos: PhotoWithData[]
  company: CompanyProfile | null
  areas?: Area[]
  siteAddress?: string
}) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  const parts = bundle.parts ?? []
  const ad = (parts[0]?.content ?? {}) as unknown as AssessmentDocumentContent
  const sow = (parts[1]?.content ?? {}) as unknown as SOWContent
  const quote = (parts[2]?.content ?? {}) as unknown as QuoteContent
  const bundleRef = String(bundle.reference ?? ad.reference ?? '—').trim()
  const bundleTitle = String(bundle.title ?? 'Assessment / Scope / Quote').trim()

  const beforePhotos = photos.filter(p => p.category === 'before' || p.category === 'assessment')
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const gstMode = quote.gst_mode ?? (quote.gst > 0 ? 'exclusive' : 'no_gst')
  const subtotalLabel = gstMode === 'inclusive' || gstMode === 'exclusive' ? 'Subtotal (ex GST)' : 'Subtotal'
  const gstLabel = gstMode === 'inclusive' ? 'Includes GST (10%)' : 'GST (10%)'
  const totalLabel = gstMode === 'no_gst' ? 'TOTAL (NO GST)' : 'TOTAL (INC GST)'

  const sowPdfSections: Array<{ key: keyof SOWContent; label: string }> = [
    { key: 'executive_summary', label: 'Executive Summary' },
    { key: 'scope', label: 'Scope of Work' },
    { key: 'methodology', label: 'Methodology' },
    { key: 'safety_protocols', label: 'Safety Protocols & PPE' },
    { key: 'waste_disposal', label: 'Waste Disposal' },
    { key: 'timeline', label: 'Estimated Timeline' },
    { key: 'exclusions', label: 'Exclusions' },
    { key: 'disclaimer', label: 'Disclaimer' },
  ]

  return (
    <>
      <Page size="A4" style={styles.page} wrap>
        <Header reference={bundleRef} date={today} company={company} />
        <Text style={styles.docTitle}>{bundleTitle}</Text>
        <Text style={styles.partSubtitle}>Part 1 of 3 — Assessment</Text>
        {ASSESSMENT_PDF_SECTIONS.map(({ key, label }) => (
          <React.Fragment key={String(key)}>
            <Section label={label} text={(ad as unknown as Record<string, string>)[key] ?? ''} />
            {key === 'site_summary' && (
              <>
                <AreasDimensionsPDFSection areas={areas} />
                <PathophysiologyPDFSection rows={ad.pathophysiology_table} />
              </>
            )}
          </React.Fragment>
        ))}
        <RecommendationsCalloutPDF text={ad.recommendations ?? ''} />
        <Footer company={company} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Header reference={bundleRef} date={today} company={company} />
        <Text style={styles.docTitle}>{bundleTitle}</Text>
        <Text style={styles.partSubtitle}>Part 2 of 3 — Scope of Work</Text>
        {sowPdfSections.map(({ key, label }) => {
          const text = (sow as unknown as Record<string, string>)[key]
          // Render the dimensions table at the executive_summary slot regardless
          // of whether the summary itself has text, so the table still appears
          // when staff skip writing an executive summary.
          if (key === 'executive_summary') {
            return (
              <React.Fragment key={String(key)}>
                {text ? <Section label={label} text={text} /> : null}
                <AreasDimensionsPDFSection areas={areas} />
              </React.Fragment>
            )
          }
          if (!text) return null
          return <Section key={String(key)} label={label} text={text} />
        })}
        {beforePhotos.length > 0 && sow.include_photos !== false && (
          <RoomStageSection photos={beforePhotos} areas={areas} label="Site Condition Photos — Evidence of Scope" stages={['assessment', 'before']} />
        )}
        <Footer company={company} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Header reference={bundleRef} date={today} company={company} />
        <Text style={styles.docTitle}>{bundleTitle}</Text>
        <Text style={styles.partSubtitle}>Part 3 of 3 — Quote/Estimate</Text>
        {(siteAddress ?? '').trim() ? <Section label="Site address" text={(siteAddress ?? '').trim()} /> : null}
        {quote.is_estimate ? <EstimateBannerPDF /> : <FixedPriceBannerPDF />}
        <Section label="Overview" text={quote.intro} />

        <Text style={styles.sectionLabel}>Scope & Pricing</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.colDesc]}>Description</Text>
            <Text style={[styles.thText, styles.colQty]}>Qty</Text>
            <Text style={[styles.thText, styles.colUnit]}>Unit</Text>
            <Text style={[styles.thText, styles.colRate]}>Rate</Text>
            <Text style={[styles.thText, styles.colTotal]}>Total</Text>
          </View>
          {(quote.line_items ?? []).map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={[styles.tdText, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.tdText, styles.colQty]}>{item.qty}</Text>
              <Text style={[styles.tdText, styles.colUnit]}>{item.unit}</Text>
              <Text style={[styles.tdText, styles.colRate]}>{fmt(item.rate)}</Text>
              <Text style={[styles.tdText, styles.colTotal]}>{fmt(item.total)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{subtotalLabel}</Text>
            <Text style={styles.totalValue}>{fmt(quote.subtotal)}</Text>
          </View>
          {quote.gst > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{gstLabel}</Text>
              <Text style={styles.totalValue}>{fmt(quote.gst)}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.grandTotalLabel}>{totalLabel}</Text>
            <Text style={styles.grandTotalValue}>{fmt(quote.total)}</Text>
          </View>
        </View>

        {quote.notes ? <View style={{ marginTop: 20 }}><Section label="Notes & Conditions" text={quote.notes} /></View> : null}
        <PaymentTermsCalloutPDF text={quote.payment_terms} />
        <Section label="Quote Validity" text={quote.validity} />

        {beforePhotos.length > 0 && quote.include_photos !== false && (
          <RoomStageSection photos={beforePhotos} areas={areas} label="Site Condition Photos" stages={['assessment', 'before']} />
        )}

        <Footer company={company} />
      </Page>
    </>
  )
}

function SOWOrReportPDF({
  content, type, photos, company,
  areas = [],
}: {
  content: SOWContent | ReportContent
  type: DocType
  photos: PhotoWithData[]
  company: CompanyProfile | null
  areas?: Area[]
}) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })

  const beforePhotos = photos.filter(p => p.category === 'before' || p.category === 'assessment').slice(0, 6)
  const afterPhotos = photos.filter(p => p.category === 'after').slice(0, 6)

  const sowSections: Array<{ key: keyof SOWContent; label: string }> = [
    { key: 'executive_summary', label: 'Executive Summary' },
    { key: 'scope', label: 'Scope of Work' },
    { key: 'methodology', label: 'Methodology' },
    { key: 'safety_protocols', label: 'Safety Protocols & PPE' },
    { key: 'waste_disposal', label: 'Waste Disposal' },
    { key: 'timeline', label: 'Estimated Timeline' },
    { key: 'exclusions', label: 'Exclusions' },
    { key: 'disclaimer', label: 'Disclaimer' },
  ]

  const reportSections: Array<{ key: keyof ReportContent; label: string }> = [
    { key: 'executive_summary', label: 'Executive Summary' },
    { key: 'site_conditions', label: 'Site Conditions on Arrival' },
    { key: 'works_carried_out', label: 'Works Carried Out' },
    { key: 'methodology', label: 'Methodology' },
    { key: 'products_used', label: 'Products & Equipment Used' },
    { key: 'waste_disposal', label: 'Waste Disposal' },
    { key: 'photo_record', label: 'Photo Record' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'technician_signoff', label: 'Technician Sign-Off' },
  ]

  const sections = type === 'sow' ? sowSections : reportSections

  return (
    <Page size="A4" style={styles.page}>
      <Header reference={(content as SOWContent).reference} date={today} company={company} />
      <Text style={styles.docTitle}>{(content as SOWContent).title}</Text>

      {sections.map(({ key, label }) => {
        const text = (content as unknown as Record<string, string>)[key]
        if (type === 'sow' && key === 'executive_summary') {
          return (
            <React.Fragment key={String(key)}>
              {text ? <Section label={label} text={text} /> : null}
              <AreasDimensionsPDFSection areas={areas} />
            </React.Fragment>
          )
        }
        if (!text) return null
        return <Section key={key} label={label} text={text} />
      })}

      {/* SOW: show before photos as evidence of scope */}
      {type === 'sow' && beforePhotos.length > 0 && (
        <RoomStageSection photos={beforePhotos} areas={areas} label="Site Condition Photos — Evidence of Scope" stages={['assessment', 'before']} />
      )}

      {/* Report: before + after photos */}
      {type === 'report' && beforePhotos.length > 0 && (
        <RoomStageSection
          photos={beforePhotos}
          areas={areas}
          label="Before — Site Conditions on Arrival"
          stages={['assessment', 'before']}
          showAppMetadata={false}
          singleColumn
        />
      )}
      {type === 'report' && afterPhotos.length > 0 && (
        <RoomStageSection
          photos={afterPhotos}
          areas={areas}
          label="After — Completed Works"
          stages={['during', 'after']}
          showAppMetadata={false}
          singleColumn
        />
      )}

      <Footer company={company} />
    </Page>
  )
}

const PRE_BADGE: Record<'as_done' | 'varied' | 'not_done', { label: string; color: string }> = {
  as_done: { label: 'AS DONE', color: '#047857' },
  varied: { label: 'VARIED', color: '#b45309' },
  not_done: { label: 'NOT DONE', color: '#475569' },
}

/** Post Remediation Evaluation — non-financial completion evaluation against a quote. */
function PrePDF({
  content,
  photos,
  company,
}: {
  content: PostRemediationEvaluationContent
  photos: PhotoWithData[]
  company: CompanyProfile | null
}) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  const byId = new Map(photos.map(p => [p.id, p]))
  const resolve = (ids?: string[]) => (ids ?? []).map(id => byId.get(id)).filter((p): p is PhotoWithData => !!p)

  const fromQuote = content.scope_lines.filter(
    (l): l is Extract<PreScopeLineResolved, { kind: 'from_quote' }> => l.kind === 'from_quote',
  )
  const added = content.scope_lines.filter(
    (l): l is Extract<PreScopeLineResolved, { kind: 'added' }> => l.kind === 'added',
  )

  const sectionOrder: string[] = []
  const bySection = new Map<string, typeof fromQuote>()
  for (const l of fromQuote) {
    const key = l.section_label || 'Scope'
    if (!bySection.has(key)) {
      bySection.set(key, [])
      sectionOrder.push(key)
    }
    bySection.get(key)!.push(l)
  }

  const sourceLine = [content.source_quote_label, content.source_quote_reference].filter(Boolean).join(' · ')

  return (
    <Page size="A4" style={styles.page}>
      <Header reference={content.reference} date={today} company={company} />
      <Text style={styles.docTitle}>{content.title}</Text>
      {sourceLine ? <Text style={[styles.body, { color: MUTED, marginTop: -12, marginBottom: 16 }]}>Reporting against: {sourceLine}</Text> : null}

      {content.opening_html ? <Section label="Overview" text={content.opening_html} /> : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Scope — as done</Text>
        {sectionOrder.map(sec => (
          <View key={sec} style={{ marginBottom: 8 }}>
            <Text style={[styles.body, { fontFamily: 'Helvetica-Bold', marginBottom: 4 }]}>{sec}</Text>
            {bySection.get(sec)!.map((l, i) => {
              const badge = PRE_BADGE[l.status]
              const linePhotos = resolve(l.photo_ids)
              return (
                <View key={i} style={{ marginBottom: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: BORDER }}>
                  <Text style={styles.body}>
                    <Text style={{ color: badge.color, fontFamily: 'Helvetica-Bold', fontSize: 8 }}>{badge.label}  </Text>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>{l.quoted_title}</Text>
                  </Text>
                  {l.quoted_detail ? <Text style={[styles.body, { fontSize: 8, color: MUTED }]}>Quoted: {l.quoted_detail}</Text> : null}
                  {l.actual_qty != null ? (
                    <Text style={[styles.body, { fontSize: 9 }]}>Actual: {l.actual_qty}{l.actual_unit ? ` ${l.actual_unit}` : ''}</Text>
                  ) : null}
                  {plainTextForPdf(l.note_html).trim() ? <Text style={styles.body}>{plainTextForPdf(l.note_html)}</Text> : null}
                  {linePhotos.length > 0 ? <PhotoSection photos={linePhotos.slice(0, 6)} label="Photos" showAppMetadata={false} singleColumn /> : null}
                </View>
              )
            })}
          </View>
        ))}
        {sectionOrder.length === 0 ? <Text style={[styles.body, { color: MUTED }]}>No itemised scope lines.</Text> : null}
      </View>

      {added.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Added works</Text>
          {added.map((l, i) => {
            const linePhotos = resolve(l.photo_ids)
            return (
              <View key={i} style={{ marginBottom: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: BORDER }}>
                <Text style={[styles.body, { fontFamily: 'Helvetica-Bold' }]}>
                  {l.title || 'Added work'}{l.qty != null ? ` — ${l.qty}${l.unit ? ` ${l.unit}` : ''}` : ''}
                </Text>
                {plainTextForPdf(l.note_html).trim() ? <Text style={styles.body}>{plainTextForPdf(l.note_html)}</Text> : null}
                {linePhotos.length > 0 ? <PhotoSection photos={linePhotos.slice(0, 6)} label="Photos" showAppMetadata={false} singleColumn /> : null}
              </View>
            )
          })}
        </View>
      ) : null}

      {(content.area_notes ?? []).length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Per-room evidence</Text>
          {(content.area_notes ?? []).map((n, i) => {
            const areaPhotos = (n.photos ?? [])
              .map(ref => {
                const p = byId.get(ref.photo_id)
                if (!p) return null
                return { ...p, caption: ref.caption || p.caption } as PhotoWithData
              })
              .filter((p): p is PhotoWithData => !!p)
            return (
              <View key={i} style={styles.roomBlock}>
                <Text style={styles.roomHeading}>{n.area_name}</Text>
                {plainTextForPdf(n.intro_html).trim() ? <Text style={styles.roomNote}>{plainTextForPdf(n.intro_html)}</Text> : null}
                {areaPhotos.length > 0 ? <PhotoSection photos={areaPhotos.slice(0, 6)} label="Photos" showAppMetadata={false} singleColumn /> : null}
              </View>
            )
          })}
        </View>
      ) : null}

      {content.closing_html ? <Section label="Outcome" text={content.closing_html} /> : null}
      {content.technician_signoff ? <Section label="Sign-off" text={content.technician_signoff} /> : null}

      <Footer company={company} />
    </Page>
  )
}

/** A composed `report` document is a PRE when it carries scope_lines. */
function isPreContent(c: object): boolean {
  return Array.isArray((c as { scope_lines?: unknown }).scope_lines)
}

interface JobPDFDocumentProps {
  type: DocType
  content: object
  photos: PhotoWithData[]
  company: CompanyProfile | null
  jobId?: string
  areas?: Area[]
  /** Job site / address of works (jobs.site_address). */
  siteAddress?: string
}

export function JobPDFDocument({ type, content, photos, company, areas = [], siteAddress }: JobPDFDocumentProps) {
  photos = photosForComposedReports(photos)
  const name = company?.name || 'Brisbane Biohazard Cleaning'
  return (
    <Document title={name} author={name}>
      {type === 'quote' ? (
        <QuotePDF content={content as QuoteContent} photos={photos} company={company} areas={areas} siteAddress={siteAddress} />
      ) : type === 'iaq_multi' ? (
        <IaqMultiPDF
          bundle={content as { reference?: string; title?: string; parts?: Array<{ type: DocType; content: Record<string, unknown> }> }}
          photos={photos}
          company={company}
          areas={areas}
          siteAddress={siteAddress}
        />
      ) : type === 'report' && isPreContent(content) ? (
        <PrePDF content={content as PostRemediationEvaluationContent} photos={photos} company={company} />
      ) : (
        <SOWOrReportPDF content={content as SOWContent | ReportContent} type={type} photos={photos} company={company} areas={areas} />
      )}
    </Document>
  )
}
