import { describe, expect, it } from 'vitest'
import { authorizationServerMetadata, clientMcpInteraction, mcpConsentGrant } from '../src/index.js'

/**
 * fleetless/fleetless#1218: a client whose `client_id` is the HTTPS URL of its
 * Client ID Metadata Document. The fields are additive (18.0.0 → 18.1.0), and
 * the two consent shapes carry what a consent screen must show beside the
 * unverified name: the domain the document was fetched from, where the answer
 * goes, and whether that is the person's own computer.
 */
const interaction = {
  id: 'mcpint_x',
  app_id: '00000000-0000-4000-8000-000000000001',
  client_name: 'Claude',
  client_name_verified: false,
  client_id_host: 'claude.ai',
  redirect_uri_host: 'claude.ai',
  redirect_uri_loopback: false,
  scopes: [],
  already_granted: false,
  expires_at: '2026-11-25T20:00:00.000Z',
}

describe('clientMcpInteraction', () => {
  it('carries the client id host, the redirect host and the loopback flag', () => {
    expect(clientMcpInteraction.parse(interaction)).toEqual(interaction)
  })

  it('answers null for a self-registered client, never an empty string', () => {
    expect(clientMcpInteraction.safeParse({ ...interaction, client_id_host: null }).success).toBe(true)
  })

  it('requires all three, so a server that forgets one is caught here', () => {
    for (const key of ['client_id_host', 'redirect_uri_host', 'redirect_uri_loopback'] as const) {
      const { [key]: _gone, ...rest } = interaction
      expect(clientMcpInteraction.safeParse(rest).success, key).toBe(false)
    }
  })

  it('keeps the name unverified: a document is the client\'s own claim too', () => {
    expect(clientMcpInteraction.safeParse({ ...interaction, client_name_verified: true }).success).toBe(false)
  })
})

describe('mcpConsentGrant', () => {
  const grant = {
    client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    client_name: 'Claude',
    client_name_verified: false,
    client_id_host: 'claude.ai',
    granted_at: '2026-11-25T19:00:00.000Z',
  }
  it('carries the URL as client_id and its host', () => {
    expect(mcpConsentGrant.parse(grant)).toEqual(grant)
    expect(mcpConsentGrant.safeParse({ ...grant, client_id: 'mcpdyn_abc', client_id_host: null }).success).toBe(true)
  })
  it('requires client_id_host', () => {
    const { client_id_host: _gone, ...rest } = grant
    expect(mcpConsentGrant.safeParse(rest).success).toBe(false)
  })
})

describe('authorizationServerMetadata', () => {
  const base = {
    issuer: 'https://api.fleetless.dev/mcp',
    authorization_endpoint: 'https://auth.fleetless.dev/mcp/oauth/authorize',
    token_endpoint: 'https://api.fleetless.dev/mcp/oauth/token',
    registration_endpoint: 'https://api.fleetless.dev/mcp/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }
  it('keeps client_id_metadata_document_supported, beside registration_endpoint', () => {
    const parsed = authorizationServerMetadata.parse({ ...base, client_id_metadata_document_supported: true })
    expect(parsed.client_id_metadata_document_supported).toBe(true)
    expect(parsed.registration_endpoint).toBe(base.registration_endpoint)
  })
  it('stays optional, so an older document still parses', () => {
    expect(authorizationServerMetadata.safeParse(base).success).toBe(true)
  })
})
