# Copify Proxy Architecture & DataImpulse Integration

## Purpose

This document captures the proxy-related decisions, implementation details, cost expectations, and monitor-settings requirements discussed for Copify.

It is based on the current Copify repository structure and the planned use of DataImpulse residential proxies.

---

## 1. Current Copify Architecture

Copify already has most of the proxy plumbing required.

The relevant flow is:

```text
Proxy configuration
    ↓
Encrypted local persistence
    ↓
BrowserProfile.proxyProfileId
    ↓
Electron main process resolves proxy credentials
    ↓
Runner receives RunnerProxy
    ↓
Playwright launches Chrome with proxy settings
    ↓
Copify verifies the public exit IP
```

There is also a separate path for the HTTP product monitor:

```text
Configured monitor proxy profiles
    ↓
Electron main process resolves credentials
    ↓
Monitor worker receives a route pool
    ↓
Crawlee / Undici sends HTTP requests through those proxies
```

This separation is useful because checkout browsers and the product monitor have different proxy requirements.

---

## 2. What Copify Already Supports

Copify already supports proxy profiles with:

- host
- port
- protocol
- username
- password
- expected country
- expected city
- enabled/disabled state
- assignment to individual browser profiles
- benchmarking
- route verification

The runtime proxy shape already contains everything needed by DataImpulse:

```ts
RunnerProxy {
  proxyProfileId
  proxyName
  protocol
  host
  port
  username
  password
  expectedCountry
  expectedCity
}
```

The browser runner converts that into Playwright format:

```ts
{
  server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
  username: proxy.username,
  password: proxy.password
}
```

and passes it to:

```ts
chromium.launchPersistentContext(...)
```

Therefore, DataImpulse does not require a new browser networking layer.

---

## 3. Credential Storage

Copify already handles proxy credentials appropriately.

Credentials are:

- entered in the Electron UI
- sent to the Electron main process
- encrypted using Electron `safeStorage`
- stored encrypted locally
- decrypted only when needed for launching a route

DataImpulse credentials should **not** be stored in:

- source code
- `.env` files committed to the repo
- JSON config files
- plaintext SQLite fields
- logs

The existing `safeStorage` design should remain.

---

## 4. DataImpulse Model

DataImpulse residential proxies are generally gateway-based.

The application connects to a gateway such as:

```text
gw.dataimpulse.com
```

using plan credentials:

```text
username: DATAIMPULSE_LOGIN
password: DATAIMPULSE_PASSWORD
```

Targeting and session behavior are encoded using the connection port and/or username parameters.

The important consequence is:

> Copify does not need to fetch or maintain a list of individual residential IP addresses.

DataImpulse's gateway is the abstraction Copify should use.

---

## 5. Recommended Proxy Strategy

The recommended design uses two proxy behaviors.

### Checkout/browser profiles

Use:

**Sticky residential proxies**

Reason:

A checkout browser maintains:

- cookies
- login state
- cart state
- storefront session state
- checkout state
- shipping state
- browser fingerprint and profile state

Changing its public IP during the session is undesirable.

Each browser should therefore have its own stable proxy route.

### HTTP product monitor

Use:

**Rotating residential proxy routing**

Reason:

The monitor is essentially stateless between scheduled JSON polls and does not need one persistent browser identity.

Rotation is more suitable for the monitor than for checkout sessions.

---

## 6. Recommended DataImpulse Browser Configuration

For Portuguese residential traffic, a DataImpulse username can include country targeting:

```text
DATAIMPULSE_LOGIN__cr.pt
```

For sticky browser routes, use a sticky port and a long TTL.

Example:

```text
Host:      gw.dataimpulse.com
Port:      10000
Protocol:  HTTP
Username:  DATAIMPULSE_LOGIN__cr.pt;sessttl.120
Password:  DATAIMPULSE_PASSWORD
Country:   PT
```

Then create one route per browser:

```text
PT Checkout 01 → port 10000
PT Checkout 02 → port 10001
PT Checkout 03 → port 10002
PT Checkout 04 → port 10003
```

Conceptually:

