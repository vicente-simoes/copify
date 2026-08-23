# Copify v0.7 Stealth Validation Report

**Validation date:** 2026-08-23  
**Release result:** PASS  
**Platform:** Microsoft Windows 10.0.26200.9168 (Windows 11 build family)  
**Google Chrome:** 122.0.6261.129  
**Driver:** `rebrowser-playwright` 1.52.0, `NativeStealthDriver`

## Deterministic compatibility gate

| Check | Result | Evidence |
|---|---|---|
| Required hardened arguments | PASS | `AutomationControlled`, first-run suppression, and translation suppression asserted by unit tests |
| `--enable-automation` absent | PASS | Launch builder and built runner inspected; Playwright default argument is explicitly ignored |
| `navigator.webdriver === false` | PASS | Initial page, subsequent page, popup, and frame exercised in headed Chrome |
| Runtime serialization leak probe | PASS | Self-hosted `Error.stack`/console probe remained untouched |
| Persistent profile state | PASS | Persistent cookie survived a complete Chrome shutdown and relaunch |
| Standard Playwright fallback absent | PASS | Production output imports only `rebrowser-playwright` |
| Unit and migration suite | PASS | 60 tests passed; opt-in browser tests excluded from normal CI |
| Production build | PASS | Electron main, runner, monitor, preload, and renderer bundles built successfully |

Command: `pnpm test:stealth`

## Live evidence

| Check | Result | Notes |
|---|---|---|
| Official CreepJS deployment | PASS | `navigator.webdriver` was false; CreepJS reported 0% headless lies and 0% stealth lies. Its broader “like headless” heuristic reported 31%, which is retained in the screenshot rather than hidden. |
| Cloudflare Turnstile widget | PASS | Cloudflare's documented always-pass test sitekey produced a non-empty token and rendered Success without interaction. This validates widget compatibility, not the risk decision of a production storefront. |

- [CreepJS screenshot](./creepjs.png)
- [Turnstile test-widget screenshot](./turnstile-test-widget.png)

Command: `pnpm test:stealth:live`

## Scope and follow-up

The Native Stealth driver passed the v0.7 release gate on the machine above. External-CDP fingerprint quality remains the external provider's responsibility. A real storefront may still issue a managed challenge based on IP reputation, cookies, traffic, or account history; Copify must continue to hand those challenges to the user rather than treating this report as a guarantee of challenge-free checkout.
