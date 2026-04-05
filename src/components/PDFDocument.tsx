/*
 * components/PDFDocument.tsx
 *
 * @react-pdf/renderer component tree that produces binary PDF output when
 * consumed by /api/pdf (server-side renderToBuffer). NOT a browser component —
 * it renders to a PDF byte stream, not to the DOM.
 *
 * Exported: JobPDFDocument — the top-level entry point for the /api/pdf route.
 * Supports DocType 'quote', 'sow', and 'report'.
 *
 * Architecture:
 *   - QuotePDF: renders the line-items pricing table, GST totals, an online
 *     acceptance block (clickable link in the PDF), and a physical signature block.
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
  Document, Page, View, Text, Image, Link, StyleSheet,
} from '@react-pdf/renderer'
import type { DocType, QuoteContent, SOWContent, ReportContent, CompanyProfile, PhotoWithData } from '@/lib/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://biohazards.net'

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
  photoImage: { width: '100%', height: 120, objectFit: 'cover', borderRadius: 4, borderWidth: 1, borderColor: '#E5E5E5' },
  photoAreaBadge: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: ORANGE, textTransform: 'uppercase', marginTop: 4, marginBottom: 2 },
  photoNote: { fontSize: 8, color: MUTED, lineHeight: 1.4 },
  photoNoNote: { fontSize: 8, color: '#BBBBBB', fontStyle: 'italic' },
  // Accept block
  acceptBlock: { marginTop: 24, padding: 16, backgroundColor: '#FFF5F1', borderRadius: 6, borderWidth: 1, borderColor: '#FFD4C2' },
  acceptLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textTransform: 'uppercase', color: ORANGE, marginBottom: 6 },
  acceptBody: { fontSize: 10, color: BLACK, marginBottom: 10 },
  acceptBtn: { backgroundColor: ORANGE, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'flex-start' },
  acceptBtnText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  acceptUrlText: { fontSize: 8, color: MUTED, marginTop: 6 },
  // Signature block
  sigBlock: { marginTop: 30, paddingTop: 16, borderTopWidth: 1, borderTopColor: BORDER },
  sigLine: { width: 200, height: 1, backgroundColor: BLACK, marginTop: 30, marginBottom: 4 },
  sigLabel: { fontSize: 8, color: MUTED },
  // Footer
  footer: {
    position: 'absolute', bottom: 20, left: 50, right: 50,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 8,
  },
  footerText: { fontSize: 7, color: MUTED },
  footerBrand: { fontSize: 7, color: ORANGE },
})

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
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  )
}

function PhotoSection({ photos, label }: { photos: PhotoWithData[]; label: string }) {
  if (photos.length === 0) return null
  return (
    <View style={styles.section} break={photos.length > 4}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.photoGrid}>
        {photos.map((p, i) => (
          <View key={i} style={styles.photoItem}>
            {(p.dataUrl || p.file_url) ? (
              <Image
                src={p.dataUrl || p.file_url}
                style={styles.photoImage}
              />
            ) : null}
            {p.area_ref ? <Text style={styles.photoAreaBadge}>{p.area_ref}</Text> : null}
            {p.caption
              ? <Text style={styles.photoNote}>{p.caption}</Text>
              : <Text style={styles.photoNoNote}>No note</Text>
            }
          </View>
        ))}
      </View>
    </View>
  )
}

function QuotePDF({ content, photos, company, jobId }: { content: QuoteContent; photos: PhotoWithData[]; company: CompanyProfile | null; jobId?: string }) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const beforePhotos = photos.filter(p => p.category === 'before' || p.category === 'assessment').slice(0, 6)

  return (
    <Page size="A4" style={styles.page}>
      <Header reference={content.reference} date={today} company={company} />
      <Text style={styles.docTitle}>{content.title}</Text>
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
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue}>{fmt(content.subtotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>GST (10%)</Text>
          <Text style={styles.totalValue}>{fmt(content.gst)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.grandTotalLabel}>TOTAL</Text>
          <Text style={styles.grandTotalValue}>{fmt(content.total)}</Text>
        </View>
      </View>

      {content.notes && <View style={{ marginTop: 20 }}><Section label="Notes & Conditions" text={content.notes} /></View>}
      <Section label="Payment Terms" text={content.payment_terms} />
      <Section label="Quote Validity" text={content.validity} />

      {/* Before photos as evidence */}
      {beforePhotos.length > 0 && (
        <PhotoSection photos={beforePhotos} label={`Site Condition Photos (${beforePhotos.length})`} />
      )}

      {/* Accept quote block — entire block is a link for mobile compatibility */}
      {jobId && (
        <Link src={`${APP_URL}/accept/${jobId}`}>
          <View style={styles.acceptBlock}>
            <Text style={styles.acceptLabel}>Accept This Quote Online</Text>
            <Text style={styles.acceptBody}>
              Tap or click anywhere in this box to accept this quote online.
            </Text>
            <View style={styles.acceptBtn}>
              <Text style={styles.acceptBtnText}>✓  Accept This Quote</Text>
            </View>
            <Text style={styles.acceptUrlText}>{APP_URL}/accept/{jobId}</Text>
          </View>
        </Link>
      )}

      <View style={styles.sigBlock}>
        <Text style={styles.sectionLabel}>Acceptance</Text>
        <Text style={[styles.body, { marginBottom: 4 }]}>
          To accept this quote, please sign below and return with deposit payment.
        </Text>
        <View style={{ flexDirection: 'row', gap: 40, marginTop: 16 }}>
          <View><View style={styles.sigLine} /><Text style={styles.sigLabel}>Client Signature</Text></View>
          <View><View style={styles.sigLine} /><Text style={styles.sigLabel}>Date</Text></View>
        </View>
      </View>

      <Footer company={company} />
    </Page>
  )
}