```text
Browser 01 → Sticky route 01 → Residential IP A
Browser 02 → Sticky route 02 → Residential IP B
Browser 03 → Sticky route 03 → Residential IP C
Browser 04 → Sticky route 04 → Residential IP D
```

The goal is to preserve the pairing:

```text
Chrome profile
+ cookies/session
+ network route
= one durable browser identity
```

---

## 7. Recommended DataImpulse Monitor Configuration

Create a separate rotating residential route.

Example:

```text
Name:      PT Monitor Rotating
Host:      gw.dataimpulse.com
Port:      823
Protocol:  HTTP
Username:  DATAIMPULSE_LOGIN__cr.pt
Password:  DATAIMPULSE_PASSWORD
Country:   PT
```

Do not use a sticky session identifier for this route if the intent is to rotate naturally between monitor requests.

Conceptually:

```text
Poll 1 → gateway → Residential IP A
Poll 2 → gateway → Residential IP B
Poll 3 → gateway → Residential IP C
```

Copify's monitor route pool can then use this route.

---

## 8. HTTP vs HTTPS Proxy Protocol

For Copify's DataImpulse configuration, use:

```text
Protocol: HTTP
```

This does **not** mean the destination storefront traffic is unencrypted.

HTTPS storefront traffic is tunneled through the HTTP proxy connection.

The effective Playwright configuration is conceptually:

```ts
chromium.launchPersistentContext(userDataDir, {
  proxy: {
    server: "http://gw.dataimpulse.com:10000",
    username: "DATAIMPULSE_LOGIN__cr.pt;sessttl.120",
    password: "DATAIMPULSE_PASSWORD"
  }
})
```

---

## 9. Route Verification and Benchmarking

Copify already has a useful route test system.

The route benchmark currently measures items such as:

- public IP
- country
- city
- connection latency
- median latency
- jitter
- failure rate
- IP stability
- overall quality score

Copify also verifies the live browser route against an HTTPS IP probe.

The current default probe is:

```text
https://ipwho.is/
```

For a sticky Portuguese route, the desired result is approximately:

```text
Country:   PT
IP stable: true
Status:    PASS
```

This should be used before assigning a proxy to a production browser profile.

---

## 10. Browser Assignment

Copify already supports choosing a route per browser profile.

Recommended mapping:

```text
Browser 01 → PT Checkout 01
Browser 02 → PT Checkout 02
Browser 03 → PT Checkout 03
Browser 04 → PT Checkout 04
```

The monitor should use the separate rotating route:

```text
HTTP monitor routes:
[x] PT Monitor Rotating
```

---

## 11. Recommended Initial Scale

The suggested starting configuration is:

```text
4 sticky residential checkout routes
1 rotating residential monitor route
```

This does **not** mean paying for five separately leased static residential IPs.

The important billing variable is traffic volume.

---

## 12. Expected DataImpulse Cost

The DataImpulse residential pricing discussed was approximately:

```text
$1 / GB
```

for standard residential traffic, with lower per-GB rates at much larger volume tiers.

A sensible starting purchase is approximately:

```text
$5 for 5 GB
```

or possibly:

```text
$20–50 of traffic
```

once Copify is being used more actively.

### Rough working estimates

| Usage level | Approximate traffic | Approximate cost |
|---|---:|---:|
| Development / testing | 2–5 GB | $2–5 |
| A few real drops | 10–25 GB | $10–25 |
| Fairly active usage | 25–50 GB | $25–50 |
| Heavy repeated usage | 100 GB | ~$100 |

These are directional estimates, not guarantees.

Actual usage will depend heavily on:

- browser page weight
- number of open profiles
- image loading
- cache effectiveness
- session duration
- monitor polling frequency
- monitor response size
- how often catalog data changes

---

## 13. Browser Bandwidth Expectations

A realistic browser session downloads:

- HTML
- JavaScript
- CSS
- images
- API responses
- checkout assets
- storefront assets

A broad planning estimate discussed was:

```text
100–400 MB per browser per active drop
```

For four browsers:

