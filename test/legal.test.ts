// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  TERMS_VERSION,
  TERMS_VERSION_DATE,
  TERMS_VERSION_URL,
  DPA_VERSION,
  DPA_VERSION_DATE,
  DPA_VERSION_URL,
  legalDocumentReference,
  legalTextReferences,
} from '../src/index.js'
import { exportedSchemas, schemaIo } from '../scripts/export-schemas.js'

describe('versioned legal document references', () => {
  const terms = {
    version: '1.0',
    version_date: '2026-11-01',
    url: 'https://fleetless.dev/terms/v1.0/',
  }
  const dpa = {
    version: '1.0',
    version_date: '2026-11-01',
    url: 'https://fleetless.dev/dpa/v1.0/',
  }

  it('keeps independent initial Terms and DPA identifiers and permanent URLs', () => {
    expect(TERMS_VERSION).toBe('1.0')
    expect(DPA_VERSION).toBe('1.0')
    expect(TERMS_VERSION_DATE).toBe('2026-11-01')
    expect(DPA_VERSION_DATE).toBe('2026-11-01')
    expect(TERMS_VERSION_URL).toBe(terms.url)
    expect(DPA_VERSION_URL).toBe(dpa.url)
    expect(TERMS_VERSION_URL).not.toBe(DPA_VERSION_URL)
  })

  it('accepts an applicable DPA or an explicit inapplicable DPA', () => {
    expect(legalTextReferences.safeParse({ terms, dpa }).success).toBe(true)
    expect(legalTextReferences.safeParse({ terms, dpa: null }).success).toBe(true)
    expect(legalTextReferences.safeParse({ dpa }).success).toBe(false)
  })

  it('refuses blank versions, HTTP, credentials and absent version dates', () => {
    const parse = (value: unknown) => legalDocumentReference.safeParse(value).success
    expect(parse({ ...terms, version: '   ' })).toBe(false)
    expect(parse({ ...terms, url: 'http://fleetless.dev/terms/v1.0/' })).toBe(false)
    expect(parse({ ...terms, url: 'HTTPS://fleetless.dev/terms/v1.0/' })).toBe(false)
    expect(parse({ ...terms, url: 'https://user:pass@fleetless.dev/terms/v1.0/' })).toBe(false)
    expect(parse({ version: terms.version, url: terms.url })).toBe(false)
  })

  it('exports both reusable reference objects as output schemas', () => {
    const schemas = exportedSchemas as Record<string, unknown>
    expect(schemas['legal-document-reference']).toBe(legalDocumentReference)
    expect(schemas['legal-text-references']).toBe(legalTextReferences)
    expect(schemaIo('legal-document-reference')).toBe('output')
    expect(schemaIo('legal-text-references')).toBe('output')
  })

  it('retains HTTPS and no-userinfo syntax in generated JSON Schemas', () => {
    const load = (name: string) => JSON.parse(readFileSync(
      new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8',
    )) as { properties: Record<string, { pattern?: string; anyOf?: Array<{ pattern?: string }> }> }
    const legalPattern = load('legal-document-reference').properties.url.pattern
    const appPattern = load('put-app-auth-urls-request').properties.operator_info_url.anyOf?.[0]?.pattern
    for (const source of [legalPattern, appPattern]) {
      expect(source).toBeTypeOf('string')
      const pattern = new RegExp(source!)
      expect(pattern.test('https://app.example.com/legal')).toBe(true)
      expect(pattern.test('http://app.example.com/legal')).toBe(false)
      expect(pattern.test('HTTPS://app.example.com/legal')).toBe(false)
      expect(pattern.test('https://user:pass@app.example.com/legal')).toBe(false)
    }
  })
})
