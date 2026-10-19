// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  billingDocument,
  billingDocumentDetail,
  billingDocumentFileQuery,
  billingDocumentList,
} from '../src/billing.js'
import { ERROR_CODES, billingDocumentsUnavailableDetails } from '../src/errors.js'

const DOC_ID = '2f6a1e2a-6c2d-4a4b-9a2b-1c9f6d5e3a10'

const baseDoc = {
  id: DOC_ID,
  kind: 'invoice',
  status: 'open',
  number: 'RE-2026-0001',
  document_date: '2026-10-01T00:00:00Z',
  currency: 'EUR',
  gross_cents: 11900,
  file: 'available',
}

describe('billingDocumentList (fleetless/fleetless#544)', () => {
  it('available: false carries no documents and is complete', () => {
    expect(billingDocumentList.safeParse({ available: false, complete: true, unsupported_count: 0, documents: [] }).success).toBe(true)
  })
  it('available: false rejects a document', () => {
    expect(billingDocumentList.safeParse({ available: false, complete: true, unsupported_count: 0, documents: [baseDoc] }).success).toBe(false)
  })
  it('available: false rejects complete: false', () => {
    expect(billingDocumentList.safeParse({ available: false, complete: false, unsupported_count: 0, documents: [] }).success).toBe(false)
  })
  it('available: false rejects a nonzero unsupported_count', () => {
    expect(billingDocumentList.safeParse({ available: false, complete: true, unsupported_count: 1, documents: [] }).success).toBe(false)
  })
  it('available: true may carry documents and be incomplete', () => {
    expect(billingDocumentList.safeParse({ available: true, complete: false, unsupported_count: 2, documents: [baseDoc] }).success).toBe(true)
  })
})

describe('billingDocument', () => {
  it('parses a well-formed invoice', () => {
    expect(billingDocument.safeParse(baseDoc).success).toBe(true)
  })
  it('rejects a currency other than EUR', () => {
    expect(billingDocument.safeParse({ ...baseDoc, currency: 'USD' }).success).toBe(false)
  })
  it('rejects a non-integer gross_cents', () => {
    expect(billingDocument.safeParse({ ...baseDoc, gross_cents: 119.5 }).success).toBe(false)
  })
  it('rejects an extra key', () => {
    expect(billingDocument.safeParse({ ...baseDoc, extra: true }).success).toBe(false)
  })
  it('rejects an unknown status', () => {
    expect(billingDocument.safeParse({ ...baseDoc, status: 'draft' }).success).toBe(false)
  })
  it('rejects a non-uuid id', () => {
    expect(billingDocument.safeParse({ ...baseDoc, id: 'not-a-uuid' }).success).toBe(false)
  })
  it('requires an explicit UTC offset on document_date', () => {
    expect(billingDocument.safeParse({ ...baseDoc, document_date: '2026-10-01T00:00:00' }).success).toBe(false)
    expect(billingDocument.safeParse({ ...baseDoc, document_date: '2026-10-01T00:00:00+02:00' }).success).toBe(true)
  })
  it('number is nullable', () => {
    expect(billingDocument.safeParse({ ...baseDoc, number: null }).success).toBe(true)
  })

  describe('gross_cents signed by kind, never by the sign Lexware reports', () => {
    it.each(['credit_note', 'bookkeeping_credit_note'] as const)('%s accepts zero or negative, rejects positive', (kind) => {
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: -11900 }).success).toBe(true)
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: 0 }).success).toBe(true)
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: 11900 }).success).toBe(false)
    })
    it.each(['invoice', 'down_payment_invoice', 'bookkeeping_invoice'] as const)('%s accepts zero or positive, rejects negative', (kind) => {
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: 11900 }).success).toBe(true)
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: 0 }).success).toBe(true)
      expect(billingDocument.safeParse({ ...baseDoc, kind, gross_cents: -11900 }).success).toBe(false)
    })
  })
})

