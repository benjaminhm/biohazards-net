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
