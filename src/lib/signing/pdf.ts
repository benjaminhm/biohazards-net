/*
 * lib/signing/pdf.ts
 *
 * Turns a full HTML document into a PDF with headless Chrome, so the signed
 * copy looks exactly like the document the client saw, using the document's
 * own print styles.
 *
 * On Vercel the browser comes from @sparticuz/chromium (its binary is traced
 * into the signing routes in next.config.ts). Locally it uses the Chrome that
 * is installed on the machine; set CHROME_PATH if it is somewhere unusual.
 */
import { existsSync } from 'node:fs'
import type { Browser } from 'puppeteer-core'

const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

function onServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

async function launch(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default
  if (onServerless()) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    })
  }
  const executablePath = process.env.CHROME_PATH || LOCAL_CHROME_PATHS.find(p => existsSync(p))
  if (!executablePath) {
    throw new Error('No Chrome found for PDF rendering. Set CHROME_PATH to a Chrome or Chromium binary.')
  }
  return puppeteer.launch({ executablePath, headless: true })
}

/**
 * Render HTML to a PDF. Scripts in the page are not run: the document needs
 * none to print, and the HTML contains text typed by staff and by the signer.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.emulateMediaType('print')
    // A slow photo or font must not cost the client their signed copy: on a
    // timeout, print what has loaded.
    const unlessTimeout = (err: unknown) => {
      if (!(err instanceof Error) || !/timeout|timed out/i.test(err.message)) throw err
    }
    await page.setContent(html, { waitUntil: 'load', timeout: 25_000 }).catch(unlessTimeout)
    // Web fonts are requested after "load", once the text that needs them is laid out.
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10_000 }).catch(unlessTimeout)
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close().catch(() => {})
  }
}
