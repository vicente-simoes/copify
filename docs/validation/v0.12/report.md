# Copify v0.12 Validation Report

**Status:** Released; automated and installer gates passed, with one deferred manual budget exercise  
**Date:** 2026-08-26

## Environment

- Platform: Windows 11
- Package version: 0.12.0
- Electron: 43.4.0
- IPC version: 18
- SQLite schema version: 17

## Automated Gates

- Typecheck: **Passed**
- Production build: **Passed**
- Normal regression suite: **Passed — 158 tests; 17 intentionally gated tests skipped**
- Persistence suite: **Passed — 30 tests**
- Local monitor integration suite: **Passed — 4 tests; 1 live external test skipped**
- Chrome-backed direct-cart suite: **Passed — 6 tests**
- Chrome-backed human-input suite: **Passed — 2 tests**
- Native Stealth/profile-persistence/3DS suite: **Passed — 2 tests**

## v0.12 Cost and Reconciliation Validation

- Integer micro-USD arithmetic, decimal-GB conversion, period boundaries, and DST handling pass automated tests.
- Durable monitor/browser usage accounting, immutable deltas, source breakdowns, snapshotted rates, manual snapshots, CSV import normalization, duplicate-import idempotency, and traffic-only CSV overlap behavior pass automated tests.
- Budget period resets, threshold deduplication, and monitor-only hard-cap routing pass automated tests.
- The manual DataImpulse snapshot workflow survived an application restart and displayed **$0.7300 confirmed spend** and **$4.27 remaining credit** with `MANUAL_CONFIRMED` authority.
- Live low-budget Windows notification and monitor hard-cap testing was deliberately skipped by the operator. Automated tests cover the logic, but this external manual exercise remains deferred.

## Windows Installer Gate

- `Copify Setup 0.12.0.exe` NSIS installer: **Built successfully**
- Installed executable product version: **0.12.0.0**
- Installed application launch: **Passed — four Electron processes remained healthy through initialization**
- Production runtime dependency packaging: **Passed**
- Existing data-directory continuity: **Passed**
- Existing database migration: **Passed — schema 7 upgraded to schema 17**
- Preserved records observed after installed-app launch: **2 browser profiles and 13 runs**
- No v0.12 cost/snapshot/budget rows existed in that legacy database before migration, so preservation of those row types was not applicable to this specific installed-app upgrade sample; migration and persistence tests cover them.

During the installer gate, two release defects were found and corrected:

1. The root package entry now points to `apps/desktop/out/main/index.js`.
2. The packaged application now ships all external production dependencies and adopts the established `@copify/desktop` user-data root on first packaged launch when no packaged database exists.

## Security and Privacy Checks

- Cost records retain normalized usage and monetary aggregates only.
- Provider credentials, proxy secrets, URLs, headers, cookies, payment data, addresses, and raw imported CSV contents are excluded from renderer cost contracts and persisted cost rows.
- Confirmed and estimated spend remain separate authorities and are never added together.
- Budget hard caps affect new monitor requests only and do not stop or alter checkout browsers.

## Release Decision

v0.12 is concluded and tagged for release. The deferred live budget notification/hard-cap exercise is documented rather than represented as manually passed. Development may proceed to v0.13.
