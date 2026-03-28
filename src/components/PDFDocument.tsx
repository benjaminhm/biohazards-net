import React from 'react'
import {
  Document, Page, View, Text, StyleSheet, Font,
} from '@react-pdf/renderer'
import type { DocType, QuoteContent, SOWContent, ReportContent } from '@/lib/types'

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
    paddingBottom: 50,
    paddingHorizontal: 50,
    lineHeight: 1.5,
  },
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: BLACK },
  companyTagline: { fontSize: 8, color: MUTED, marginTop: 2 },
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
  // Line items table (quotes)
  table: { marginTop: 12, marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: BLACK, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3 },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  tableRowAlt: { backgroundColor: BG_LIGHT },
  tableRowTotal: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: BORDER, marginTop: 2, borderRadius: 3 },
  colDesc: { flex: 3 },
  colQty: { flex: 0.7, textAlign: 'right' },
  colUnit: { flex: 0.7, textAlign: 'center' },
  colRate: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1, textAlign: 'right' },
  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  tdText: { fontSize: 9, color: BLACK },
  tdTextBold: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BLACK },
  // Totals
  totalsBlock: { marginTop: 4, alignItems: 'flex-end' },
  totalRow: { flexDirection: 'row', gap: 20, marginBottom: 4 },
  totalLabel: { fontSize: 9, color: MUTED, width: 80, textAlign: 'right' },
  totalValue: { fontSize: 9, color: BLACK, width: 70, textAlign: 'right' },
  grandTotalLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BLACK, width: 80, textAlign: 'right' },
  grandTotalValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: ORANGE, width: 70, textAlign: 'right' },
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
  footerText: { fontSize: 8, color: MUTED },
  footerBrand: { fontSize: 8, color: ORANGE },
})

function Header({ reference, date }: { reference: string; date: string }) {
  return (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.companyName}>Brisbane Biohazard Cleaning</Text>
          <Text style={styles.companyTagline}>Professional Biohazard Remediation Services</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.refText}>{reference}</Text>
          <Text style={styles.dateText}>{date}</Text>
        </View>
      </View>
      <View style={styles.rule} />
    </>
  )
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Brisbane Biohazard Cleaning — biohazards.net</Text>
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

function QuotePDF({ content }: { content: QuoteContent }) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
  const fmt = (n: number) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <Page size="A4" style={styles.page}>
      <Header reference={content.reference} date={today} />
      <Text style={styles.docTitle}>{content.title}</Text>
      <Section label="Overview" text={content.intro} />

      {/* Line items */}
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

      {/* Totals */}
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

      {content.notes && (
        <View style={{ marginTop: 20 }}>
          <Section label="Notes & Conditions" text={content.notes} />
        </View>
      )}
      <Section label="Payment Terms" text={content.payment_terms} />
      <Section label="Quote Validity" text={content.validity} />

      {/* Acceptance */}
      <View style={styles.sigBlock}>
        <Text style={styles.sectionLabel}>Acceptance</Text>
        <Text style={[styles.body, { marginBottom: 4 }]}>
          To accept this quote, please sign below and return with deposit payment.
        </Text>
        <View style={{ flexDirection: 'row', gap: 40, marginTop: 16 }}>
          <View>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>Client Signature</Text>
          </View>
          <View>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>Date</Text>
          </View>
        </View>
      </View>

      <Footer />
    </Page>
  )
}

function SOWOrReportPDF({ content, type }: { content: SOWContent | ReportContent; type: DocType }) {
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })

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
      <Header reference={(content as SOWContent).reference} date={today} />
      <Text style={styles.docTitle}>{(content as SOWContent).title}</Text>

      {sections.map(({ key, label }) => {
        const text = (content as unknown as Record<string, string>)[key]
        if (!text) return null
        return <Section key={key} label={label} text={text} />
      })}

      {type === 'sow' && (
        <View style={styles.sigBlock}>
          <Text style={styles.sectionLabel}>Acceptance</Text>
          <Text style={[styles.body, { marginBottom: 4 }]}>{(content as SOWContent).acceptance}</Text>
          <View style={{ flexDirection: 'row', gap: 40, marginTop: 16 }}>
            <View>
              <View style={styles.sigLine} />
              <Text style={styles.sigLabel}>Client Signature</Text>
            </View>
            <View>
              <View style={styles.sigLine} />
              <Text style={styles.sigLabel}>Date</Text>
            </View>
          </View>
        </View>
      )}

      <Footer />
    </Page>
  )
}

interface JobPDFDocumentProps {
  type: DocType
  content: object
}

export function JobPDFDocument({ type, content }: JobPDFDocumentProps) {
  return (
    <Document
      title="Brisbane Biohazard Cleaning"
      author="Brisbane Biohazard Cleaning"
    >
      {type === 'quote' ? (
        <QuotePDF content={content as QuoteContent} />
      ) : (
        <SOWOrReportPDF content={content as SOWContent | ReportContent} type={type} />
      )}
    </Document>
  )
}
