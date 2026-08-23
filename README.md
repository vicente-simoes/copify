# Copify

Copify is a local Windows desktop console for isolated persistent Chrome sessions.

Each browser profile can use either Playwright launch or Native Chrome + local CDP attachment. Playwright launch is the default for new and existing profiles; Native CDP remains an opt-in option. Native CDP currently supports direct and unauthenticated-proxy routes only.

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
- Test a target once on the direct route, or attach it to a recorded run for a single shared direct monitor that checks the public listing every 15 seconds.
- In Observation mode, product detection is read-only: Copify records matching candidates and selected variants without navigating persistent sessions, carting products, or starting checkout.

- Observation runs stay read-only. Assisted Checkout runs require an explicit acknowledgement, can add an acceptable Supreme EU target to cart and fill an assigned encrypted shipping profile, then stop for manual payment and submission.
- Shipping/contact details are encrypted with Electron safeStorage, never returned after saving, and never persisted in run events or artifacts.
