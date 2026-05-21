/*
 * Shared room-type presets for Assessment areas and Progress notes room selector.
 */
/** Room-type presets — residential / commercial / biohazard */
export const AREA_ROOM_TYPES: readonly string[] = [
  'Kitchen',
  'Bathroom',
  'Bedroom',
  'Bedroom 1',
  'Bedroom 2',
  'Bedroom 3',
  'Bedroom 4',
  'Bedroom 5',
  'Bedroom with ensuite',
  'Living room',
  'Master bedroom',
  'Ensuite',
  'Toilet',
  'Laundry',
  'Hallway',
  'Garage',
  'Dining room',
  'Study',
  'Rumpus / family room',
  'Storage room',
  'Walk-in robe',
  'Basement',
  'Attic',
  'Entry / foyer',
  'Lobby',
  'Stairs',
  'Sunroom',
  'Patio / alfresco',
  'Balcony',
  'Carport',
  'Shed',
  'Yard / exterior',
  'Commercial — office',
  'Commercial — warehouse',
  'Commercial — bathroom',
  'Commercial — kitchen',
  'Vehicle',
]

/** '' = none chosen, preset label, or '__other__' for custom text in `name` */
export function areaRoomSelectValue(name: string): string {
  const t = name.trim()
  if (!t) return ''
  const exact = AREA_ROOM_TYPES.find(r => r === t)
  if (exact) return exact
  const folded = AREA_ROOM_TYPES.find(r => r.toLowerCase() === t.toLowerCase())
  if (folded) return folded
  return '__other__'
}

/**
 * Separator used to join multiple room names into a single combined area name
 * (e.g. open-plan "Kitchen + Dining + Living"). `+` is chosen because some
 * preset labels already contain ` / ` (e.g. `Rumpus / family room`), so splitting
 * on slashes would tear a single preset apart.
 */
export const AREA_NAME_SEPARATOR = ' + '

/** Split a stored area name into its constituent parts (presets and/or custom tokens). */
export function splitAreaName(name: string): string[] {
  if (!name) return []
  return name
    .split(AREA_NAME_SEPARATOR)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Join parts back into a single canonical area name, deduped case-insensitively. */
export function joinAreaName(parts: readonly string[]): string {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of parts) {
    const t = (raw || '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(t)
  }
  return cleaned.join(AREA_NAME_SEPARATOR)
}
