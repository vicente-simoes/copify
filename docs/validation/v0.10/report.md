# Copify v0.10 Validation Report

**Status:** Automated release-candidate gates passed; manual external validation pending  
**Date:** 2026-08-24

## Environment

- Platform: Windows 11
- Development package version: 0.9.0 (held until manual validation)
- Electron: 43.4.0
- Rebrowser Playwright: 1.52.0
- IPC version: 14
- SQLite schema version: 12

## Automated Gates

- Typecheck: **Passed**
- Production build: **Passed**
- Built-app launch smoke with an isolated temporary profile: **Passed**
- Normal regression suite: **Passed — 108 tests**
- Profile-coherence resolver and launch-policy tests: **Passed**
- v11-to-v12 migration and warming persistence tests: **Passed**
- Local monitor integration suite: **Passed — 4 tests, 1 live test skipped**
- Chrome-backed direct-cart suite: **Passed — 6 tests**
- Chrome-backed human-input suite: **Passed — 2 tests**
- Native Stealth/coherence/profile-persistence suite: **Passed — 2 tests**
- Local top-level and cross-origin-frame 3DS fixtures: **Passed**
- Payment-handoff deduplication and sanitized event tests: **Passed**

## Security and Privacy Checks

- GeoIP preflight uses the assigned route without exposing proxy credentials to renderer contracts or events.
- Coherence events contain public route metadata and applied policy only.
- Warming persistence contains checklist state, public route identity, driver kind, and timestamps only.
- Browser-owned passwords, cookies, Shop Pay tokens, challenge URLs, iframe contents, and payment details are not extracted or persisted.
- Payment handoff events contain only category, phase, profile/run identifiers, and timing.

## Manual Release Gates

The following require the existing local DataImpulse account and interactive browser state and must pass before package versions are changed to 0.10.0:

- Direct and sticky DataImpulse PT profiles show internally consistent country, `pt-PT`, `Europe/Lisbon`, geolocation, and WebRTC policy.
- A warmed profile retains manually established Google/Shop/Shopify state after browser and app restart.
- Supreme monitoring plus sticky-route assisted checkout still reaches `READY_TO_CONFIRM` without submitting a purchase.
- A controlled PSD2/3DS handoff raises one Windows notification, focuses the affected Chrome session, highlights it on the Run board, and records a sanitized return event.

## Release Decision

The implementation is an automated-gate-complete release candidate. The 0.10.0 version bump, installer, commit, and tag remain intentionally gated on the four manual checks above.
