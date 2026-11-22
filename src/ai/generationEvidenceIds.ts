export interface EvidenceIdAliases {
  readonly toModel: ReadonlyMap<string, string>
  readonly toCanonical: ReadonlyMap<string, string>
  readonly entries: readonly { readonly model_id: string; readonly evidence_id: string }[]
}

export class UnknownEvidenceIdError extends Error {
  readonly evidenceId: string

  constructor(evidenceId: string) {
    super('generation_unknown_evidence')
    this.name = 'UnknownEvidenceIdError'
    this.evidenceId = evidenceId
  }
}

export function createEvidenceIdAliases(ids: readonly string[]): EvidenceIdAliases {
  const entries = [...ids].sort().map((evidence_id, index) => ({ model_id: `e${index + 1}`, evidence_id }))
  return {
    toModel: new Map(entries.map(({ model_id, evidence_id }) => [evidence_id, model_id])),
    toCanonical: new Map(entries.map(({ model_id, evidence_id }) => [model_id, evidence_id])),
    entries,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function translateReferences(value: unknown, ids: ReadonlyMap<string, string>, encode: boolean): unknown {
  function translate(id: string): string {
    const translated = ids.get(id)
    if (translated === undefined) throw new UnknownEvidenceIdError(id)
    return translated
  }

  function visit(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(visit)
    if (!isObject(node)) return node
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => {
        if (key === 'evidence_id' || (encode && key === 'id')) {
          return [key, typeof child === 'string' ? translate(child) : structuredClone(child)]
        }
        if (key === 'evidence_ids' || (encode && key === 'incompatible_with')) {
          return [key, Array.isArray(child) && child.every((id): id is string => typeof id === 'string') ? child.map(translate) : structuredClone(child)]
        }
        return [key, visit(child)]
      })
    )
  }

  return visit(value)
}

export function encodeEvidenceReferences(value: unknown, aliases: EvidenceIdAliases): unknown {
  return translateReferences(value, aliases.toModel, true)
}

export function decodeEvidenceReferences(value: unknown, aliases: EvidenceIdAliases): unknown {
  return translateReferences(value, aliases.toCanonical, false)
}

export function evidenceIdSchema(schema: Readonly<Record<string, unknown>>, aliases: EvidenceIdAliases): Record<string, unknown> {
  const modelIds = aliases.entries.map(entry => entry.model_id)

  function visit(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(visit)
    if (!isObject(node)) return node
    return cloneObject(node)
  }

  function cloneObject(node: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => {
        if (key !== 'properties' || !isObject(child)) return [key, visit(child)]
        return [
          key,
          Object.fromEntries(
            Object.entries(child).map(([property, definition]) => {
              if (!isObject(definition)) return [property, visit(definition)]
              const cloned = cloneObject(definition)
              if (property === 'evidence_id') return [property, { ...cloned, enum: [...modelIds] }]
              if (property === 'evidence_ids' && isObject(cloned.items)) {
                return [property, { ...cloned, items: { ...cloned.items, enum: [...modelIds] } }]
              }
              return [property, cloned]
            })
          ),
        ]
      })
    )
  }

  return cloneObject(schema)
}