function SOWOrReportPDF({
  content, type, photos, company,
}: {
  content: SOWContent | ReportContent
  type: DocType
  photos: PhotoWithData[]
  company: CompanyProfile | null
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
        if (!text) return null
        return <Section key={key} label={label} text={text} />
      })}

      {/* SOW: show before photos as evidence of scope */}
      {type === 'sow' && beforePhotos.length > 0 && (
        <PhotoSection photos={beforePhotos} label={`Site Condition Photos — Evidence of Scope (${beforePhotos.length})`} />
      )}

      {/* Report: before + after photos */}
      {type === 'report' && beforePhotos.length > 0 && (
        <PhotoSection photos={beforePhotos} label={`Before — Site Conditions on Arrival (${beforePhotos.length})`} />
      )}
      {type === 'report' && afterPhotos.length > 0 && (
        <PhotoSection photos={afterPhotos} label={`After — Completed Works (${afterPhotos.length})`} />
      )}

      {type === 'sow' && (
        <View style={styles.sigBlock}>
          <Text style={styles.sectionLabel}>Acceptance</Text>
          <Text style={[styles.body, { marginBottom: 4 }]}>{(content as SOWContent).acceptance}</Text>
          <View style={{ flexDirection: 'row', gap: 40, marginTop: 16 }}>
            <View><View style={styles.sigLine} /><Text style={styles.sigLabel}>Client Signature</Text></View>
            <View><View style={styles.sigLine} /><Text style={styles.sigLabel}>Date</Text></View>
          </View>
        </View>
      )}

      <Footer company={company} />
    </Page>
  )
}

interface JobPDFDocumentProps {
  type: DocType
  content: object
  photos: PhotoWithData[]
  company: CompanyProfile | null
  jobId?: string
}

export function JobPDFDocument({ type, content, photos, company, jobId }: JobPDFDocumentProps) {
  const name = company?.name || 'Brisbane Biohazard Cleaning'
  return (
    <Document title={name} author={name}>
      {type === 'quote' ? (
        <QuotePDF content={content as QuoteContent} photos={photos} company={company} jobId={jobId} />
      ) : (
        <SOWOrReportPDF content={content as SOWContent | ReportContent} type={type} photos={photos} company={company} />
      )}
    </Document>
  )
}
