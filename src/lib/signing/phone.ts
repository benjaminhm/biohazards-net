/*
 * lib/signing/phone.ts
 *
 * A link texted to the client can be opened with their mobile number in place
 * of a code. It is kept as the 9 digits after the leading 0 (or +61), so
 * "0412 345 678", "+61 412 345 678" and "412345678" all open it. A random code
 * is never 9 digits, so the kept value says which kind a link has.
 *
 * No Node imports: the staff screens use these too.
 */
export function phonePasscode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let d = value.replace(/\D/g, '')
  if (d.startsWith('61') && d.length === 11) d = d.slice(2)
  else if (d.startsWith('610') && d.length === 12) d = d.slice(3)
  else if (d.startsWith('0') && d.length === 10) d = d.slice(1)
  return /^[2-9]\d{8}$/.test(d) ? d : null
}

export function isPhonePasscode(passcode: string | null | undefined): boolean {
  return typeof passcode === 'string' && /^\d{9}$/.test(passcode)
}

/** "0412 345 678" (or "07 3123 4567" for a landline) from the kept 9 digits. */
export function phonePasscodeLabel(passcode: string): string {
  const local = `0${passcode}`
  return local.startsWith('04')
    ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
    : `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`
}