```text
4 × 100–400 MB
≈ 0.4–1.6 GB per drop
≈ $0.40–$1.60 at $1/GB
```

This is intentionally broad.

The only reliable number will come from measuring real Copify runs.

---

## 14. The Monitor Is the Main Bandwidth Risk

The current Supreme monitor manifest allows a minimum polling interval of:

```text
1,000 ms
```

That means a theoretical maximum of:

```text
3,600 requests/hour
86,400 requests/day
2,592,000 requests/month
```

if it ran continuously at one request per second.

If the full storefront product JSON were downloaded every time, bandwidth usage could become very expensive.

For example, if a response were 500 KB:

```text
500 KB × 3,600 requests/hour
≈ 1.8 GB/hour
≈ $1.80/hour at $1/GB
```

This is why monitor bandwidth has to be treated as a first-class system concern.

---

## 15. Existing Monitor Bandwidth Optimizations

Copify already implements important HTTP cache behavior.

The monitor stores and reuses:

- `ETag`
- `Last-Modified`

and sends conditional headers such as:

```http
If-None-Match
If-Modified-Since
```

It also handles:

```text
304 Not Modified
```

This can dramatically reduce bandwidth when the storefront has not changed.

This behavior should remain.

---

## 16. Monitor Operating Model & Drop-Window Fast Polling (Turbo Mode)

The monitor should not run at maximum drop frequency 24/7. Continuous sub-second polling outside of drop times wastes residential bandwidth ($1/GB) and generates unnecessary traffic.

### The Phased Operational Model:

```text
Normal Standby Period
    ↓ (Slow/Standby Polling: 2,000ms – 5,000ms)
Approaching Drop Window (e.g. T-2 minutes to 16:00:00)
    ↓
⚡ Activate Fast Polling / Drop Turbo (300ms – 500ms)
    │
    ├── Auto-Revert Safety Timer (Active for X minutes, user-configurable, default 5–10m)
    │   └── Reverts automatically to standby interval if drop concludes without a find
    │
    └── Target Detected & Carted
        ↓
    Stop Monitor (Assisted checkout browser runners take over)
```

### Auto-Revert Timer Protection:
To prevent users from accidentally leaving fast polling active and burning through residential proxy data, Copify provides a **Fast Polling Mode with Auto-Revert**:
- **Activation:** 1-click toggle in the UI or scheduled drop trigger.
- **Configurable Duration:** User configures active duration in settings (e.g., 5, 10, or 15 minutes).
- **Live Countdown Display:** The UI displays `⚡ Fast Polling Active: 04:32 remaining` so the operator always knows the current operational mode.
- **Safety Fallback:** When the timer expires, the monitor smoothly falls back to the configured standby interval (e.g., 2,000ms) without interrupting monitoring.

---

## 17. Monitor Settings Need to Become User-Controlled

The current implementation hard-codes too much monitor behavior.

The Settings page should eventually expose a dedicated:

```text
Monitor
```

or:

```text
Monitor behavior
```

section.

This should become a first-class subsystem rather than a few scattered constants.

---

## 18. Recommended Monitor Settings Structure

Suggested UI:

```text
Settings
└── Monitor
    ├── Polling Cadence
    │   ├── Standby poll interval (default 2,000ms)
    │   ├── Request timeout (default 10,000ms)
    │   └── Immediate first poll on start
    │
    ├── ⚡ Fast Polling / Drop Turbo
    │   ├── Fast poll interval (default 300ms–500ms)
    │   ├── Turbo duration (default 5–10 minutes; auto-revert timer)
    │   └── Auto-revert on timer expiration (preserves proxy bandwidth)
    │
    ├── Network & Proxy Pool
    │   ├── Proxy route pool
    │   ├── Route unhealthy cooldown (default 5 min)
    │   └── Rotate instantly on 403/429/challenge
    │
    └── Error handling & Resilience
        ├── Route-level 403 backoff (mark route unhealthy, rotate)
        ├── Route-level 429 backoff (mark route unhealthy, rotate)
        ├── Honor Retry-After per route
        ├── Service 503 backoff (short 5–15s storefront retry)
        └── Global pool exhaustion alarm (triggers only if ALL proxies fail)
```

