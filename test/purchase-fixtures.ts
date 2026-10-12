// SPDX-License-Identifier: Apache-2.0
export const operationKey = '0c15bc92-c26c-4a56-aac8-0046ff758391'
export const company = {
  kind: 'company', company_name: 'Acme Robotics', vat_id: 'NL123456789B01',
  address: { line1: 'Street 1', line2: null, postal_code: '1011AA', city: 'Amsterdam', country: 'NL' },
  invoice_email: 'billing@acme.example',
}
export const intentBase = {
  intent_id: '039172ce-712c-4ec8-897c-15492a7eeb76', operation_key: operationKey, operation: 'checkout',
}
export const pendingIntent = {
  ...intentBase, state: 'awaiting_vies', reason: 'vies_unavailable', next_attempt_at: '2026-10-12T08:00:00Z',
}
export const eligibleIntent = {
  ...intentBase, state: 'eligible', quote_revision: 'quote-2', buyer_fingerprint: 'buyer-2',
  quote: { currency: 'eur', net_cents: 14900, vat_cents: 0, gross_cents: 14900, rate_percent: 0 },
}
export const heldIntent = {
  ...intentBase, operation: 'mandate_setup', state: 'held', reason: 'mandate_policy_unresolved',
}
export const startedIntent = {
  ...intentBase, state: 'payment_started', payment_id: '88791f9a-fae3-4f4b-87c0-b204e45d6a90',
  payment: { kind: 'hosted', checkout_id: 'fa87ac72-a398-4b55-b343-993d4b297a29', checkout_url: 'https://checkout.example/pay/1' },
}
