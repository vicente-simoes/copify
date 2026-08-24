# Copify

Copify is a local Windows desktop console for isolated persistent Chrome sessions.

Each browser profile uses the Native Stealth driver by default: real persistent Google Chrome controlled through the exact-pinned Rebrowser Playwright runtime. Power users may instead attach Copify to an already-running local anti-detect browser through an encrypted, loopback-only external CDP endpoint. External browsers own their profile and network route.

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