describe('billingDocumentDetail', () => {
  const noneDetail = { ...baseDoc, electronic_document_profile: 'NONE', formats: [{ format: 'pdf', role: 'document' }] }

  it('parses a well-formed NONE detail', () => {
    expect(billingDocumentDetail.safeParse(noneDetail).success).toBe(true)
  })
  it('rejects an extra key', () => {
    expect(billingDocumentDetail.safeParse({ ...noneDetail, extra: true }).success).toBe(false)
  })

  describe('gross_cents sign, enforced the same way as on billingDocument', () => {
    it.each(['credit_note', 'bookkeeping_credit_note'] as const)('%s accepts zero or negative, rejects positive', (kind) => {
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: -11900 }).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: 0 }).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: 11900 }).success).toBe(false)
    })
    it.each(['invoice', 'down_payment_invoice', 'bookkeeping_invoice'] as const)('%s accepts zero or positive, rejects negative', (kind) => {
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: 11900 }).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: 0 }).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, kind, gross_cents: -11900 }).success).toBe(false)
    })
  })

  describe('formats, fixed by electronic_document_profile', () => {
    it('NONE is exactly a plain pdf document, never an e_invoice or an xml entry', () => {
      expect(billingDocumentDetail.safeParse(noneDetail).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, formats: [{ format: 'pdf', role: 'e_invoice' }] }).success).toBe(false)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, formats: [{ format: 'xml', role: 'document' }] }).success).toBe(false)
      expect(billingDocumentDetail.safeParse({ ...noneDetail, formats: [] }).success).toBe(false)
    })
    it('EN16931 is exactly the pdf e_invoice', () => {
      const d = { ...noneDetail, electronic_document_profile: 'EN16931', formats: [{ format: 'pdf', role: 'e_invoice' }] }
      expect(billingDocumentDetail.safeParse(d).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...d, formats: [{ format: 'xml', role: 'e_invoice' }] }).success).toBe(false)
    })
    it('XRechnung is exactly the xml e_invoice plus the pdf preview, in that order', () => {
      const d = {
        ...noneDetail, electronic_document_profile: 'XRechnung',
        formats: [{ format: 'xml', role: 'e_invoice' }, { format: 'pdf', role: 'preview' }],
      }
      expect(billingDocumentDetail.safeParse(d).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...d, formats: [{ format: 'pdf', role: 'e_invoice' }, { format: 'xml', role: 'preview' }] }).success).toBe(false)
      expect(billingDocumentDetail.safeParse({ ...d, formats: [{ format: 'pdf', role: 'preview' }, { format: 'xml', role: 'e_invoice' }] }).success).toBe(false)
    })
    it('a null profile (a bookkeeping voucher) has no formats unless a file is available', () => {
      const unavailable = { ...noneDetail, electronic_document_profile: null, file: 'unavailable', formats: [] }
      expect(billingDocumentDetail.safeParse(unavailable).success).toBe(true)
      const available = { ...unavailable, file: 'available', formats: [{ format: 'pdf', role: 'document' }] }
      expect(billingDocumentDetail.safeParse(available).success).toBe(true)
      expect(billingDocumentDetail.safeParse({ ...unavailable, formats: [{ format: 'pdf', role: 'document' }] }).success).toBe(false)
      expect(billingDocumentDetail.safeParse({ ...available, formats: [] }).success).toBe(false)
    })
  })
})

describe('billingDocumentFileQuery', () => {
  it('defaults to pdf', () => {
    expect(billingDocumentFileQuery.parse({})).toEqual({ format: 'pdf' })
  })
  it('accepts xml', () => {
    expect(billingDocumentFileQuery.parse({ format: 'xml' })).toEqual({ format: 'xml' })
  })
  it('rejects an unknown format', () => {
    expect(billingDocumentFileQuery.safeParse({ format: 'zip' }).success).toBe(false)
  })
  it('rejects an extra key', () => {
    expect(billingDocumentFileQuery.safeParse({ format: 'pdf', extra: true }).success).toBe(false)
  })
})

describe('billingDocumentsUnavailableDetails', () => {
  it.each(['provider_unavailable', 'rate_limited', 'list_limit_exceeded', 'list_changed', 'unsupported_document', 'profile_mismatch'] as const)(
    'accepts reason %s',
    (reason) => {
      expect(billingDocumentsUnavailableDetails.safeParse({ reason }).success).toBe(true)
    },
  )
  it('rejects an unknown reason', () => {
    expect(billingDocumentsUnavailableDetails.safeParse({ reason: 'gremlins' }).success).toBe(false)
  })
})

describe('the error code', () => {
  it('billing_documents_unavailable is in the vocabulary', () => {
    expect(ERROR_CODES).toContain('billing_documents_unavailable')
  })
})
