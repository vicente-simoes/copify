# Copify v0.13 Validation Report

**Status:** Packaged locally; automated and build gates passed, with installed-app and final cost-ledger smoke checks deferred  
**Date:** 2026-08-27

## Environment

- Platform: Windows 11 x64
- Package version: 0.13.0
- Electron: 43.4.0
- IPC version: 20
- SQLite schema version: 19

## Automated Gates

- Typecheck: **Passed**
- Production build: **Passed**
- Normal regression suite: **Passed — 173 tests; 28 intentionally gated integration/live tests skipped**
- Persistence and cost-ledger suite: **Passed — 33 tests**
- CAPTCHA provider adapter suite: **Passed — 7 tests**

## CAPTCHA Validation

- Local Harvester testing on the selected public CAPTCHA fixtures was manually accepted by the operator.
- CapSolver API solving was manually accepted for reCAPTCHA v2, reCAPTCHA v3, and Cloudflare Turnstile using reachable public fixtures.
- The official reCAPTCHA v3 result returned a successful backend verification and score.
- The official GeeTest v4 live fixture passed the opt-in live runner test.
- DataDome, AWS WAF, FunCaptcha, and GeeTest mappings and structured solution normalization pass adapter tests. Real-retailer validation remains deferred until corresponding store adapters are introduced.
- Solver credentials, raw responses, and acquired tokens remain excluded from renderer and persisted event payloads.

## Cost and Budget Validation

- A provider-reported CAPTCHA charge is projected exactly once from `CAPTCHA_TOKEN_ACQUIRED`; repeated validation/completion cost fields are not charged again.
- Unknown per-solve costs remain visible as unpriced solves and are excluded from spend totals and budgets.
- Independent proxy and CAPTCHA budget calculations, category/provider/kind breakdowns, legacy-budget migration, and alert-only CAPTCHA budget safety pass automated tests.
- A final packaged-app UI exercise of one paid solve updating the CAPTCHA cost card and budget remains deferred.

## Windows Package Gate

- `Copify Setup 0.13.0.exe` NSIS installer: **Built successfully**
- Unpacked executable file version: **0.13.0**
- Unpacked executable product version: **0.13.0.0**
- Product/company metadata: **Copify**
- Update manifest and block map: **Generated**
- Authenticode signature: **Not signed — no release certificate is configured**
- Installed application launch/upgrade smoke: **Deferred**

## Release Decision

The v0.13.0 source state is versioned and packaged locally. Publishing should wait until the installer is launched on a clean or representative machine and the final CAPTCHA cost-ledger smoke check is accepted. Commit, tag, and push are not part of this packaging operation.
