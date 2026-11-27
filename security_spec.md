# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Identity & Privilege Isolation**: Customers can never assign themselves admin/staff roles or modify `staff` documents. Only the bootstrapped Super Admin (`nahidulislamnahid9880@gmail.com`) can manage `staff` accounts and permissions.
2. **Duplicate TrxID Prevention**: Every order creation MUST atomically create both `/orders/{orderId}` and `/trxRegistry/{trxKey}` (and `/orderTracking/{orderNumber}`), failing if `trxRegistry/{trxKey}` already exists.
3. **Order Lifecycle Integrity**: Customers can only create orders with `paymentStatus == 'pending'` and `orderStatus == 'pending'`. Customers cannot approve payments, mark orders completed, or modify `adminNote`.
4. **PII Isolation**: `/orders`, `/customers`, `/tickets`, and `/notifications` are strictly scoped to the owning `customerUid` or authorized staff. Public tracking reads only `/orderTracking/{orderNumber}` via exact document `get` (no `list`).
5. **Suspension Enforcement**: Suspended customers (`customers/{uid}.suspended == true`) cannot create new orders or support tickets, and cannot un-suspend themselves.
6. **Append-Only Audit & Payment History**: `/auditLogs`, `/paymentHistory`, `/apiLogs`, and `/referralEvents` cannot be updated or deleted by clients.
7. **Voucher Vault Secrecy**: `/voucherStock` contains unredeemed PIN codes and is NEVER readable or writable by storefront customers; only authorized `products`/`orders` staff or server Admin SDK may inspect/claim PINs.
8. **Customer Reward & Tier Immutability**: Customers may update their own profile contact info and `savedUids`, but can NEVER self-modify `walletBalance` upwards, `tier`, `tierLocked`, `loyaltyPoints`, `referralCode`, `referredBy`, `referralRewarded`, or `totalSpent`.
9. **Promo & Flash Sale Integrity**: Only staff with `products` or `customization` permissions can create, update, or delete `/coupons` and `/flashSales`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Order Create**: Payload includes `"isAdmin": true` or `"paymentStatus": "verified"` on order creation -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Order Create**: Payload sets `customerUid` to another user's UID -> `PERMISSION_DENIED`.
3. **Duplicate TrxID Replay**: Second order reusing an existing `trxKey` in `/trxRegistry` -> `PERMISSION_DENIED` (document already exists).
4. **Order Completion Bypass**: Customer attempts to `update` `/orders/{orderId}` setting `orderStatus: "completed"` -> `PERMISSION_DENIED`.
5. **Self-Unsuspend Attack**: Suspended customer updates `/customers/{uid}` setting `suspended: false` -> `PERMISSION_DENIED`.
6. **Cross-User PII Read**: Authenticated non-admin customer attempts `get` on another user's `/orders/{otherOrderId}` or `/customers/{otherUid}` -> `PERMISSION_DENIED`.
7. **Blanket Order List Scraping**: Non-admin authenticated user runs `list` on `/orders` without `customerUid == auth.uid` filter -> `PERMISSION_DENIED`.
8. **Unverified Email Spoof**: Token with `email: "nahidulislamnahid9880@gmail.com"` and `email_verified: false` attempts admin write on `/products` -> `PERMISSION_DENIED`.
9. **ID Poisoning / Resource Exhaustion**: Write to `/products/{1500-char-id}` or string exceeding `maxLength` -> `PERMISSION_DENIED`.
10. **Staff Privilege Escalation**: Sub-admin with only `orders: true` attempts to create/modify `/staff/{id}` or `/settings/site` -> `PERMISSION_DENIED`.
11. **Audit Log Tampering**: Staff member attempts to `update` or `delete` an `/auditLogs/{logId}` entry -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: Order created with forged past `createdAt` not matching `request.time` -> `PERMISSION_DENIED`.
13. **Voucher Stock Enumeration**: Authenticated customer attempts `list` or `get` on `/voucherStock` -> `PERMISSION_DENIED`.
14. **Self-Tier / Points Inflation**: Customer attempts to `update` `/customers/{uid}` setting `tier: "reseller"` or `loyaltyPoints: 99999` -> `PERMISSION_DENIED`.
15. **Client Fraud / Referral Spoof**: Customer attempts `create` on `/referralEvents` or `/apiLogs` -> `PERMISSION_DENIED`.
