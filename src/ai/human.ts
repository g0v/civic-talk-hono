import { sourceFor, type GenerationData } from './generation'
import type { MaterialSource } from './source'

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nullableText(value: unknown): boolean {
  return value === null || nonempty(value)
}

function opinion(value: unknown): boolean {
  return exactObject(value, ['Title', 'description']) && nonempty(value.Title) && nonempty(value.description)
}

/** 人改只接受 #181 data，且不得冒充來源；所有人改文字仍是 human_unverified。 */
export function validateHumanData(value: unknown, materials: MaterialSource[]): value is GenerationData {
  if (!exactObject(value, ['consensus', 'disputes', 'positions'])) return false
  for (const field of ['consensus', 'disputes'] as const) {
    const section = value[field]
    if (!exactObject(section, ['Overview', 'items']) || !nullableText(section.Overview) || !Array.isArray(section.items) || !section.items.every(opinion)) return false
  }
  const positions = value.positions
  if (!exactObject(positions, ['Overview', 'items']) || !nullableText(positions.Overview) || !Array.isArray(positions.items)) return false
  const sources = new Map(materials.map(material => [material.id, sourceFor(material)]))
  return positions.items.every(item => {
    if (!exactObject(item, ['name', 'Sources', 'Core_concern', 'opinions']) || !nonempty(item.name) || !nullableText(item.Core_concern) || !Array.isArray(item.Sources) || !Array.isArray(item.opinions) || !item.opinions.every(opinion)) return false
    return item.Sources.every(source => {
      if (!exactObject(source, ['Title', 'href', 'material_id']) || !Number.isSafeInteger(source.material_id)) return false
      const expected = sources.get(source.material_id as number)
      return expected !== undefined && source.Title === expected.Title && source.href === expected.href
    })
  })
}
