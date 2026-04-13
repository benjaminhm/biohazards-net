/*
 * If Next did not inject ANTHROPIC_API_KEY (Turbopack cwd, stale dev, inlining),
 * read it from .env.local in development only. Production must use real process env.
 */
import fs from 'fs'
import path from 'path'

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function parseValueFromLine(line: string, wantKey: string): string | undefined {
  let s = line.trim()
  if (!s || s.startsWith('#')) return undefined
  if (s.startsWith('export ')) s = s.slice(7).trim()
  const eq = s.indexOf('=')
  if (eq === -1) return undefined
  const key = s.slice(0, eq).trim()
  if (key !== wantKey) return undefined
  let val = s.slice(eq + 1).trim()
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1)
  }
  const trimmed = val.trim()
  return trimmed || undefined
}

function readAnthropicKeyFromEnvLocalFiles(): string | undefined {
  let dir = path.resolve(process.cwd())
  for (let i = 0; i < 12; i++) {
    const envPath = path.join(dir, '.env.local')
    if (fs.existsSync(envPath)) {
      try {
        const content = stripBom(fs.readFileSync(envPath, 'utf8'))
        for (const line of content.split('\n')) {
          const v = parseValueFromLine(line, 'ANTHROPIC_API_KEY')
          if (v) return v
        }
      } catch {
        // try parent directory
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

export function getAnthropicApiKey(): string | undefined {
  const fromProcess = process.env['ANTHROPIC_API_KEY']?.trim()
  if (fromProcess) return fromProcess
  if (process.env.NODE_ENV === 'production') return undefined

  const fromFile = readAnthropicKeyFromEnvLocalFiles()
  if (fromFile) {
    process.env['ANTHROPIC_API_KEY'] = fromFile
    return fromFile
  }
  return undefined
}
