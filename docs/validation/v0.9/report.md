# Copify v0.9 Validation Report

**Status:** Release gates passed
**Date:** 2026-08-24

## Environment

- Windows version: Windows 11 25H2, build 26200.9168
- Chrome version: 122.0.6261.129
- Copify version: 0.9.0
- `@crawlee/http`: 3.18.1
- IPC version: 13
- SQLite schema version: 11

## Automated Gates

- Typecheck: **Passed**
- Production build: **Passed**
- Normal regression suite: **Passed — 95 tests**
- Local monitor integration suite: **Passed**
- Chrome-backed direct-cart suite: **Passed — 6 tests**
- Chrome-backed human-input suite: **Passed — 2 tests**
- Native stealth and live Turnstile/CreepJS gates: **Passed**
- Supreme HTML monitor and conditional-cache fixtures: **Passed**
- Built monitor contains no Playwright/Rebrowser/Chrome-launch imports: **Passed**

## Manual Monitor and Checkout Gate

- Supreme HTML catalog fallback selected the exact Capital Hooded Sweatshirt variant: **Passed**
- Rotating DataImpulse monitor route remained independent from checkout browsers: **Passed**
- Sticky DataImpulse checkout route verified in Portugal: **Passed**
- Exact variant added and verified in the cart: **Passed**
- Price and currency constraints preserved: **Passed**
- Shipping autofill populated the complete checkout form: **Passed**
- Terms acknowledgement and `READY_TO_CONFIRM`: **Passed**
- Purchase submitted: **No**

## Traffic Accounting

- Browser route: 9,730,359 received bytes, 627,417 known sent bytes, 716 requests, partial measurement, estimated cost $0.010358.
- Monitor route: 65,313 received bytes, 492 known sent bytes, 1 request, partial measurement, estimated cost $0.000066.
- Credentials, URLs, headers, cookies, bodies, checkout tokens, shipping data, and payment data were not persisted in usage rows.

## Release Decision

Approved for the v0.9.0 release checkpoint. Monitoring, fixed-route assisted checkout, cart verification, complete shipping autofill, and network-usage accounting were validated without submitting a purchase.
