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
  httpsLegalUrl,
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

  it('rejects missing and malformed URL hostnames at runtime', () => {
    for (const url of [
      'https://:/',
      'https://:443/',
      'https://-bad.example/legal',
      'https://bad..example/legal',
      'https://bad-.example/legal',
      'https://bad_host.example/legal',
      `https://${'a'.repeat(64)}.example/legal`,
      `https://${Array(5).fill('a'.repeat(63)).join('.')}/legal`,
    ]) {
      expect(httpsLegalUrl.safeParse(url).success, url).toBe(false)
      expect(legalDocumentReference.safeParse({ ...terms, url }).success, url).toBe(false)
    }
  })

  it('exports both reusable reference objects as output schemas', () => {
    const schemas = exportedSchemas as Record<string, unknown>
    expect(schemas['legal-document-reference']).toBe(legalDocumentReference)
    expect(schemas['legal-text-references']).toBe(legalTextReferences)
    expect(schemaIo('legal-document-reference')).toBe('output')
    expect(schemaIo('legal-text-references')).toBe('output')
  })

  it('retains HTTPS, no-userinfo and valid hostnames in published schemas', () => {
    const load = (name: string) => JSON.parse(readFileSync(
      new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8',
    )) as { properties: Record<string, { pattern?: string; anyOf?: Array<{ pattern?: string }>; properties?: Record<string, { pattern?: string }> }> }
    const openapi = JSON.parse(readFileSync(
      new URL('../artifacts/openapi.json', import.meta.url), 'utf8',
    )) as { components: { schemas: Record<string, { properties: Record<string, { anyOf?: Array<{ pattern?: string }> }> }> } }
    const appConfig = load('app-auth-config').properties
    const appRequest = load('put-app-auth-urls-request').properties
    const openapiRequest = openapi.components.schemas['put-app-auth-urls-request'].properties
    const patterns = [
      load('legal-document-reference').properties.url.pattern,
      load('legal-text-references').properties.terms.properties?.url.pattern,
      ...[appConfig, appRequest, openapiRequest].flatMap((properties) => [
        properties.operator_info_url.anyOf?.[0]?.pattern,
        properties.privacy_policy_url.anyOf?.[0]?.pattern,
      ]),
    ]
    for (const source of patterns) {
      expect(source).toBeTypeOf('string')
      const pattern = new RegExp(source!)
      expect(pattern.test('https://app.example.com/legal')).toBe(true)
      expect(pattern.test('https://localhost/legal')).toBe(true)
      expect(pattern.test('https://app.example.com:443/legal')).toBe(true)
      expect(pattern.test('http://app.example.com/legal')).toBe(false)
      expect(pattern.test('HTTPS://app.example.com/legal')).toBe(false)
      expect(pattern.test('https://user:pass@app.example.com/legal')).toBe(false)
      for (const url of [
        'https://:/',
        'https://:443/',
        'https://-bad.example/legal',
        'https://bad..example/legal',
        'https://bad-.example/legal',
        'https://bad_host.example/legal',
        `https://${'a'.repeat(64)}.example/legal`,
        `https://${Array(5).fill('a'.repeat(63)).join('.')}/legal`,
      ]) expect(pattern.test(url), url).toBe(false)
    }
  })

  it('rejects out-of-range ports in runtime and published URL schemas', () => {
    type UrlArtifact = { pattern?: string; format?: string; anyOf?: UrlArtifact[]; properties?: Record<string, UrlArtifact> }
    const load = (name: string) => JSON.parse(readFileSync(
      new URL(`../artifacts/schema/${name}.schema.json`, import.meta.url), 'utf8',
    )) as { properties: Record<string, UrlArtifact> }
    const openapi = JSON.parse(readFileSync(
      new URL('../artifacts/openapi.json', import.meta.url), 'utf8',
    )) as { components: { schemas: Record<string, { properties: Record<string, UrlArtifact> }> } }
    const appConfig = load('app-auth-config').properties
    const appRequest = load('put-app-auth-urls-request').properties
    const openapiRequest = openapi.components.schemas['put-app-auth-urls-request'].properties
    const legalReferences = load('legal-text-references').properties
    const urlSchemas = [
      load('legal-document-reference').properties.url,
      legalReferences.terms.properties?.url,
      legalReferences.dpa.anyOf?.[0]?.properties?.url,
      ...[appConfig, appRequest, openapiRequest].flatMap((properties) => [
        properties.operator_info_url.anyOf?.[0],
        properties.privacy_policy_url.anyOf?.[0],
      ]),
    ]
    for (const url of [
      'https://app.example.com:65536/legal',
      'https://app.example.com:99999/legal',
    ]) {
      expect(httpsLegalUrl.safeParse(url).success, url).toBe(false)
      expect(legalDocumentReference.safeParse({ ...terms, url }).success, url).toBe(false)
    }
    for (const schema of urlSchemas) {
      expect(schema?.pattern).toBeTypeOf('string')
      const pattern = new RegExp(schema!.pattern!)
      expect(pattern.test('https://app.example.com:65535/legal')).toBe(true)
      expect(pattern.test('https://app.example.com:65536/legal')).toBe(false)
      expect(pattern.test('https://app.example.com:99999/legal')).toBe(false)
      expect(schema?.format).toBe('uri')
    }
  })
})