---

## 19. User Settings vs Store Manifest Guidance

Store manifests provide recommended baseline settings and endpoint definitions (for example, Supreme EU standard catalog polling at 1,000 ms). However, the system must never enforce artificial UI blocks that prevent aggressive tuning during a live drop.

The user has full control to configure:

```text
300 ms
500 ms
1000 ms
2000 ms
```

The conceptual hierarchy is:

```text
Store manifest defaults (recommended baseline)
        ↓
Global monitor settings (user configured)
        ↓
Store-specific overrides
        ↓
Effective runtime policy (drop-calibrated)
```

---

## 20. Drop-Tuned Error Handling: Route-Level Rotation

In sneaker botting, error handling must be designed for maximum resilience during high-heat releases.

### The Problem with Global Cooldowns:
In a rotating residential pool, an HTTP 403 or 429 response almost always indicates that **a specific residential exit IP was challenged or rate-limited by Cloudflare/Akamai**, not that the entire storefront is offline. Triggering a global monitor shutdown or multi-minute app pause during a 30-second release window is fatal.

### Ruthless Proxy Rotation:

```text
Monitor Poll Request
       ↓
Proxy Route Returns 403 / 429 / Challenge
       ↓
Mark That Specific Route Unhealthy (e.g. 5-minute route cooldown)
       ↓
Instantly Rotate to Next Healthy Proxy in Pool (0ms delay)
       ↓
Continue Polling Without Interruption
```

### Specific Status Handling:

#### HTTP 403 (Forbidden)
- **Behavior:** The current exit IP is challenged.
- **Action:** Mark that specific route unhealthy for 5 minutes (`routes.markUnhealthy(route, Date.now() + 300_000)`).
- **Execution:** Immediately dispatch the next poll through the next available proxy in the pool. Never pause monitoring globally.

#### HTTP 429 (Rate Limited)
- **Behavior:** The current exit IP hit a threshold.
- **Action:** If `Retry-After` is present, mark the route unhealthy for that duration; otherwise, mark unhealthy for 5 minutes.
- **Execution:** Immediately rotate to the next proxy in the pool.

#### Storefront Challenge / CAPTCHA HTML
- **Behavior:** Cloudflare returned "Just a moment..." HTML instead of JSON.
- **Action:** Mark the route unhealthy for 5 minutes.
- **Execution:** Rotate to the next residential proxy in the pool.

#### HTTP 503 (Service Unavailable)
- **Behavior:** Storefront is temporarily re-deploying catalog or restarting upstream workers for a drop.
- **Action:** Brief storefront cooldown (5–15 seconds).
- **Execution:** Retry quickly so newly activated drop stock is detected the moment servers return.

#### `NO_HEALTHY_ROUTES` (Pool Exhaustion)
- **Behavior:** Every single proxy in the pool has been marked unhealthy.
- **Action:** Trigger global alert and notify user that proxy pool requires replenishment or reset.

---

## 21. Route Isolation vs Pool Health

Copify strictly maintains the distinction:

```text
Individual Route Failure (403, 429, challenge, timeout)
→ Isolate that route; rotate immediately to remaining healthy pool
```

vs:

```text
Pool-Wide Failure (all proxies exhausted)
→ Pause monitor; alert operator
```

Rotating through residential proxies is the primary, essential defense against localized IP challenges during a drop.

---

## 22. Suggested Persisted Monitor Settings Model

```ts
export const monitorSettingsSchema = z.object({
  proxyProfileIds: z.array(z.string().uuid()).max(50),

  pollIntervalMs: z.number()
    .int()
    .min(200)
    .max(60_000)
    .default(2_000),

  fastPollIntervalMs: z.number()
    .int()
    .min(200)
    .max(5_000)
    .default(500),

  fastPollDurationMinutes: z.number()
    .int()
    .min(1)
    .max(60)
    .default(5),

  requestTimeoutMs: z.number()
    .int()
    .min(1_000)
    .max(30_000)
    .default(10_000),

  routeUnhealthyMs: z.number()
    .int()
    .min(5_000)
    .max(30 * 60_000)
    .default(5 * 60_000),

  rotateOnProtection: z.boolean().default(true),

  serviceCooldownMs: z.number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),

  honorRetryAfter: z.boolean().default(true),
});
```

