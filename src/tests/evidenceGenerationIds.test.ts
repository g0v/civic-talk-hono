import { describe, expect, it } from 'vite-plus/test'
import { createEvidenceIdAliases, decodeEvidenceReferences, encodeEvidenceReferences, evidenceIdSchema, UnknownEvidenceIdError } from '../ai/generationEvidenceIds'

describe('generation evidence IDs', () => {
  it('assigns opaque canonical IDs in binary lexical order independently of input order', () => {
    const ids = ['opaque:ä:2', 'opaque:a:9', 'opaque:Z:1']

    const aliases = createEvidenceIdAliases(ids)
    const reordered = createEvidenceIdAliases([...ids].reverse())

    expect(aliases.entries).toEqual([
      { model_id: 'e1', evidence_id: 'opaque:Z:1' },
      { model_id: 'e2', evidence_id: 'opaque:a:9' },
      { model_id: 'e3', evidence_id: 'opaque:ä:2' },
    ])
    expect(reordered).toEqual(aliases)
    expect([...aliases.toModel]).toEqual([
      ['opaque:Z:1', 'e1'],
      ['opaque:a:9', 'e2'],
      ['opaque:ä:2', 'e3'],
    ])
    expect([...aliases.toCanonical]).toEqual([
      ['e1', 'opaque:Z:1'],
      ['e2', 'opaque:a:9'],
      ['e3', 'opaque:ä:2'],
    ])
    expect(ids).toEqual(['opaque:ä:2', 'opaque:a:9', 'opaque:Z:1'])
  })

  it('encodes input references while preserving prose and non-reference metadata without mutation', () => {
    const aliases = createEvidenceIdAliases(['opaque:B', 'opaque:A'])
    const input = {
      evidence: [{ id: 'opaque:B', text: 'opaque:A', incompatible_with: ['opaque:A'] }],
      exclusions: [{ evidence_id: 'opaque:A', reason: 'opaque:B' }],
      comparison: { evidence_ids: ['opaque:B', 'opaque:A'] },
      group_id: 'opaque:A',
      candidate_id: 'opaque:B',
      pointer: 'opaque:A',
      base_hash: 'opaque:B',
      other: ['opaque:A'],
    }
    const original = structuredClone(input)

    const encoded = encodeEvidenceReferences(input, aliases)

    expect(encoded).toEqual({
      ...input,
      evidence: [{ id: 'e2', text: 'opaque:A', incompatible_with: ['e1'] }],
      exclusions: [{ evidence_id: 'e1', reason: 'opaque:B' }],
      comparison: { evidence_ids: ['e2', 'e1'] },
    })
    expect(input).toEqual(original)
    expect(encoded).not.toBe(input)
  })

  it('restores only response reference fields and leaves IDs and prose untouched', () => {
    const aliases = createEvidenceIdAliases(['opaque:B', 'opaque:A'])
    const response = {
      id: 'e2',
      text: 'e1',
      metadata: 'e2',
      group_id: 'e1',
      candidate_id: 'e2',
      pointer: 'e1',
      base_hash: 'e2',
      incompatible_with: ['e1'],
      fills: [{ sentences: [{ text: 'e2', evidence_ids: ['e2', 'e1'] }] }],
      exclusions: [{ evidence_id: 'e1' }],
    }
    const original = structuredClone(response)

    const decoded = decodeEvidenceReferences(response, aliases)

    expect(decoded).toEqual({
      ...response,
      fills: [{ sentences: [{ text: 'e2', evidence_ids: ['opaque:B', 'opaque:A'] }] }],
      exclusions: [{ evidence_id: 'opaque:A' }],
    })
    expect(response).toEqual(original)
    expect(decoded).not.toBe(response)
  })

  it.each([
    ['encode unknown scalar', encodeEvidenceReferences, { id: 'missing' }],
    ['encode unknown exclusion', encodeEvidenceReferences, { evidence_id: 'missing' }],
    ['encode unknown array', encodeEvidenceReferences, { evidence_ids: ['missing'] }],
    ['encode unknown incompatibility', encodeEvidenceReferences, { incompatible_with: ['missing'] }],
    ['decode unknown scalar', decodeEvidenceReferences, { evidence_id: 'e9' }],
    ['decode unknown array', decodeEvidenceReferences, { evidence_ids: ['e9'] }],
    ['decode canonical scalar', decodeEvidenceReferences, { evidence_id: 'opaque:A' }],
    ['decode canonical array', decodeEvidenceReferences, { evidence_ids: ['opaque:A'] }],
  ])('rejects %s through a typed error', (_name, codec, payload) => {
    const aliases = createEvidenceIdAliases(['opaque:A'])

    const action = () => codec(payload, aliases)

    expect(action).toThrow(UnknownEvidenceIdError)
    expect(action).toThrow('generation_unknown_evidence')
  })

  it('accepts an alias that coincides with a synthetic canonical ID', () => {
    const aliases = createEvidenceIdAliases(['e1', 'canonical:A'])

    const decoded = decodeEvidenceReferences({ evidence_ids: ['e1', 'e2'] }, aliases)

    expect(decoded).toEqual({ evidence_ids: ['canonical:A', 'e1'] })
  })

  it.each([encodeEvidenceReferences, decodeEvidenceReferences])('preserves malformed reference shapes for strict validation with %s', codec => {
    const aliases = createEvidenceIdAliases(['opaque:A'])
    const malformed = {
      id: 3,
      evidence_id: ['missing'],
      evidence_ids: ['missing', 42, { evidence_id: 'missing' }],
      incompatible_with: ['missing', null],
      children: [{ evidence_ids: null }, { evidence_id: false }],
    }

    const result = codec(malformed, aliases)

    expect(result).toEqual(malformed)
    expect(result).not.toBe(malformed)
  })

  it('adds short ID enums in nested schemas while retaining other constraints and cloning input', () => {
    const aliases = createEvidenceIdAliases(['opaque:B', 'opaque:A'])
    const schema = {
      type: 'object',
      properties: {
        evidence_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        rows: { type: 'array', items: { anyOf: [{ properties: { evidence_id: { type: 'string' }, id: { type: 'string' } } }] } },
        text: { type: 'string', enum: ['opaque:A'] },
      },
      required: ['evidence_ids'],
      additionalProperties: false,
    }
    const original = structuredClone(schema)

    const result = evidenceIdSchema(schema, aliases)

    expect(result).toEqual({
      ...schema,
      properties: {
        ...schema.properties,
        evidence_ids: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, enum: ['e1', 'e2'] } },
        rows: { type: 'array', items: { anyOf: [{ properties: { evidence_id: { type: 'string', enum: ['e1', 'e2'] }, id: { type: 'string' } } }] } },
      },
    })
    expect(schema).toEqual(original)
    expect(result).not.toBe(schema)
  })
})
