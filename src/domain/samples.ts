import type { ApplicationCaseId, ProfileId } from '../shared/contracts';

export const samplePayloads: Record<Exclude<ProfileId, 'diacritics' | 'application'> | ApplicationCaseId, { title: string; description: string; json: string; applicationCaseId?: ApplicationCaseId; expectedBehavior?: string; observedBehavior?: string }> = {
  'es-toolkit-deburr': {
    title: 'Real upstream bug: combining marks survive cleanup',
    description: 'Public es-toolkit #1807 regression. Run affected and merged-fix code locally without a network or AI key.',
    applicationCaseId: 'es-toolkit-deburr',
    expectedBehavior: 'deburr removes combining marks while preserving printable ASCII text.',
    observedBehavior: 'The affected implementation leaves some combining marks in the result. The pinned merged fix removes them.',
    json: JSON.stringify({ text: 'a\u20dbb' }, null, 2),
  },
  'hermes-integer-coercion': {
    title: 'Real upstream bug: Hermes changes a large ID',
    description: 'Public regression case for Hermes Agent #55314. Run pinned application code locally; no model keys or message delivery are used.',
    applicationCaseId: 'hermes-integer-coercion',
    expectedBehavior: 'Hermes tool-argument coercion preserves each valid signed 64-bit integer chat ID exactly.',
    observedBehavior: 'The affected Hermes revision converts integer strings through float, silently changing the IDs before tool dispatch. This public case tests the unchanged application coercion entry point.',
    json: JSON.stringify({ calls: [{ chat_id: '1234567890123456789' }, { chat_id: '1234567890123456790' }] }, null, 2),
  },
  precision: {
    title: 'Two orders become one',
    description: 'Fictional customer data. Distinct long ID strings collapse after a JavaScript Number conversion.',
    json: JSON.stringify({
      customer: { name: 'Fictional Private Customer', email: 'maya@fictional-customer.example' },
      orders: [
        { orderId: '9007199254740992', tenantId: 'private-tenant-681', amount: 82.5, memo: 'Private order details alpha' },
        { orderId: '9007199254740993', tenantId: 'private-tenant-681', amount: 149.25, memo: 'Private order details beta' },
      ],
      enabled: true,
      cursor: null,
    }, null, 2),
  },
  unicode: {
    title: 'Distinct opaque keys merge',
    description: 'Fictional data. Two exact-string identifiers become equal after NFC normalization.',
    json: JSON.stringify({
      requester: { name: 'Fictional Confidential User', email: 'lee@fictional-client.example' },
      records: [
        { externalId: 'client-caf\u00e9-482', note: 'Private record alpha' },
        { externalId: 'client-cafe\u0301-482', note: 'Private record beta' },
      ],
    }, null, 2),
  },
  duplicates: {
    title: 'A webhook is delivered twice',
    description: 'Fictional data. A non-idempotent example handler processes the same event twice.',
    json: JSON.stringify({
      customerEmail: 'sam@fictional-shop.example',
      events: [
        { eventId: 'evt_private_8247', kind: 'payment.received', customerId: 'cust_private_791', amount: 65 },
        { eventId: 'evt_private_8247', kind: 'payment.received', customerId: 'cust_private_791', amount: 65 },
        { eventId: 'evt_private_8248', kind: 'payment.received', customerId: 'cust_private_791', amount: 92 },
      ],
    }, null, 2),
  },
};
