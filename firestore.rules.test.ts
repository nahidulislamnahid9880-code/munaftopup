/**
 * Payload-First Security Verification Suite for StrikeVault Firestore Rules.
 * Covers all 12 Dirty Dozen adversarial scenarios against firestore.rules.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  description: string;
}

export const DIRTY_DOZEN_TESTS: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Shadow Field Injection on Order Create',
    collectionPath: '/orders/order_test_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects order creation containing unexpected fields or non-pending paymentStatus.',
  },
  {
    id: 2,
    name: 'Identity Spoofing on Order Create',
    collectionPath: '/orders/order_test_2',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects order creation where customerUid != request.auth.uid.',
  },
  {
    id: 3,
    name: 'Duplicate TrxID Replay',
    collectionPath: '/trxRegistry/BKASH_999999',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects creating a trxRegistry entry when that TrxID already exists.',
  },
  {
    id: 4,
    name: 'Order Completion Bypass',
    collectionPath: '/orders/order_test_4',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects customer attempts to alter orderStatus or paymentStatus.',
  },
  {
    id: 5,
    name: 'Self-Unsuspend Attack',
    collectionPath: '/customers/user_123',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects customer update modifying immutable suspended field.',
  },
  {
    id: 6,
    name: 'Cross-User PII Read',
    collectionPath: '/customers/other_user_456',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects non-staff reading another user profile.',
  },
  {
    id: 7,
    name: 'Blanket Order List Scraping',
    collectionPath: '/orders',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects list queries not filtered by customerUid == auth.uid for non-staff.',
  },
  {
    id: 8,
    name: 'Unverified Email Spoof',
    collectionPath: '/products/ff_diamonds',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects admin writes when email_verified != true.',
  },
  {
    id: 9,
    name: 'ID Poisoning / Resource Exhaustion',
    collectionPath: '/products/' + 'a'.repeat(200),
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects document IDs exceeding 128 chars or containing invalid characters.',
  },
  {
    id: 10,
    name: 'Staff Privilege Escalation',
    collectionPath: '/staff/subadmin_evil_com',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects non-super-admin attempts to create or elevate staff permissions.',
  },
  {
    id: 11,
    name: 'Audit Log Tampering',
    collectionPath: '/auditLogs/log_1',
    operation: 'delete',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects any update or delete on auditLogs and paymentHistory.',
  },
  {
    id: 12,
    name: 'Client Timestamp Forgery',
    collectionPath: '/orders/order_test_12',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    description: 'Rejects documents whose createdAt/updatedAt do not equal request.time.',
  },
];