The current name `monitorNetworkSettings` would become too narrow once polling and error-handling behavior are included.

A better name would be:

```text
monitorSettings
```

---

## 23. Per-Store Overrides

Long-term, different stores will likely need different monitor behavior.

Example:

```text
Global defaults
Poll interval:          2 sec
Timeout:                10 sec
403 cooldown:           15 min
429:                    honor Retry-After
503 cooldown:           60 sec
Route cooldown:         5 min
```

Then:

```text
Supreme EU
Poll interval:          1 sec
Other settings:         inherit global defaults
```

Another retailer may use:

```text
Store B
Poll interval:          5 sec
503 cooldown:           2 min
```

Potential model:

```ts
type MonitorSettings = {
  defaults: MonitorBehavior;
  stores: Record<StoreId, Partial<MonitorBehavior>>;
};
```

---

## 24. Effective Policy Summary in the UI

The Settings page should show what the monitor will actually do after all constraints and overrides are resolved.

Example:

```text
Effective policy for Supreme EU

Poll every:         500 ms (drop window) / 1.0 s (standard)
Timeout:            10 s
403 / 429:          isolate route for 5m, rotate instantly
503:                retry after 10 s
Challenge:          isolate route for 5m, rotate to fresh residential IP
Pool Exhaustion:    pause and notify user if all routes fail
```

This is useful because a large number of independent settings quickly becomes difficult to reason about.

---

## 25. Proxy Bandwidth and Cost Visibility

Because DataImpulse is billed by bandwidth, Copify should expose traffic usage in the app.

Suggested runtime metrics:

```text
Monitor traffic this run:   42.7 MB
Requests:                   3,814
Average response:           11.2 KB
Estimated proxy cost:       $0.043
```

Useful additional totals:

```text
Browser traffic
Monitor traffic
Total proxy traffic
Estimated cost
Traffic by route
Traffic by run
Traffic by store
```

Copify already records monitor request count and bytes received, so monitor-side cost estimation is relatively straightforward.

Browser-side traffic accounting may require additional instrumentation.

---

## 26. Suggested Proxy Schema Improvements

Current provider options include providers such as:

```text
brightdata
decodo
oxylabs
custom
```

DataImpulse can currently work as:

```text
provider = custom
```

because the provider field does not control the actual network connection.

However, for cleaner metadata, add:

```text
dataimpulse
```

to the provider enum.

---

## 27. Add Rotating Residential Proxy Type

The current proxy types include concepts like:

```text
home
datacenter
residential-sticky
isp-static
```

There should also be:

```text
residential-rotating
```

This makes the monitor route accurately represent its behavior.

The network functionality does not depend on this field today, but the metadata and UI should still be truthful.

---

## 28. Future DataImpulse UX Improvement

A future DataImpulse-specific UI could generate the connection details automatically.

For example:

```text
Provider:       DataImpulse
Mode:           Sticky residential
Country:        PT
Session TTL:    120 minutes
```

Copify could derive:

```text
Host:       gw.dataimpulse.com
Port:       10000
Username:   LOGIN__cr.pt;sessttl.120
```

instead of requiring the user to manually remember provider syntax.

This is a UX improvement, not a requirement for the first integration.

---

## 29. Alternative Sticky Session Mechanism

DataImpulse also supports session IDs on the regular rotating endpoint.

Conceptually:

```text
LOGIN__cr.pt;sessid.copify01
```

This can provide temporary affinity to one exit IP.

However, for Copify checkout browser sessions, dedicated sticky ports with a long TTL are easier to reason about and better aligned with the persistent browser-profile model.

Preferred approach:

```text
sticky port
+
sessttl.120
```

---

## 30. Recommended Initial Implementation Plan

### Phase 1 — No major networking rewrite

Use the current proxy infrastructure.

