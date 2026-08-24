# Copify v0.9 Validation Report

**Status:** Automated gates passed; manual validation pending  
**Date:** 2026-08-23

## Environment

- Windows version: Windows 11 25H2, build 26200.9168
- Chrome version: 122.0.6261.129
- Copify implementation candidate: v0.9 (workspace packages intentionally remain 0.7.0 until release approval)
- `@crawlee/http`: 3.18.1
- IPC version: 12
- SQLite schema version: 10

## Automated Gates

- Typecheck: **Passed**
- Production build: **Passed**
- Normal regression suite: **Passed — 86 tests**
- `test:monitor`: **Passed — 3 local HTTP/proxy/protection tests**
- `test:direct-cart`: **Passed — 2 Chrome-backed tests**
- `test:input`: **Passed — 2 Chrome-backed tests**
- v0.7 stealth suite: **Passed — 1 Chrome-backed test**
- Built monitor contains no Playwright/Rebrowser/Chrome-launch imports: **Passed**

## Monitor Checks

- Supreme minimum cadence: 60,000 ms
- JSON listing endpoint only: **Passed by local fixture and policy validation**
- Conditional `ETag`/`304` behavior: **Passed by local fixture**
- Direct connection with empty route selection: **Passed**
- Round-robin proxy selection and proxy tunnel fixture: **Passed**
- 403/429 stop-without-route-rotation and persistent circuit storage: **Passed**
- Manual Target test blocked during persisted cooldown and 60-second public cadence: **Passed by automated validation**

## Manual Checkout Gate

- Low-demand item: Pending
- Exact variant verified in cart: Pending
- Price and currency constraints preserved: Pending
- Reached `READY_TO_CONFIRM`: Pending
- Purchase submitted: **No**
- Screenshots: Pending

## Release Decision

Not yet releasable. The automated v0.9 gates pass, but the v0.8 manual gate and the v0.9 manual checkout gate above remain required. Do not update workspace versions to `0.9.0` until both are complete.
