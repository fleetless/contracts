// SPDX-License-Identifier: Apache-2.0
/**
 * Who saved a config draft, who published a version, and which shape the
 * hosted logo has.
 *
 * Every `it` names the wrong outcome it exists to catch: a consumer that
 * prints "by <name>" must be able to rely on `null` meaning "nobody is
 * known", and a hosted page that picks between a square logo beside the name
 * and a wide one replacing it must never be handed a third spelling.
 */
import { describe, it, expect } from 'vitest'
import {
  HOSTED_LOGO_MAX_BYTES,
  appAuthConfig,
  configAuthor,
  configDraftResponse,
  configVersionResponse,
  configVersionsResponse,
  hostedLogoShape,
} from '../src/index.js'

const ADA = { id: '3f1c1a52-1c0e-4c4e-9a4e-6a1a3c0f9d11', name: 'Ada Lovelace' }

const DRAFT = {
  doc: null,
  source: 'robot: {}\n',
  updated_at: '2026-11-05T09:00:00.000Z',
  issues: [],
}

describe('configAuthor', () => {
  it('accepts a member id with a display name', () => {
    expect(configAuthor.safeParse(ADA).success).toBe(true)
  })

  it('refuses an empty name: an unnamed author is null, not a blank string a page would print', () => {
    expect(configAuthor.safeParse({ ...ADA, name: '' }).success).toBe(false)
  })

  it('refuses an id that is not a uuid', () => {
    expect(configAuthor.safeParse({ ...ADA, id: 'x' }).success).toBe(false)
  })

  it('refuses a name past 200 characters', () => {
    expect(configAuthor.safeParse({ ...ADA, name: 'a'.repeat(201) }).success).toBe(false)
  })
})

describe('configDraftResponse.updated_by', () => {
  it('parses a draft nobody has written yet as null', () => {
    expect(configDraftResponse.safeParse({ ...DRAFT, updated_by: null }).success).toBe(true)
  })

  it('parses a draft saved by a member', () => {
    const parsed = configDraftResponse.safeParse({ ...DRAFT, updated_by: ADA })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.updated_by).toEqual(ADA)
  })

  it('refuses an author with an empty name', () => {
    expect(configDraftResponse.safeParse({ ...DRAFT, updated_by: { id: 'x', name: '' } }).success).toBe(false)
  })

  it('accepts a draft without the field (a server that predates it) and leaves it undefined, so a reader treats it as unknown and not as a named author', () => {
    const parsed = configDraftResponse.safeParse(DRAFT)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.updated_by).toBeUndefined()
  })
})

describe('published_by on versions', () => {
  const VERSION = { version: 3, published_at: '2026-11-05T09:00:00.000Z' }

  it('the version list parses published_by as null and as a member', () => {
    expect(configVersionsResponse.safeParse({ versions: [{ ...VERSION, published_by: null }] }).success).toBe(true)
    const parsed = configVersionsResponse.safeParse({ versions: [{ ...VERSION, published_by: ADA }] })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.versions[0]?.published_by).toEqual(ADA)
  })

  it('the version list refuses a nameless author', () => {
    expect(configVersionsResponse.safeParse({ versions: [{ ...VERSION, published_by: { id: ADA.id, name: '' } }] }).success).toBe(false)
  })

  it('a single version parses published_by both ways', () => {
    const base = { ...VERSION, doc: { fleetless: 1 }, source: 'fleetless: 1\n' }
    expect(configVersionResponse.safeParse({ ...base, published_by: null }).success).toBe(true)
    expect(configVersionResponse.safeParse({ ...base, published_by: ADA }).data?.published_by).toEqual(ADA)
    expect(configVersionResponse.safeParse({ ...base, published_by: { id: 'x', name: '' } }).success).toBe(false)
  })

  it('a version in the list and a single version parse without the field (a server that predates it) and leave it undefined', () => {
    const list = configVersionsResponse.safeParse({ versions: [VERSION] })
    expect(list.success).toBe(true)
    expect(list.data?.versions[0]?.published_by).toBeUndefined()
    const one = configVersionResponse.safeParse({ ...VERSION, doc: { fleetless: 1 }, source: 'fleetless: 1\n' })
    expect(one.success).toBe(true)
    expect(one.data?.published_by).toBeUndefined()
  })
})

describe('hosted_logo_shape on appAuthConfig', () => {
  const ROW = {
    self_registration: true,
    allowed_domains: [],
    allowed_origins: ['https://app.example.com'],
    mcp_enabled: false,
    invite_url: null,
    verify_url: null,
    reset_url: null,
    mcp_login_url: null,
    app_url: null,
    operator_info_url: null,
    privacy_policy_url: null,
    sign_in_methods: { password: true, email_code: false },
    two_factor: 'off',
    hosted_logo_url: null,
    hosted_logo_shape: null,
    hosted_accent: null,
    hosted_pages: {
      invite_url: 'https://auth.fleetless.dev/app/shop/invite/{token}',
      verify_url: 'https://auth.fleetless.dev/app/shop/verify/{token}',
      reset_url: 'https://auth.fleetless.dev/app/shop/reset/{token}',
      mcp_login_url: 'https://auth.fleetless.dev/app/shop/mcp/{interaction}',
    },
    oidc_callback_url: 'https://api.fleetless.dev/api/client/oidc/callback',
    updated_at: '2026-11-05T09:00:00.000Z',
  }
  const LOGO = 'https://auth.fleetless.dev/app/shop/logo'

  it('the shape enum is square and wide, and nothing else', () => {
    expect(hostedLogoShape.options).toEqual(['square', 'wide'])
  })

  it('parses a wide logo', () => {
    const parsed = appAuthConfig.safeParse({ ...ROW, hosted_logo_url: LOGO, hosted_logo_shape: 'wide' })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.hosted_logo_shape).toBe('wide')
  })

  it('parses no logo with no shape', () => {
    expect(appAuthConfig.safeParse(ROW).success).toBe(true)
  })

  it('refuses a shape the hosted pages have no layout for', () => {
    expect(appAuthConfig.safeParse({ ...ROW, hosted_logo_url: LOGO, hosted_logo_shape: 'round' }).success).toBe(false)
  })

  it('accepts a row without the field (a server that predates it) and leaves it undefined, which a page must not read as square', () => {
    const { hosted_logo_shape: _omitted, ...without } = ROW
    const parsed = appAuthConfig.safeParse({ ...without, hosted_logo_url: LOGO })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.hosted_logo_shape).toBeUndefined()
  })

  it('is read-only: no slice that writes the look takes it', async () => {
    const { putAppAuthLookRequest } = await import('../src/index.js')
    expect(putAppAuthLookRequest.safeParse({ hosted_accent: null, hosted_logo_shape: 'wide' }).success).toBe(false)
  })

  it('the logo limit is 512 KB', () => {
    expect(HOSTED_LOGO_MAX_BYTES).toBe(524_288)
  })
})
