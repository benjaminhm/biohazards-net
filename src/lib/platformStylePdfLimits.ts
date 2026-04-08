/** Multipart proxy uploads must stay under typical serverless body limits (e.g. Vercel ~4.5 MB). */
export const PLATFORM_STYLE_PDF_PROXY_MAX_BYTES = 3 * 1024 * 1024
