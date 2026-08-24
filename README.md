# Copify

Copify is a local Windows desktop console for isolated persistent Chrome sessions.

Each browser profile uses the Native Stealth driver by default: real persistent Google Chrome controlled through the exact-pinned Rebrowser Playwright runtime. Power users may instead attach Copify to an already-running local anti-detect browser through an encrypted, loopback-only external CDP endpoint. External browsers own their profile and network route.

## v0.10

- Native Stealth resolves a route-aware GeoIP snapshot before Chrome starts, then fixes locale, `Accept-Language`, timezone, approximate geolocation, and WebRTC policy for the browser lifetime.
- Missing or contradictory identity fields are visible warnings and do not block assisted checkout. Rotating-residential checkout routes remain blocked because they cannot preserve IP affinity.
- Browser rows include a guided, fully manual warming workflow for the storefront, Google, and Shop/Shop Pay. Existing persistent Chrome state is reused; Copify never extracts account passwords, cookies, or session tokens.
- Warming readiness is isolated by browser and store, records per-step confirmation times, and requires review after its route or browser driver changes.
- Assisted checkout recognizes PSD2/SCA/3DS handoffs after `READY_TO_CONFIRM`, brings the affected Chrome forward once, highlights the session, and raises a Windows notification. Payment remains entirely manual.
- IPC contract version 14 and SQLite schema version 12 migrate the v0.9 database without replacing profiles, encrypted secrets, browser directories, runs, monitor settings, usage, or benchmarks.

## v0.9

- Supreme monitoring uses its supported storefront HTML and embedded product data while preserving conditional-cache behavior.
- DataImpulse metadata, rotating monitor routes, fixed sticky checkout routes, Turbo, type-aware route health, and monitor-only cooldowns are supported.
- Assisted checkout verifies the exact cart variant, fills the configured shipping form, accepts required terms, and stops at `READY_TO_CONFIRM` for manual payment.
- Monitor and browser traffic/cost aggregates are persisted without URLs, headers, cookies, bodies, checkout tokens, addresses, or payment data.

## v0.7

- Native Stealth removes Playwright's automation flag, adds `AutomationControlled` hardening, and refuses startup unless `navigator.webdriver === false`.
- Browser launch is isolated behind native-stealth and external-CDP drivers with explicit ownership and recording capabilities.
- Existing Playwright and Native CDP profile choices migrate to Native Stealth.
- External CDP endpoints are encrypted with Electron `safeStorage`, never returned to the renderer, and never logged.
- Run health records driver kind, browser version, and stealth verification status.
- `pnpm test:stealth` runs the opt-in local Chrome compatibility gate; `pnpm test:monitor` validates the local JSON monitor; `pnpm test:direct-cart` validates exact-variant carting; `pnpm test:stealth:live` records third-party validation evidence.

## v0.5

- Direct/home networking is the default; proxies are optional per browser profile.
- HTTP, HTTPS, and SOCKS5 proxy profiles support encrypted optional credentials.
- Test the direct route or a proxy to record public IP, location, latency, jitter, failures, stability, and a 0–100 quality score.
- Proxy credentials are only decrypted in Electron main immediately before runner launch and are never displayed or written to logs.

The default route probe is `https://ipwho.is/`. It can be replaced with an HTTPS endpoint returning compatible IP/geolocation JSON.

- Record stopped browser profiles as one local run and inspect each session's persisted event timeline afterward.
- Normal runs store sanitized navigation/network metadata and selected screenshots; Diagnostic adds trace and sanitized console output.
- Deep Debug requires explicit acknowledgement before writing local HAR and video, which can contain sensitive browser state.
- Ending a run finalizes recording without closing persistent Chrome sessions. Run records and artifacts remain until manually deleted.

- Add Supreme EU targets with ordered keyword, color, and size priorities plus a currency-aware maximum retail-price kill switch.
- Target setup offers a General preset for future store adapters and a Supreme EU preset with observed common apparel sizes (`Small` through `XXLarge`) and EUR pricing.
- General targets are retained as templates but cannot be tested or attached to runs until their store adapter is available.
- Test a target once, or attach it to a recorded run for a shared JSON-only HTTP monitor. Supreme enforces a 60-second minimum and opens a persistent global cooldown after 403, 429, or challenge responses.
- In Observation mode, product detection is read-only: Copify records matching candidates and selected variants without navigating persistent sessions, carting products, or starting checkout.

- Observation runs stay read-only. Assisted Checkout runs require an explicit acknowledgement, can add an acceptable Supreme EU target to cart and fill an assigned encrypted shipping profile, then stop for manual payment and submission.
- Shipping/contact details are encrypted with Electron safeStorage, never returned after saving, and never persisted in run events or artifacts.
