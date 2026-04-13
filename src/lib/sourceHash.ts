import { createHash } from 'node:crypto'

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep(obj[k])
        return acc
      }, {})
  }
  return value
}

/** Stable JSON hash for provenance/freshness checks. */
export function sourceHash(value: unknown): string {
  const stable = JSON.stringify(sortDeep(value))
  return createHash('sha256').update(stable).digest('hex')
}
