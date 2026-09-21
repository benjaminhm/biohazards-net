const MAX_PDF_BYTES = 15 * 1024 * 1024

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function isPdfUrl(url: string): boolean {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  return path.endsWith('.pdf')
}

export function safePdfFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80)
  return base.toLowerCase().endsWith('.pdf') ? base : `${base || 'docket'}.pdf`
}

function pdfPlaceholderJpeg(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1240
    canvas.height = 1754
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Could not render PDF'))
      return
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0f2447'
    ctx.font = '600 42px system-ui, sans-serif'
    ctx.fillText('Skip docket (PDF)', 80, 200)
    ctx.fillStyle = '#3a5070'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText('Original PDF is on the job file.', 80, 260)
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not render PDF'))), 'image/jpeg', 0.85)
  })
}

/** First page as JPEG for the composed CDR. Falls back to a labelled placeholder. */
export async function rasterizePdfFirstPage(file: File): Promise<Blob> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF is too large (max 15 MB)')
  }
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjs.getDocument({ data }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not render PDF')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('Could not render PDF')
    return blob
  } catch (err) {
    if (err instanceof Error && err.message.includes('too large')) throw err
    return pdfPlaceholderJpeg()
  }
}
