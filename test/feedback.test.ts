// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { FEEDBACK_KINDS, FEEDBACK_MESSAGE_MAX, feedbackRequest, feedbackResponse, ROUTES } from '../src/index.js'

const ok = { kind: 'idea', message: 'Dark mode is great.', page: '/robots' }

describe('feedbackRequest', () => {
  it('accepts the four kinds', () => {
    expect(FEEDBACK_KINDS).toEqual(['idea', 'problem', 'question', 'other'])
    for (const kind of FEEDBACK_KINDS) {
      expect(feedbackRequest.safeParse({ ...ok, kind }).success).toBe(true)
    }
  })
  it('refuses another kind', () => {
    expect(feedbackRequest.safeParse({ ...ok, kind: 'praise' }).success).toBe(false)
  })
  it('trims the message and refuses one that is only whitespace', () => {
    expect(feedbackRequest.parse({ ...ok, message: '  hi  ' }).message).toBe('hi')
    expect(feedbackRequest.safeParse({ ...ok, message: '   ' }).success).toBe(false)
  })
  it('allows 5000 characters and refuses 5001', () => {
    expect(FEEDBACK_MESSAGE_MAX).toBe(5000)
    expect(feedbackRequest.safeParse({ ...ok, message: 'x'.repeat(5000) }).success).toBe(true)
    expect(feedbackRequest.safeParse({ ...ok, message: 'x'.repeat(5001) }).success).toBe(false)
  })
  it('wants a path, not a URL, of at most 512 characters', () => {
    expect(feedbackRequest.safeParse({ ...ok, page: 'https://console.fleetless.dev/robots' }).success).toBe(false)
    expect(feedbackRequest.safeParse({ ...ok, page: '/' + 'a'.repeat(511) }).success).toBe(true)
    expect(feedbackRequest.safeParse({ ...ok, page: '/' + 'a'.repeat(512) }).success).toBe(false)
  })
  it('is strict', () => {
    expect(feedbackRequest.safeParse({ ...ok, email: 'x@example.com' }).success).toBe(false)
  })
})

describe('feedbackResponse', () => {
  it('carries the id and the mail outcome', () => {
    expect(feedbackResponse.safeParse({ id: '6f1c1f0e-4b4a-4a8e-9b1a-1f0e4b4a4a8e', mail: 'not_configured' }).success).toBe(true)
    expect(feedbackResponse.safeParse({ id: 'nope', mail: 'sent' }).success).toBe(false)
  })
})

describe('POST /api/feedback', () => {
  it('is a rate-limited developer route answering 202', () => {
    const route = ROUTES.find((r) => r.method === 'POST' && r.path === '/api/feedback')
    expect(route).toMatchObject({ section: 'org', auth: 'developer', rateLimited: true, ownerTier: false, status: 202 })
    expect(route?.errors).toEqual(['unauthorized', 'token_expired', 'token_revoked', 'validation_error', 'rate_limited'])
  })
})