Create:

```text
PT Checkout 01
PT Checkout 02
PT Checkout 03
PT Checkout 04
PT Monitor Rotating
```

Assign the checkout proxies one-to-one with browser profiles.

Assign the rotating proxy to the HTTP monitor route pool.

### Phase 2 — Small schema cleanup

Add:

```text
provider = dataimpulse
```

and:

```text
type = residential-rotating
```

### Phase 3 — Monitor settings

Add a full persisted monitor-settings subsystem controlling:

- polling interval
- timeout
- route cooldown
- 403 behavior
- 429 behavior
- Retry-After handling
- 503 behavior
- protection cooldowns
- proxy route selection

### Phase 4 — Per-store policies

Add:

- global defaults
- per-store overrides
- manifest-enforced minimums
- effective-policy display

### Phase 5 — Bandwidth and cost telemetry

Add:

- monitor MB used
- browser MB used
- estimated DataImpulse cost
- per-run usage
- per-route usage

---

## 31. Recommended Initial DataImpulse Setup

For four browsers:

```text
PT Checkout 01
gw.dataimpulse.com
10000
HTTP
LOGIN__cr.pt;sessttl.120
PASSWORD

PT Checkout 02
gw.dataimpulse.com
10001
HTTP
LOGIN__cr.pt;sessttl.120
PASSWORD

PT Checkout 03
gw.dataimpulse.com
10002
HTTP
LOGIN__cr.pt;sessttl.120
PASSWORD

PT Checkout 04
gw.dataimpulse.com
10003
HTTP
LOGIN__cr.pt;sessttl.120
PASSWORD
```

Monitor:

```text
PT Monitor Rotating
gw.dataimpulse.com
823
HTTP
LOGIN__cr.pt
PASSWORD
```

Assignments:

```text
Browser 01 → PT Checkout 01
Browser 02 → PT Checkout 02
Browser 03 → PT Checkout 03
Browser 04 → PT Checkout 04

HTTP monitor:
[x] PT Monitor Rotating
```

---

## 32. Core Design Principles

The proxy system follows these drop-hardened rules:

1. **Strict Separation:** 1:1 sticky residential routes for checkout browsers; rotating proxy pool for product monitors.
2. **Per-Route Circuit Breaker:** 403, 429, or challenge signals isolate the burnt route (5m cooldown) and rotate immediately to the next proxy in the pool.
3. **No Unnecessary Global Shutdowns:** Global cooldown pauses trigger only if *every* configured proxy in the pool is exhausted (`NO_HEALTHY_ROUTES`).
4. **User-Controlled Speed:** Manifests provide defaults; users can configure aggressive polling (e.g. 300ms–500ms) for high-heat drops.
5. **No Mid-Checkout IP Changes:** Checkout browsers retain their sticky IP, session cookies, and Google trust score from start to confirmation.
6. **Bandwidth Awareness:** Full ETag / 304 conditional cache support to save bandwidth on unchanged catalogs.
7. **Timed Fast-Polling Burst:** Fast drop polling includes a user-configurable duration safety timer (e.g. 5–10m) with automatic fallback to standby mode, preventing accidental long-term bandwidth consumption.
8. **Zero Plaintext Secrets:** Proxy credentials are encrypted using OS-backed secure storage (`safeStorage` / DPAPI) and never leaked to logs or renderer.

---

## 33. Immediate Next Steps

The practical next steps are:

```text
1. Create a small DataImpulse residential plan.
2. Add one sticky DataImpulse proxy profile to Copify.
3. Test it with Copify's route benchmark.
4. Open one browser using that proxy.
5. Confirm the verified public IP and country.
6. Add additional sticky routes for the other browser profiles.
7. Add one rotating residential route for the monitor.
8. Measure real traffic during development.
9. Add DataImpulse and residential-rotating to the Copify schema.
10. Build configurable monitor behavior into Settings.
```

The key conclusion is that Copify already has the core network wiring needed for DataImpulse. The remaining work is mostly configuration, clearer proxy metadata, monitor-policy controls, and bandwidth/cost observability.
