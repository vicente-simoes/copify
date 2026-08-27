# Copify — Product & Engineering Specification

**Document:** `spec.md`  
**Product:** Copify  
**Status:** Living specification — v0.14 implementation in progress; completion requires every acceptance gate below
**Primary platform:** Windows  
**Future platforms:** macOS, Linux  
**Date:** 2026-08-27

---

## 1. Product Summary

Copify is a local desktop application for preparing, orchestrating, observing, and reviewing multiple isolated browser sessions during limited-product releases.

The first target use case is Supreme drops running on Shopify infrastructure. The architecture must remain store-agnostic so additional Shopify and non-Shopify storefront adapters can be added later.

Copify is designed around four core ideas:

1. **Multiple persistent browser sessions**
   - Each session runs in its own real Chrome process.
   - Each session has its own persistent browser profile.
   - Each session may use its own fixed network route or configured proxy.
   - Browser state persists between application launches.

2. **Configurable checkout execution**
   - Copify supports both assisted checkout and Full Auto-Checkout (`FULL_AUTO`) on a per-session basis.
   - It may detect products, select configured variants, add products to cart, solve supported CAPTCHA challenges, fill checkout information, and submit an order when that session is configured for Full Auto-Checkout.
   - Human intervention is a dynamic fallback for interactive issuer verification and checkpoints that the configured automation path cannot complete.

3. **Run observability**
   - Every drop attempt is recorded as a structured `Run`.
   - Copify records state transitions, performance timings, failures, screenshots, sanitized network metadata, and optional Playwright traces.
   - Runs can be inspected and compared after the event.

4. **Evidence-driven optimization**
   - Copify should make it possible to determine why one session succeeded while another failed.
   - Proxy/network performance, page timings, product-detection timings, checkout timings, and browser failures must be measurable rather than guessed.

---

## 2. Product Goals

### 2.1 Primary goals

Copify should:

- Launch and manage multiple persistent Chrome sessions from one Windows desktop application.
- Keep every browser session isolated from the others.
- Allow each browser profile to use its own optional fixed proxy.
- Support persistent cookies, local storage, login state, and normal browser state.
- Let the user configure a target product, color priorities, size priorities, maximum retail price, and other target rules.
- Detect target products when they become available.
- React quickly and consistently across prepared sessions.
- Automatically select allowed product variants.
- Support assisted and fully automated add-to-cart, checkout, CAPTCHA resolution, and order submission.
- Pause and foreground the relevant browser when human intervention is required.
- Allow execution and CAPTCHA strategies to be compared per browser within the same run.
- Maintain a complete event timeline for every run.
- Provide post-run diagnostics and run comparison.
- Remain usable with no proxy at all.
- Support Windows first without preventing later macOS and Linux releases.

### 2.2 Secondary goals

Later versions may:

- Support multiple stores through adapters.
- Compare historical run performance.
- Recommend which browser profile or network route is most reliable.
- Provide aggregate metrics across drops.
- Export run reports.
- Support store-specific product parsers and checkout assistants.
- Support a companion browser extension if a future feature benefits from one.

---


## 4. Platform Strategy

### 4.1 Initial target

**Windows 11** is the first supported platform.

Windows is the initial development environment because:

- It is the user's primary desktop platform for drop execution.
- Chrome and Playwright are well supported.
- Electron gives a direct path to later macOS/Linux support.
- Windows provides a mature credential-protection mechanism through DPAPI, which Electron can access through `safeStorage`.

### 4.2 Future support

Planned order:

1. Windows
2. macOS
3. Linux

The application architecture must avoid Windows-only assumptions in core logic.

Platform-specific functionality must live behind abstractions.

Examples:

- secret storage
- filesystem paths
- browser executable discovery
- notifications
- auto-start behavior
- OS-specific window focus behavior

---

## 5. Technology Stack

The chosen initial stack is:

- **Electron** — desktop shell and OS integration.
- **React** — application UI.
- **TypeScript** — all application and orchestration code.
- **Node.js** — orchestration/runtime layer.
- **Playwright & `rebrowser-playwright` / `rebrowser-patches`** — hardened browser automation with CDP leak and `Runtime.enable` elimination.
- **`ghost-cursor`** — humanized Bezier mouse trajectory generation and natural input modeling.
- **Crawlee `HttpCrawler` + Undici `StandardHttpClient`** — decoupled, bandwidth-conscious storefront polling with proxy support, conditional requests, browser-standard HTTP headers, and a capability-driven multi-source discovery mesh.
- **Google Chrome** — headed persistent browser process.
- **SQLite** — local structured application data.
- **Electron `safeStorage`** — encryption/protection for stored secrets.

Supporting libraries in use:

- Zod for runtime validation and IPC contracts.
- Drizzle schema definitions over `node:sqlite`.
- Vitest for unit tests.

Deliberately **not** used:

- No UI state library. Component state plus IPC events proved sufficient; add one
  only when prop threading actually hurts.
- No component or icon library. The interface is a small set of local primitives
  and an inline 16px stroke icon set, so the app carries no design-system
  dependency and no unused bundle weight.

The application should avoid unnecessary cloud dependencies in v1.

Copify is a **local-first application**.

---

## 6. High-Level Architecture

```text
┌────────────────────────────────────────────────────┐
│                    Electron App                    │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │              React Renderer/UI               │  │
│  └──────────────────────┬───────────────────────┘  │
│                         │ IPC                      │
│  ┌──────────────────────▼───────────────────────┐  │
│  │              Electron Main Process           │  │
│  │                                              │  │
│  │  - Orchestrator                              │  │
│  │  - Run Manager                               │  │
│  │  - Target Manager                            │  │
│  │  - Proxy Manager                             │  │
│  │  - Proxy Health Watchdog                     │  │
│  │  - Secret Storage                            │  │
│  │  - SQLite                                    │  │
│  └──────────────────────┬───────────────────────┘  │
└─────────────────────────┼──────────────────────────┘
                          │ child-process IPC
                          │ JSON control plane + typed binary hot path
              ┌───────────┼───────────┬───────────┐
              │           │           │           │
              ▼           ▼           ▼           ▼
      HTTP Monitor    Runner A     Runner B     Runner C
     Discovery Mesh
                          │           │           │
                          ▼           ▼           ▼
                     Chrome A      Chrome B      Chrome C
                     Profile A     Profile B     Profile C
                     Network A     Network B     Network C
```

---

## 7. Browser Model

Copify will use **Model B: persistent browser processes**.

Each session uses a separate headed Chrome process with its own persistent profile directory.

Example:

```text
Chrome A
  profile = browser-profiles/home
  route   = home network

Chrome B
  profile = browser-profiles/pt-proxy-1
  route   = proxy profile A

Chrome C
  profile = browser-profiles/pt-proxy-2
  route   = proxy profile B
```

### 7.1 Why persistent browser processes

This model was selected because it provides:

- Real persistent cookies.
- Persistent local storage.
- Persistent cache.
- Easier manual intervention.
- Easier CAPTCHA/checkpoint handling.
- Visually inspectable headed Chrome windows.
- Stable browser preferences.
- Easy mapping between one browser profile and one network route.
- Strong crash/process isolation.
- Better post-run reasoning.

It uses more memory than ephemeral contexts, but the expected number of sessions is low enough that this is acceptable.

### 7.2 Session isolation

Every active browser session must have:

- Unique Chrome `userDataDir`.
- Unique Copify session ID.
- Unique Playwright connection.
- Its own network configuration.
- Its own state machine.
- Its own event stream.
- Its own run artifact directory.

No two concurrent persistent Chrome processes may use the same `userDataDir`.

### 7.3 Stealth browser driver & CDP leak elimination

Standard Playwright automation leaks critical bot signals (`--enable-automation`, `navigator.webdriver = true`, missing codec flags, and detectable `Runtime.enable` CDP side-effects in the JavaScript execution stack).

Copify adopts **hardened stealth driver principles**:

1. **Rebrowser Patches:** Integrates `rebrowser-patches` / `rebrowser-playwright` into the runner runtime to eliminate `Runtime.enable` leaks at the root level.
2. **Flag Sanitization:** Strips automation flags from Chrome launch arguments, enforcing `--disable-blink-features=AutomationControlled`, `--no-first-run`, `--no-default-browser-check`, and avoiding `--enable-automation`.
3. **Pluggable Driver Interface:**
   - **NativeStealthDriver (Default):** Real local Chrome / Chromium hardened via rebrowser patches with persistent local `userDataDir`. Zero external cost.
   - **AntiDetectDriver (Optional Power-User Extension):** Connects over CDP to external anti-detect daemons (AdsPower, GoLogin, Multilogin) for users with active anti-detect subscriptions.

---

## 8. Runner Process Model

Each browser runner should execute in a **separate Node child process**.

The Electron main process must not directly host all Playwright browser runners.

Reasons:

- Crash isolation.
- Independent session restart.
- Cleaner logs.
- Better resource accounting.
- Easier performance analysis.
- Reduced risk that a browser issue freezes the UI.
- Future ability to distribute runners if ever needed.

### 8.1 Runner responsibilities

A runner process is responsible for:

- Starting one persistent Chrome process with stealth hardening.
- Applying the assigned proxy configuration and coherent GeoIP environment.
- Navigating to the configured store and keeping session pre-warmed.
- Maintaining the browser profile and cookie state.
- Negotiating the hot-path IPC protocol and pre-registering static run/target metadata.
- Listening for versioned typed variant signals from the monitor.
- Rejecting duplicate, out-of-order, malformed, or incompatible hot-path frames.
- Running the store adapter with direct-cart and human-input capabilities.
- Producing structured events.
- Detecting checkpoints and 3DS payment handoffs.
- Resolving CAPTCHA challenges according to the session's snapshotted strategy.
- Filling and submitting payment when the session is configured for Full Auto-Checkout.
- Capturing allowed diagnostics.
- Responding to orchestrator commands.
- Clean shutdown.

### 8.2 Orchestrator responsibilities

The orchestrator is responsible for:

- Starting/stopping runners.
- Assigning profiles and coordinating proxy coherence.
- Reserving primary and ordered backup routes for selected profiles.
- Monitoring route health during monitoring and pre-warming.
- Coordinating session-only pre-checkout failover and same-profile relaunch.
- Managing the decoupled high-frequency HTTP monitor.
- Creating runs.
- Broadcasting exact `variantId` payloads over the typed hot path and non-critical metadata over the JSON control plane.
- Coordinating target execution.
- Managing the global purchase.
- Enforcing the active run's atomic checkout quota.
- Collecting events.
- Persisting run summaries.
- Controlling UI-visible state.
- Handling runner crashes and recovery.

### 8.3 Child-process event planes

Runner child-process isolation remains mandatory. IPC is split by workload:

- The **control plane** retains typed JSON messages for lifecycle, health,
  diagnostics, configuration, and infrequent metadata.
- The **hot path** uses a compact, versioned `Buffer` frame for variant detection
  and dispatch. Node child processes use advanced serialization so the frame is
  not repeatedly converted through JSON object graphs.

This is a **low-copy typed IPC** design, not literal zero-copy shared memory.
Worker threads, native shared-memory bridges, and any reduction in runner crash
isolation are out of scope. Protocol compatibility is negotiated before a runner
becomes ready; a version mismatch fails preflight rather than falling back during
a live drop.

---

## 9. Core Domain Concepts

The main entities are:

- `BrowserProfile`
- `ProxyProfile`
- `Target`
- `Run`
- `RunSession`
- `Runner`
- `StoreAdapter`
- `RunEvent`

---

## 10. Browser Profile Model

A `BrowserProfile` represents a persistent Chrome identity.

Suggested structure:

```ts
interface BrowserProfile {
  id: string;
  name: string;

  userDataDir: string;

  proxyProfileId?: string;
  backupProxyProfileIds: string[]; // ordered, unique, excludes proxyProfileId

  shippingProfileId?: string;
  paymentProfileId?: string;

  checkoutModeOverride:
    | "INHERIT_TARGET"
    | "ASSISTED"
    | "FULL_AUTO";

  captchaStrategyOverride:
    | "INHERIT_TARGET"
    | "MANUAL_HARVESTER"
    | "API_SOLVER"
    | "API_WITH_FALLBACK";

  enabled: boolean;

  createdAt: number;
  updatedAt: number;
}
```

The profile directory must never be committed to source control.

Default location should use Electron's application user data directory.

Example:

```text
%APPDATA%/Copify/browser-profiles/<profile-id>/
```

Future macOS/Linux paths should use Electron's platform-resolved application data directories.

Backup routes are candidates for a single warm/run session, not alternate saved
identities. Automatic failover never rewrites `proxyProfileId` or reorders
`backupProxyProfileIds`.

### 10.1 Profile warming & trust score farming

To avoid Cloudflare Turnstile and Shopify interactive CAPTCHAs on drop day, persistent profiles should be pre-conditioned ("warmed"):

- **Google Account Authentication:** Users can log into dedicated Google/Gmail accounts within each persistent profile, establishing high human trust scores ($\ge 0.9$ reCAPTCHA v3 / Turnstile pass rates).
- **Persistent Clearance Cookies:** Real browsing activity on the target storefront accumulates legitimate clearance tokens (`__cf_bm`, `cf_clearance`, `_shopify_s`).
- **Warm Profile Workflow:** The application provides a "Warm Profile" action allowing pre-drop manual or assisted browsing sessions without arming drop targets.

---

## 11. Proxy Model

A proxy is modeled independently from a browser profile.

```ts
interface ProxyProfile {
  id: string;

  name: string;

  provider:
    | "brightdata"
    | "decodo"
    | "oxylabs"
    | "custom";

  type:
    | "home"
    | "datacenter"
    | "residential-sticky"
    | "isp-static";

  protocol:
    | "http"
    | "https"
    | "socks5";

  host?: string;
  port?: number;

  usernameSecretId?: string;
  passwordSecretId?: string;

  expectedCountry?: string;
  expectedCity?: string;

  enabled: boolean;
}

type ProxyHealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

interface ProxyHealthSnapshot {
  proxyProfileId: string;
  status: ProxyHealthStatus;
  sampledAt: number;
  windowSize: number;
  consecutiveTimeouts: number;
  requestFailureRate: number;
  rollingLatencyMs: number | null;
  benchmarkBaselineMs: number | null;
  publicIp: string | null;
  country: string | null;
  reasonCode: string | null;
}

interface ProxyFailoverPolicy {
  enabled: boolean;
  consecutiveTimeoutLimit: 3;
  failureWindowSize: 10;
  unhealthyFailureRate: 0.5;
  latencyFloorMs: 1000;
  latencyBaselineMultiplier: 2.5;
}

interface ProxyFailoverState {
  browserProfileId: string;
  primaryProxyProfileId: string | null;
  activeProxyProfileId: string | null;
  attemptedBackupProxyProfileIds: string[];
  phase: "PRIMARY" | "FAILING_OVER" | "BACKUP" | "EXHAUSTED";
  changedAt: number;
}
```

These contracts are redacted renderer/run-event shapes. They never contain
proxy usernames, passwords, credential-bearing URLs, or provider session tokens.

### 11.1 Proxy behavior

For a single browser run:

- A browser profile gets one network route.
- The route should remain fixed for the lifetime of the session.
- Copify must not rotate proxy addresses mid-checkout.
- The application should prefer session stability over theoretical raw speed.

### 11.2 Runtime health watchdog and pre-checkout failover

Copify continuously evaluates route health while the HTTP monitor is polling and
while browser profiles are pre-warming. "Packet loss" means application-level
HTTPS request failure or timeout rate; Copify does not rely on ICMP, which many
proxy gateways do not expose. The watchdog combines passive monitor/navigation
telemetry with bounded, low-bandwidth pre-warm probes.

A route becomes `UNHEALTHY` by default when any of the following occurs:

- three consecutive request timeouts;
- at least 50% failures in the last ten samples; or
- three consecutive latency samples above both 1,000 ms and 2.5 times the
  route's benchmark baseline.

An exit-country mismatch or failed route verification also makes a backup
ineligible. Thresholds may become configurable, but a run snapshots them before
launch so settings cannot mutate active behavior.

The monitor may acquire another healthy monitor route independently. For a
headed browser, Chrome's launch-time proxy cannot be changed in place. Before
`VARIANT_SELECTED`, carting, or checkout, Copify may therefore:

1. reserve the next enabled, non-rotating, recently verified backup in the
   profile's ordered `backupProxyProfileIds` list;
2. close Chrome cleanly;
3. relaunch the same `userDataDir` on the backup route;
4. resolve and apply the backup route's GeoIP coherence;
5. verify the public route and reopen the storefront standby page; and
6. mark that backup active for the remainder of the session.

Copify must never open two Chrome processes against the same profile directory,
copy cookies between profiles, or mutate the profile's saved primary route. The
failover is session-only. Once variant execution starts, route affinity becomes
immutable: degradation produces an operator alert and diagnostic event, not an
automatic switch.

The discovery mesh leases monitor routes separately from browser routes. It
prefers a different healthy route for collection, sitemap, and predictive-search
requests, but route scarcity must not disable discovery: with one or two healthy
routes, sources reuse those routes deterministically. A candidate is hydrated on
the same route that discovered it. Source-specific `403`, `404`, `429`, malformed
payload, or unsupported-endpoint responses affect that source's route-scoped
health/backoff only; transport timeouts and connection failures continue to feed
the proxy watchdog.

Backup routes are pre-verified and connection-warmed, not concurrently opened in
Chrome. If every candidate is unavailable, unhealthy, country-incoherent,
already reserved by an incompatible active session, or rotating residential,
the session enters `EXHAUSTED` and remains stopped before checkout.

### 11.3 Provider-level sticky-session limits

Copify locks a browser profile to its resolved route for the lifetime of a
session and never intentionally changes that route during checkout. This is a
local application guarantee, not a guarantee that an external proxy provider
will retain the same exit IP indefinitely.

Residential providers, including DataImpulse, enforce their own server-side
sticky-session TTL. Depending on the provider plan and credentials, an exit IP
can be rotated automatically after roughly 30 to 120 minutes even while Copify
continues to use the same host, port, and credentials. That provider-forced
rotation can invalidate storefront cookies, carts, or payment sessions.

For long-running targets or drop queues, operators must configure the
provider's longest supported sticky window for the expected run duration, or
use a static ISP route. Copify blocks explicitly configured rotating
residential routes for assisted checkout, but it cannot extend or override a
provider TTL.

### 11.4 Recommended proxy categories

For persistent headed sessions, the preferred types are:

1. Home connection baseline.
2. Static ISP proxy.
3. Sticky residential proxy.

Datacenter proxies may be useful for development/testing but are not the preferred default for production drop sessions.

Mobile proxies are unnecessary for the initial product.

### 11.5 Initial proxy evaluation plan

The first practical benchmark should compare:

- Session A: normal home network.
- Session B: one Portuguese sticky residential route.
- Session C: one Portuguese static/ISP route.
- Session D: one non-Portuguese EU static/ISP candidate, initially Germany.

The Portuguese home route is the control, not an assumed inferior option. The
foreign-EU route is a hypothesis to measure, not a preferred production default.
Copify must not infer Shopify or store origin geography from a CDN/edge IP, proxy
country, community claim, or provider marketing. When practical, PT and DE ISP
candidates should come from the same provider and plan so country/routing is the
main changed variable.

Candidate reputable providers discussed:

- DataImpulse for the existing traffic-priced sticky-residential baseline.
- IPRoyal where matched PT and DE static/ISP trial inventory is available.
- Bright Data.
- Decodo.
- Oxylabs.

Provider branding must not be hardcoded into execution logic. All providers map to the generic `ProxyProfile` abstraction.

### 11.6 Profile-proxy coherence engine

Network and challenge systems may compare the public IP's GeoIP data against
client-side browser attributes. Copify enforces internal browser-route coherence:

1. **Timezone Emulation:** Sets Chrome timezone via `--timezone=<ResolvedTimezone>` and Playwright `timezoneId` (e.g., `"Europe/Lisbon"`).
2. **Locale & Language:** Sets `--lang=<Locale>` (e.g., `"pt-PT"`) and HTTP `Accept-Language` headers matching the proxy region.
3. **Geolocation Coordinates:** Overrides geolocation coordinates (`context.setGeolocation`) to match the proxy city/region.
4. **WebRTC Leak Prevention:** Launches Chrome with `--force-webrtc-ip-handling-policy=default_public_interface_only` to prevent local LAN IP leakage.
5. **Strict 1:1 Affinity:** A profile should not switch between disparate countries (e.g., PT to US) to prevent cookie invalidation.

Browser-route coherence is not a fraud-score guarantee. It does not make a
foreign IP equivalent to a Portuguese order, does not change card-issuer or
billing/shipping data, and does not claim to improve AVS. AVS compares submitted
billing details with issuer-held billing details; it does not require billing and
shipping addresses to be identical. Copify must report country mismatches
factually and must never describe timezone, locale, or geolocation emulation as a
way to erase them.

---

## 12. Proxy Benchmarking

Proxy quality must be measured by Copify instead of relying on community reputation.

The app should provide a **Test Proxy** action.

### 12.1 Generic benchmark

Record:

- Connectivity success.
- Public IP.
- Geolocation.
- Proxy protocol.
- HTTPS connectivity.
- Connection latency.
- Request latency.
- Failure rate.
- Jitter.
- IP stability.

Example output:

```text
Proxy: PT ISP 01

Connectivity        PASS
Public IP           185.x.x.x
Country             Portugal
City                Lisbon
Protocol            HTTP
Connect latency     31 ms
HTTPS median        182 ms
Failure rate        0.0%
Jitter              18 ms
Stable IP           YES
```

### 12.2 Store compatibility benchmark

A second benchmark should perform very low-frequency normal browser navigation to a selected storefront.

Record:

- DNS/connection timing where available.
- TTFB.
- document load timing.
- DOMContentLoaded.
- load event.
- status codes.
- navigation errors.
- TLS/network errors.

This is intentionally a normal compatibility/performance test, not aggressive probing.

### 12.3 Proxy scoring

Reliability should matter more than raw latency.

Suggested conceptual weighting:

```text
qualityScore =
    reliability * 0.50
  + latency     * 0.20
  + jitter      * 0.15
  + stability   * 0.15
```

Exact scoring may change after empirical testing.

---

## 13. Target Model

A `Target` defines what the user wants Copify to look for.

`storeId` is a free string validated against the store registry (section 15.1)
rather than an enum, so adding a store never changes this type.

```ts
interface Target {
  id: string;

  storeId: string;

  name: string;

  productKeywords: string[];
  negativeKeywords?: string[];

  directProductUrl?: string | null;

  preferredColors: string[];
  sizePriority: string[];

  maxRetailPrice: number;

  quantity: 1;

  checkoutMode: "ASSISTED" | "FULL_AUTO";

  captchaStrategy:
    | "INHERIT_APP"
    | "MANUAL_HARVESTER"
    | "API_SOLVER"
    | "API_WITH_FALLBACK";

  maxCheckouts: "UNLIMITED" | number;

  enabled: boolean;
}
```

`quantity` is fixed at 1 and is not user-editable. `maxCheckouts` controls how
many independent quantity-one orders the run may complete. A numeric value must
be an integer greater than or equal to 1; `UNLIMITED` allows all eligible
`FULL_AUTO` sessions to submit independently.

Existing and new targets default to `ASSISTED`, `INHERIT_APP`, and `UNLIMITED`.
Browser-profile overrides default to `INHERIT_TARGET`. The Run setup board may
apply ephemeral per-session overrides without mutating the saved Target or
Browser Profile.

`directProductUrl` is optional. When present, the monitor polls that canonical
product page directly and does not run catalog discovery for the Target. When it
is absent, the store adapter activates its supported discovery-source mesh. A
direct URL is an optimization and must never be required for a keyword Target
whose product has not been published yet. When supplied, it must be an absolute
HTTPS URL on a host allowed by the selected store manifest; the adapter owns
canonicalization and decides which store-specific query parameters are retained.

Example:

```json
{
  "name": "Supreme Nike Air Max 2001",
  "storeId": "supreme-eu",
  "productKeywords": [
    "Air Max 2001",
    "Air Ecstasy"
  ],
  "preferredColors": [
    "Black",
    "Red"
  ],
  "sizePriority": [
    "US 10",
    "US 9.5",
    "US 10.5"
  ],
  "maxRetailPrice": 190,
  "quantity": 1,
  "checkoutMode": "ASSISTED",
  "captchaStrategy": "INHERIT_APP",
  "maxCheckouts": "UNLIMITED",
  "enabled": true
}
```

### 13.1 Variant priority

Targets must support ordered fallback rules.

Example:

```text
Preferred colors:
1. Black
2. Red
3. White

Preferred sizes:
1. US 10
2. US 9.5
3. US 10.5
4. US 11
```

The engine chooses the highest-priority available acceptable variant.

---

## 14. Retail Price Kill Switch

Copify must never blindly purchase an unexpectedly expensive item.

Every target includes:

```ts
maxRetailPrice: number;
```

If:

```text
detectedRetailPrice > maxRetailPrice
```

the runner must stop automated progression and emit:

```text
PRICE_LIMIT_EXCEEDED
```

The UI should clearly show:

- detected price
- configured maximum
- whether the target is still armed

This links pre-drop resale analysis directly to execution logic.

---

## 15. Store Adapter Architecture

Copify must remain store-agnostic.

Store-specific behavior lives behind a common interface.

Suggested shape:

```ts
interface StoreAdapter {
  id: string;

  initialize(ctx: StoreContext): Promise<void>;

  locateProducts(target: Target): Promise<ProductCandidate[]>;

  readProduct(page: Page): Promise<Product>;

  getVariants(page: Page): Promise<Variant[]>;

  chooseVariant(
    page: Page,
    target: Target,
    variants: Variant[]
  ): Promise<Variant | null>;

  addToCart(page: Page, variant: Variant): Promise<void>;

  navigateToCheckout(page: Page): Promise<void>;

  fillAllowedCheckoutFields(
    page: Page,
    profile: ShippingProfile
  ): Promise<void>;

  detectCheckpoint(page: Page): Promise<CheckpointResult>;

  detectSuccess(page: Page): Promise<boolean>;
}
```

### 15.1 Store registry and capability manifest

An adapter interface alone is not enough, because the **user interface** also has
to know what a store can do. Without that, store knowledge leaks into the
renderer as `storeId === "supreme-eu"` branches and as prose explaining why a
button is disabled — which does not scale past a handful of stores.

Every store therefore declares a versioned manifest. Capability Manifest v2
uses discriminated descriptors so unsupported behavior carries a typed reason
instead of relying on a false boolean or a store-specific fallback:

```ts
type UnsupportedCapability = {
  supported: false;
  reasonCode: string;
  message: string;
};

type SupportedCapability<T> = {
  supported: true;
  config: T;
};

type StoreCapability<T> = SupportedCapability<T> | UnsupportedCapability;

type DiscoverySource =
  | "direct-product"
  | "collection"
  | "product-sitemap"
  | "predictive-search";

interface DiscoverySourceDescriptor {
  kind: DiscoverySource;
  handlerId: string;
  cadence: "active-interval" | "adaptive-sitemap";
  pathTemplate?: string;
  maxResponseBytes: number;
}

interface StoreManifest {
  manifestVersion: 2;
  id: string;                 // "supreme-eu"
  name: string;               // "Supreme"
  region: string | null;      // "EU"
  currency: StoreCurrency;
  status: "stable" | "beta" | "experimental" | "unsupported";

  capabilities: {
    monitoring: StoreCapability<{
      mode: "shared" | "in-browser";
      discoverySources: DiscoverySourceDescriptor[];
      hydrationHandlerId: string;
    }>;
    targeting: StoreCapability<{ modes: ("drop" | "raffle")[] }>;
    cart: StoreCapability<{ inspection: boolean; addToCart: boolean }>;
    checkout: StoreCapability<{
      autofill: boolean;
      modes: ("assisted" | "full-auto")[];
    }>;
    payments: StoreCapability<{
      methods: ("card" | "vcc" | "gateway-token" | "shop-pay")[];
    }>;
    releaseFeeds: StoreCapability<{ providers: string[] }>;
    raffle: StoreCapability<{
      entry: boolean;
      statusInspection: boolean;
    }>;
  };

  variants: {
    sizes: { kind: "enum"; values: string[] } | { kind: "freeform" };
    colors: { kind: "freeform" };
  };
}
```

Manifests are pure data and live in `packages/shared`, so the main process,
renderer, preflight, and runners use the same capability selectors. Adapter
implementations stay behind `StoreAdapter` and register handler IDs against the
capabilities they implement.

At startup, the registry validates that every supported capability has a
registered handler and that no handler claims a capability omitted by the
manifest. A mismatch disables that capability and emits a typed registry error;
it must not silently fall back to a hardcoded store branch.

The manifest is the single source of truth for store-specific UI:

| Question | Answered by |
|---|---|
| Can this target be monitored or tested? | `monitoring.supported` |
| Which public sources may discover it? | `monitoring.config.discoverySources` |
| Can a run use assisted checkout? | supported cart add + assisted checkout mode |
| Should a cart column exist? | supported cart inspection |
| Which payment paths can be configured? | `payments.config.methods` |
| Can Calendar import a provider feed? | `releaseFeeds.supported` |
| Can a raffle workflow render or dispatch? | supported raffle targeting + registered raffle handler |
| Size chips or a free-text field? | `variants.sizes.kind` |
| Which currency? | `currency` — derived, never asked |

A store with no adapter is an ordinary manifest whose capabilities are
unsupported with typed reasons rather than a special case. It renders through
the same path and exposes why each operation is unavailable.

Renderer visibility, IPC authorization, preflight eligibility, and runner
command dispatch must all call shared capability selectors. Direct comparisons
such as `storeId === "supreme-eu"` are prohibited outside manifest definitions,
adapter implementations, adapter fixtures, and registry tests. Future raffle
automation and alternate storefronts must enter through new capability
descriptors and registered handlers; Capability Manifest v2 does not itself
implement raffle entry automation.

Per-store enablement is persisted in `app_settings` and merged over the manifests
when they are read, so a store can be turned off without deleting its targets.

Brand art is resolved by id from `resources/brands/<storeId>.svg`, with the store
name as fallback. Adding a store's branding is dropping a file in that folder.

Initial adapters:

```text
StoreAdapter
   └── SupremeAdapter
```

Future:

```text
StoreAdapter
   ├── SupremeAdapter
   ├── GenericShopifyAdapter
   └── OtherStoreAdapter
```

---

## 16. Supreme Adapter

Supreme is the first supported store (`eu.supreme.com` for EU/Portugal).

The adapter operates through **headed Chromium** combined with direct-cart acceleration.

### 16.1 Supreme adapter responsibilities

- Navigate to the appropriate Supreme storefront.
- Support **Direct-Cart Flow** using `variantId`:
  - In-page `fetch('/cart/add.js')` within the pre-warmed browser tab (< 400ms).
  - Direct cart permalink fallback: `/cart/{variantId}:1`.
  - Fallback to standard product detail page (PDP) UI navigation.
- Detect product listing updates.
- Register collection, sitemap, predictive-search, and product-hydration handlers
  for the public sources its manifest advertises. Sitemap/search remain optional
  at runtime and may back off without disabling collection monitoring.
- Locate target products by robust product-name rules.
- Read product price and enforce retail limits.
- Read available colors and sizes.
- Apply target priority rules.
- Navigate to checkout.
- Fill shipping and payment information from the session's resolved encrypted profiles or utilize **Shop Pay 1-click checkout**.
- Detect checkout queues and waiting rooms.
- Detect and resolve CAPTCHA/Turnstile security checkpoints according to the session strategy.
- Detect European PSD2 / 3DS banking verification handoff points.
- Submit the final order automatically for `FULL_AUTO` sessions after all price, quota, and payment checks pass.
- Detect sold-out state.
- Detect order success.

### 16.2 Locator strategy

Prefer robust semantic selectors where possible.

Examples:

- role-based locators
- visible labels
- stable product text
- accessible names

Avoid fragile generated CSS selectors whenever possible.

### 16.3 Product matching

Product matching should support:

- positive keywords
- negative keywords
- normalized casing
- normalized whitespace
- aliases
- exact-match preference
- fuzzy match only when explicitly enabled

The app should log why a product matched.

### 16.4 Human input abstraction (Ghost-Cursor & Keystroke Simulation)

To prevent anti-bot behavioral detection (Akamai / Cloudflare Turnstile / DataDome):

1. **Bezier Mouse Movements (`ghost-cursor`):** Eliminates synthetic instant clicks. Mouse moves along curved Fitts's Law trajectories with `FAST_DROP` calibration (100–220ms duration) and natural CDP `mousedown`/`mouseup` dwell (40–75ms).
2. **Accelerated Human Keystrokes:** Simulates natural keystroke intervals (15–35ms per character with variance) on text inputs.
3. **Simulated Clipboard Paste (`Ctrl+V`):** Uses CDP keyboard shortcuts for instant, legitimate address field population without triggering synthetic input flags.
4. **Natural Scrolling:** Uses smooth wheel delta events rather than abrupt `scrollIntoView`.

---

## 17. Monitoring Strategy

Copify decouples storefront monitoring from browser automation.

A **decoupled HTTP monitor** performs high-frequency polling while persistent
headed browsers remain pre-warmed in standby. The current monitor uses
Crawlee's `HttpCrawler` with a custom Undici-backed `StandardHttpClient`. It
sends standard browser HTTP headers such as `User-Agent`, `Accept-Language`,
and client hints, but it does not currently impersonate TLS ClientHello
fingerprints (JA3/JA4), HTTP/2 SETTINGS, or HTTP/2 pseudo-header ordering.

```text
 ┌─────────────────────────────────────────────────────────────┐
 │ Decoupled HTTP Monitor (Crawlee + Undici StandardHttpClient)│
 │  • Browser-standard HTTP headers; no TLS/JA3/JA4 spoofing  │
 │  • Concurrent collection / sitemap / search discovery mesh │
 │  • Hydrates and verifies an exact Shopify `variantId`       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                VARIANT_SIGNAL_V1 (typed binary hot path)
              Metadata follows on the JSON control plane
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   Runner A (Pre-Warmed)   Runner B (Pre-Warmed)   Runner C (Pre-Warmed)
   Direct-Cart via         Direct-Cart via         Direct-Cart via
   `/cart/add.js`          `/cart/add.js`          `/cart/add.js`
```

### 17.1 Benefits:
- **Zero Headless Footprint:** Eliminates heavy headless Chrome polling, reducing memory usage and avoiding headless bot flags.
- **Sub-Second Reaction:** Browsers are already open on the storefront with cookies loaded, executing direct carting the instant `PRODUCT_DETECTED` arrives.
- **Resilience:** If storefront HTML changes slightly, the monitor still extracts raw JSON `variantId` payloads reliably.

### 17.2 Transport status and future migration

`got-scraping` is officially end-of-life. It may remain a transitive Crawlee
dependency, but Copify's current monitor transport does not import or use it
directly; its Undici implementation remains functional for ordinary storefront
collection and JSON/embedded-data parsing.

If a storefront enables a strict Cloudflare or equivalent bot mode that rejects
the monitor's Node TLS/HTTP fingerprint, replace the transport behind the
`StandardHttpClient` boundary with Apify's `impit` integration
(`@crawlee/impit-client`). That migration should add browser-grade TLS
ClientHello impersonation while preserving Copify's monitor policy, proxy,
redaction, response-size, and event contracts.

### 17.3 Multi-source Shopify discovery mesh

A Target with `directProductUrl` uses the lowest-bandwidth path: poll and parse
that product page only. A Target without one runs every due, manifest-supported
public discovery source concurrently:

1. collection HTML and its embedded product data;
2. Shopify product XML sitemap indexes/shards; and
3. predictive search at
   `/search/suggest.json?q=<encoded>&resources[type]=product`.

Collection and predictive search use the active monitor interval. Sitemap reads
use an adaptive cadence because XML indexes may be much larger: every 30 seconds
in standby and every 5 seconds in Turbo. When a sitemap read is due it launches
in the same batch as the other sources. Conditional requests, gzip, explicit
response-size limits, `ETag`, and `Last-Modified` validators minimize traffic.

```ts
interface DiscoveryCandidate {
  targetId: string;
  source: DiscoverySource;
  canonicalUrl: string;
  productHandle: string | null;
  titleHints: string[];
  modifiedAt: number | null;
  discoveredElapsedNs: bigint;
  routeId: string; // redacted local profile ID, never credentials
}

interface DiscoverySourceHealth {
  source: DiscoverySource;
  routeId: string;
  status: "AVAILABLE" | "BACKING_OFF" | "UNAVAILABLE";
  lastStatusClass: number | null;
  lastLatencyMs: number | null;
  backoffUntil: number | null;
  reasonCode: string | null;
}

interface DiscoveryMeshResult {
  targetId: string;
  sequence: number;
  winner: {
    source: DiscoverySource;
    routeId: string;
    variantId: string;
    priceMinor: bigint;
    verifiedElapsedNs: bigint;
  } | null;
  sourceHealth: DiscoverySourceHealth[];
}
```

Discovery does not equal selection. Sitemap and predictive-search rows are only
candidate locators; the adapter hydrates their canonical product page on the same
route. Collection data may satisfy hydration without another request only when
the adapter verifies that its embedded payload contains authoritative variant,
availability, and price data. Direct-product responses are already hydration
requests. Every path then applies the existing positive/negative keyword, color,
size, availability, and maximum-price rules. The first task to return a fully
hydrated, acceptable candidate wins a `Promise.any` race. A no-match task rejects
with an internal sentinel, while `Promise.allSettled` retains source diagnostics.
The first HTTP response or keyword-only match can never win.

After a winner, an `AbortController` cancels safe outstanding reads and a
per-target sequence plus canonical URL/handle deduplication guarantees exactly
one `VARIANT_SELECTED`. If no source wins, the monitor records the settled source
states and continues polling. One source failure never fails a mesh cycle while
another source can run.

Sitemap discovery first resolves `/sitemap.xml` when exposed and follows product
sitemap indexes including ranged or sharded URLs. The conventional
`/sitemap_products_1.xml` path is a supported fallback, not a hardcoded assumption;
manifests may declare a different path/template for nonstandard storefronts. The
parser extracts canonical URLs, handles, modification timestamps, and image
title/caption hints. The first successful read stores only a bounded hash baseline
and validators rather than hydrating the historical catalog; keyword-bearing
initial entries may be hydrated immediately. Later reads hydrate only new or
changed candidates.

Predictive search URL-encodes and probes at most the three highest-priority
positive phrases per Target. Its result is never treated as authoritative stock
or variant data. Predictive search does not guarantee a cache bypass, and both it
and sitemap access may vary by store, route, or protection mode. Each source is
eligible for normal polling on a route only after a successful runtime probe;
failed probes enter the monitor policy's bounded backoff and retry later. If
optional sources are blocked, collection polling remains active and Copify
surfaces a redacted warning rather than failing the monitor.

### 17.4 Typed low-copy monitor-to-runner hot path

Variant detection is the only latency-critical monitor broadcast. Static target
and session metadata is registered with each runner before it becomes ready, so
the runner does not wait for a large candidate object before direct carting.

```ts
interface VariantSignalFrameV1 {
  protocolVersion: 1;
  runHandle: number;
  targetHandle: number;
  sequence: number;
  detectedElapsedNs: bigint;
  variantId: string;       // encoded losslessly; Shopify IDs are not JS numbers
  priceMinor: bigint;
}
```

The shared IPC package owns one encoder, decoder, size limit, and protocol
negotiation contract. The frame is serialized as a compact `Buffer` using Node's
advanced child-process serialization. Product URL, human-readable variant data,
images, and diagnostics remain ordinary typed control-plane messages and may
arrive after the runner begins its direct-cart attempt.

Each runner tracks the last accepted sequence per target. Duplicate and
out-of-order frames are ignored and recorded; malformed or unsupported frames
fail closed. Worker versions negotiate before `SESSION_READY`, so a production
run cannot mix incompatible hot-path protocols. Literal shared-memory zero-copy
is explicitly out of scope because separate runner processes remain a stronger
reliability boundary.

---

## 18. Runner State Machine

Suggested initial states:

```ts
type RunnerState =
  | "OFFLINE"
  | "STARTING"
  | "READY"
  | "WATCHING"
  | "PRODUCT_FOUND"
  | "PRODUCT_OPEN"
  | "VARIANT_SELECTED"
  | "CARTING"
  | "CARTED"
  | "CHECKOUT"
  | "CAPTCHA_SOLVING"
  | "CHECKPOINT"
  | "READY_TO_CONFIRM"
  | "READY_TO_SUBMIT"
  | "SUBMITTING"
  | "SUBMITTED"
  | "CHECKOUT_LIMIT_REACHED"
  | "SUCCESS"
  | "SOLD_OUT"
  | "PRICE_LIMIT"
  | "ERROR"
  | "STOPPED";
```

Every transition must create a `RunEvent`.

---

## 19. Checkout Execution, CAPTCHA Resolution & Human Handoff

Every `RunSession` resolves and snapshots its own checkout and CAPTCHA behavior
before its runner starts. This permits Assisted and Full Auto-Checkout sessions,
or manual and API CAPTCHA strategies, to run side by side against the same Target.

Resolution order is deterministic:

```text
checkoutMode:
  Run-session override -> Browser Profile override -> Target default

captchaStrategy:
  Run-session override -> Browser Profile override -> Target default
  -> app captcha_settings when the Target uses INHERIT_APP

paymentProfileId:
  Run-session override -> Browser Profile assignment
```

The app setting maps `manual_only` to `MANUAL_HARVESTER`, `api_only` to
`API_SOLVER`, and `api_with_fallback` to `API_WITH_FALLBACK`. Run setup overrides
are ephemeral and never mutate the saved Target or Browser Profile.

### 19.1 Mode A: Local in-app Harvester

When the effective strategy is `MANUAL_HARVESTER`, the runner opens an on-demand,
prioritized headed Playwright page/window in the same persistent
`BrowserContext` as the challenged checkout. Electron coordinates status, focus,
and notifications; it does not create a separate cookie context. The Harvester
therefore retains the runner's warmed storefront and Google login state, which
maximizes legitimate one-click challenge passes.

The runner supports Cloudflare Turnstile, reCAPTCHA v2/v3, hCaptcha, DataDome
Slider/Interstitial, AWS WAF CAPTCHA, Arkose Labs FunCaptcha, and GeeTest v3/v4.
It observes provider callbacks, challenge configuration, clearance-cookie
completion, and response elements including:

```text
textarea[name="g-recaptcha-response"]
input[name="cf-turnstile-response"]
textarea[name="h-captcha-response"]
input[name="fc-token"]
input[name="geetest_validate"]
input[name="lot_number"]
```

When a non-empty solved response appears, the runner captures it only in memory,
injects it into the original challenged form or adapter payload, dispatches the
provider-compatible input/change callback sequence, closes or hides the
Harvester, and resumes checkout without copy-paste or a Resume click. The token
must never cross into renderer state or telemetry.

### 19.2 Mode B: Automated Solver API

`CaptchaSolver` is a pluggable runner-side interface:

```ts
interface CaptchaSolver {
  request(input: CaptchaChallenge): Promise<CaptchaSolveRequest>;
  poll(request: CaptchaSolveRequest): Promise<CaptchaSolveResult>;
  cancel?(request: CaptchaSolveRequest): Promise<void>;
  diagnose(): Promise<CaptchaProviderDiagnostic>;
}
```

Adapters are provided for CapSolver and compatible fast-token APIs. CapBypass,
NSLSolver, and custom endpoints use the same interface. A challenge extractor
collects the site key, target URL, challenge type, action/cData/chlPageData where
present, DataDome challenge URL plus matching route/user-agent, AWS WAF challenge
parameters, Arkose public key/blob/subdomain, and GeeTest v3/v4 configuration. It
submits an asynchronous request, polls within the configured SLA, and applies the
returned token, structured response fields, or clearance cookie directly to the
challenged browser context. DataDome must use the runner's existing proxy route;
it is never sent as a proxyless task.

Provider credentials are decrypted only for the request lifetime. Raw solver
requests/responses, tokens, credentials, and credential-bearing endpoints are not
persisted. The automated solve target is less than four seconds.

The built-in CapSolver adapter covers its currently documented DataDome, AWS WAF,
and GeeTest task contracts. Arkose Labs FunCaptcha remains available through the
Local Harvester and compatible custom providers; the CapSolver adapter returns a
typed `UNSUPPORTED_CHALLENGE` until CapSolver publishes an Arkose API contract.

### 19.3 Mode C: Dynamic failover

`API_WITH_FALLBACK` begins with the configured API solver and transfers the same
challenge to the Local Harvester when the timeout expires. The default threshold
is 5,000 ms. Provider errors, authentication failures, insufficient credit, and
an unavailable endpoint trigger immediate failover rather than waiting for the
threshold. Any outstanding API request is cancelled or its late result ignored.

`API_SOLVER` reports a typed failure instead of opening the Harvester;
`MANUAL_HARVESTER` never contacts a solver provider. Failover preserves the
original runner page, form state, and checkout quota eligibility.

### 19.4 Assisted and Full Auto-Checkout

An `ASSISTED` session reaches `READY_TO_CONFIRM`, foregrounds its headed checkout,
and waits for the operator to review and submit. A `FULL_AUTO` session reaches
`READY_TO_SUBMIT` and may submit through authenticated Shop Pay 1-click, a
gateway-token flow, or adapter-controlled form filling with its resolved Payment
Profile. Price limits and checkout quota checks execute immediately before the
irreversible submission action.

Frictionless, payment-provider-resolved 3DS proceeds automatically. If the issuer
presents an interactive OTP, biometric, bank-app, or other Strong Customer
Authentication challenge, the runner enters `CHECKPOINT`, pauses, foregrounds
the browser, and emits one deduplicated alert. After the user completes the issuer
challenge and presses **Resume**, the runner reevaluates the payment result and
continues in its original checkout mode.

### 19.5 Atomic multi-checkout quota

`maxCheckouts` is snapshotted on the Run. For a finite cap, the Orchestrator owns
an atomic quota of successful plus reserved submissions:

1. A `FULL_AUTO` session must reserve a slot immediately before submission.
2. A failed or rejected submission releases its reservation for the next ready session.
3. An accepted order converts its reservation into a success and receives the next one-based `order_index`.
4. When the successful-order cap is reached, all unreserved sessions are halted before payment submission in `CHECKOUT_LIMIT_REACHED`.

Reservations prevent concurrent sessions from overshooting a finite cap.
`UNLIMITED` bypasses quota serialization so every eligible `FULL_AUTO` session may
submit independently. Assisted sessions do not consume a slot until their final
submission begins.

---


## 21. Run Model

Every drop attempt is recorded as a `Run`.

Example:

```text
Run ID: 2026-08-27-supreme-airmax
Target: Supreme Nike Air Max 2001
Expected Drop: 16:00:00 Europe/Lisbon
Started: 15:58:00
App Version: 0.4.2
Build Commit: a71d82f
```

### 21.1 Run structure

```text
Run
 ├── metadata
 ├── target snapshot
 ├── application version
 ├── environment snapshot
 ├── Session A
 ├── Session B
 └── Session C
```

Each run must snapshot its configuration.

Historical runs must not depend on the current editable profile configuration.

The Run snapshot includes the resolved `maxCheckouts`. Each `RunSession` includes
its resolved `checkoutMode`, `captchaStrategy`, and payment-profile reference.
The reference is an ID and redacted display metadata only; no encrypted or
plaintext payment payload is copied into the Run snapshot.

```ts
type CheckoutMode = "ASSISTED" | "FULL_AUTO";
type CaptchaStrategy =
  | "MANUAL_HARVESTER"
  | "API_SOLVER"
  | "API_WITH_FALLBACK";

interface RunExecutionSnapshot {
  maxCheckouts: "UNLIMITED" | number;
}

interface RunSessionExecutionSnapshot {
  checkoutMode: CheckoutMode;
  captchaStrategy: CaptchaStrategy;
  paymentProfileId: string | null;
  paymentProfileLabel: string | null;
}

interface RunSessionOverride {
  browserProfileId: string;
  checkoutMode: "INHERIT_TARGET" | CheckoutMode;
  captchaStrategy:
    | "INHERIT_TARGET"
    | CaptchaStrategy;
  paymentProfileId?: string | null;
}
```

---

## 22. Run Event Model

Suggested event representation:

```ts
interface RunEvent {
  id: string;

  runId: string;
  sessionId: string;

  wallTimeMs: number;
  elapsedNs: string;

  type: string;

  stateBefore?: RunnerState;
  stateAfter?: RunnerState;

  payload?: Record<string, unknown>;
}

type CaptchaRunEventType =
  | "CAPTCHA_CHALLENGE_DETECTED"
  | "CAPTCHA_SOLVE_REQUESTED"
  | "CAPTCHA_TOKEN_ACQUIRED"
  | "CAPTCHA_FAILOVER_TRIGGERED";

type CheckoutRunEventType =
  | "PAYMENT_SUBMISSION_REQUESTED"
  | "PAYMENT_SUBMISSION_STARTED"
  | "PAYMENT_SUBMISSION_FAILED"
  | "INTERACTIVE_3DS_REQUIRED"
  | "CHECKOUT_SLOT_RESERVED"
  | "CHECKOUT_SLOT_RELEASED"
  | "CHECKOUT_LIMIT_REACHED"
  | "SUCCESS";

type ProxyRunEventType =
  | "PROXY_HEALTH_DEGRADED"
  | "PROXY_FAILOVER_STARTED"
  | "PROXY_FAILOVER_COMPLETED"
  | "PROXY_FAILOVER_EXHAUSTED"
  | "PROXY_FAILOVER_FAILED";

type IpcRunEventType =
  | "IPC_FRAME_REJECTED"
  | "IPC_SIGNAL_DUPLICATE";

type DiscoveryRunEventType =
  | "DISCOVERY_SOURCE_PROBED"
  | "DISCOVERY_SOURCE_UNAVAILABLE"
  | "DISCOVERY_CANDIDATE_FOUND"
  | "DISCOVERY_CANDIDATE_HYDRATED"
  | "DISCOVERY_MESH_WINNER";

type NewRunEventType =
  | CaptchaRunEventType
  | CheckoutRunEventType
  | ProxyRunEventType
  | IpcRunEventType
  | DiscoveryRunEventType;

interface CaptchaRunEventPayloads {
  CAPTCHA_CHALLENGE_DETECTED: {
    captchaKind: "turnstile" | "recaptcha_v2" | "recaptcha_v3" | "hcaptcha"
      | "datadome" | "aws_waf" | "funcaptcha" | "geetest_v3" | "geetest_v4";
    pageHost: string;
  };
  CAPTCHA_SOLVE_REQUESTED: {
    strategy: CaptchaStrategy;
    solverKind: "manual" | "api";
    providerKind: string | null;
  };
  CAPTCHA_TOKEN_ACQUIRED: CaptchaTokenAcquiredPayload;
  CAPTCHA_FAILOVER_TRIGGERED: {
    reason: "timeout" | "api_error" | "authentication_error" | "insufficient_credits" | "provider_unavailable";
    durationMs: number;
  };
}

interface CaptchaTokenAcquiredPayload {
  solverKind: "manual" | "api";
  durationMs: number;
  costMicrosUsd: number | null;
}

interface CheckoutRunEventPayloads {
  PAYMENT_SUBMISSION_REQUESTED: { checkoutMode: CheckoutMode; adapter: string };
  PAYMENT_SUBMISSION_STARTED: { checkoutMode: CheckoutMode; adapter: string };
  PAYMENT_SUBMISSION_FAILED: { code: RunnerErrorCode; durationMs: number };
  INTERACTIVE_3DS_REQUIRED: { category: "PSD2_3DS" };
  CHECKOUT_SLOT_RESERVED: { reservationId: string; reserved: number; succeeded: number; limit: number };
  CHECKOUT_SLOT_RELEASED: { reservationId: string; reserved: number; succeeded: number; limit: number };
  CHECKOUT_LIMIT_REACHED: { succeeded: number; limit: number };
  SUCCESS: { order_index: number; submissionDurationMs: number };
}

interface ProxyRunEventPayloads {
  PROXY_HEALTH_DEGRADED: {
    proxyProfileId: string;
    status: ProxyHealthStatus;
    reasonCode: string;
  };
  PROXY_FAILOVER_STARTED: {
    fromProxyProfileId: string;
    toProxyProfileId: string;
    attempt: number;
  };
  PROXY_FAILOVER_COMPLETED: {
    activeProxyProfileId: string;
    durationMs: number;
  };
  PROXY_FAILOVER_EXHAUSTED: { attempted: number; reasonCode: string };
  PROXY_FAILOVER_FAILED: { proxyProfileId: string; reasonCode: string };
}

interface IpcRunEventPayloads {
  IPC_FRAME_REJECTED: { protocolVersion: number | null; reasonCode: string };
  IPC_SIGNAL_DUPLICATE: { targetHandle: number; sequence: number };
}

interface DiscoveryRunEventPayloads {
  DISCOVERY_SOURCE_PROBED: {
    source: DiscoverySource;
    routeId: string;
    statusClass: number | null;
    durationMs: number;
    responseBytes: number;
    candidateCount: number;
  };
  DISCOVERY_SOURCE_UNAVAILABLE: {
    source: DiscoverySource;
    routeId: string;
    reasonCode: string;
    backoffUntil: number | null;
  };
  DISCOVERY_CANDIDATE_FOUND: {
    source: DiscoverySource;
    routeId: string;
    candidateKey: string;
  };
  DISCOVERY_CANDIDATE_HYDRATED: {
    source: DiscoverySource;
    routeId: string;
    candidateKey: string;
    accepted: boolean;
    durationMs: number;
  };
  DISCOVERY_MESH_WINNER: {
    source: DiscoverySource;
    routeId: string;
    sequence: number;
    verifiedElapsedNs: string;
  };
}

type NewRunEventPayloads =
  & CaptchaRunEventPayloads
  & CheckoutRunEventPayloads
  & ProxyRunEventPayloads
  & IpcRunEventPayloads
  & DiscoveryRunEventPayloads;
type TypedRunEvent<K extends keyof NewRunEventPayloads> =
  Omit<RunEvent, "type" | "payload"> & {
    type: K;
    payload: NewRunEventPayloads[K];
  };
```

`CAPTCHA_CHALLENGE_DETECTED` records the challenge kind and sanitized page host.
`CAPTCHA_SOLVE_REQUESTED` records the resolved strategy and provider kind.
`CAPTCHA_FAILOVER_TRIGGERED` records `timeout`, `api_error`,
`authentication_error`, `insufficient_credits`, or `provider_unavailable` and the
elapsed time. `CAPTCHA_TOKEN_ACQUIRED` uses a cost of `0` for a manual solve and
`null` when an API cannot report or derive a per-solve cost. It never contains the
token.

Checkout slot events record the anonymous reservation and quota counts. A
`SUCCESS` event for an accepted order includes one-based `order_index`. Payment
events contain only mode, adapter, timing, status class, and sanitized error code;
they never contain payment values, gateway tokens, or provider payloads.

Proxy events contain only profile IDs, redacted status/reason codes, attempt
counts, and duration. IPC events contain protocol/sequence diagnostics only.
Discovery events contain source, redacted route ID, timing, byte count, status
class, candidate count, and an opaque candidate key; they exclude complete
sitemap/search bodies and raw search queries. None of these event families may
contain proxy credentials, provider session tokens, variant payload buffers,
payment data, cookies, or checkout tokens.

Example NDJSON:

```json
{"t":0,"event":"RUNNER_STARTED"}
{"t":623,"event":"BROWSER_READY"}
{"t":1842,"event":"STORE_LOADED"}
{"t":119842,"event":"DROP_TIME"}
{"t":119921,"event":"PRODUCT_DETECTED"}
{"t":120073,"event":"PRODUCT_OPEN"}
{"t":120324,"event":"VARIANT_SELECTED","size":"US 10"}
{"t":120617,"event":"ADD_TO_CART"}
{"t":120844,"event":"CART_CONFIRMED"}
{"t":121202,"event":"CHECKOUT_OPEN"}
{"t":122887,"event":"CHECKPOINT_DETECTED"}
{"t":123004,"event":"CAPTCHA_CHALLENGE_DETECTED","captchaKind":"turnstile"}
{"t":123021,"event":"CAPTCHA_SOLVE_REQUESTED","solverKind":"api"}
{"t":126402,"event":"CAPTCHA_TOKEN_ACQUIRED","solverKind":"api","durationMs":3381,"costMicrosUsd":1200}
```

---

## 23. Timing

Accurate relative timing is crucial.

Copify should record both:

- wall-clock timestamps
- monotonic elapsed time

Do not depend only on `Date.now()`.

Example:

```ts
const runStartedWall = Date.now();
const runStartedMono = process.hrtime.bigint();

function getTimestamp() {
  return {
    wallTimeMs: Date.now(),
    elapsedNs: (
      process.hrtime.bigint() - runStartedMono
    ).toString()
  };
}
```

This protects timing analysis from system clock adjustments.

The monitor stamps `VariantSignalFrameV1.detectedElapsedNs` before dispatch and
the runner records receipt before decoding non-critical metadata. This creates a
separate `monitor_signal_to_runner_receipt_ns` measurement that excludes browser,
storefront, and proxy latency. Main-process fan-out preserves the originating
timestamp and sequence number.

---

## 24. Run Artifacts

Suggested filesystem layout:

```text
runs/
└── 2026-08-27-supreme-airmax/
    ├── run.json
    ├── target.json
    ├── summary.json
    │
    ├── home/
    │   ├── events.ndjson
    │   ├── network.ndjson
    │   ├── console.ndjson
    │   ├── summary.json
    │   ├── trace.zip
    │   └── screenshots/
    │
    ├── proxy-1/
    │   └── ...
    │
    └── proxy-2/
        └── ...
```

Sensitive artifacts must not be stored by default.

---

## 25. Diagnostics & Observability

Run inspection is a first-class product feature.

The application should eventually answer questions such as:

- Which session detected the product first?
- Which session loaded the product page fastest?
- Which session added to cart fastest?
- Which network route had the best TTFB?
- Which route returned the most HTTP errors?
- Did a runner fail because of an application bug?
- Was the target sold out before checkout was reached?
- Did a checkpoint cost the run?
- Did one proxy show high jitter?
- Was the wrong size selected?
- Was the price limit triggered?
- Did the site's DOM change?
- Did the browser crash?
- Was the user intervention too slow?
- Which CAPTCHA strategy solved fastest, failed over, or cost the least?
- Did Full Auto-Checkout reduce submission latency without exceeding the checkout cap?
- Which session checkout mode and CAPTCHA strategy produced the accepted order?
- Which discovery source found the selected product first, and which optional
  sources were unavailable or backing off?
- How many bytes and how much latency did each discovery source consume?
- Which application version performed better?

---

## 26. Playwright Tracing

Playwright tracing should be supported in diagnostic mode.

When enabled:

```ts
await context.tracing.start({
  screenshots: true,
  snapshots: true,
  sources: true,
  title: runId
});
```

At run end:

```ts
await context.tracing.stop({
  path: tracePath
});
```

This allows post-run inspection using Playwright Trace Viewer.

Traces may contain sensitive state and must be handled accordingly.

---

## 27. Network Recording

Copify should not blindly save full raw network traffic for real purchases.

Default production mode should record **sanitized metadata**.

Example:

```json
{
  "elapsedMs": 120733,
  "method": "POST",
  "host": "example-store.com",
  "pathClass": "cart",
  "status": 200,
  "resourceType": "fetch",
  "durationMs": 182
}
```

Do not persist by default:

- authorization headers
- cookies
- checkout tokens
- CAPTCHA response tokens
- solver API credentials or raw solver payloads
- card data, CVV, and payment gateway tokens
- raw request bodies
- raw response bodies
- addresses
- payment information

Full HAR capture may exist only in explicit deep-debug mode and should be used primarily on test or non-sensitive runs.

---

## 28. Diagnostic Levels

Copify should expose three recording profiles.

### 28.1 Normal

For real drops.

Record:

- structured run events
- state transitions
- sanitized timing metadata
- network errors
- HTTP status summaries
- public network identity metadata
- selected screenshots
- aggregate browser performance

Avoid sensitive recording.

### 28.2 Diagnostic

Adds:

- Playwright trace
- DOM snapshots
- console output
- additional screenshots
- richer network metadata

Sensitive recording must stop before decrypted payment material is injected and
remain stopped until the payment surface is left, regardless of whether the
session is Assisted or Full Auto-Checkout.

### 28.3 Deep Debug

For development/test stores and low-risk testing.

May include:

- complete HAR
- full trace
- video
- detailed network information

The UI should display a warning before enabling Deep Debug.

---

## 29. Run Inspector

The Run Inspector is a major differentiating feature.

### 29.1 Timeline view

A horizontal timeline should show:

```text
DROP ─ Product Found ─ Variant ─ ATC ─ Checkout ─ Checkpoint ─ Success
```

One row per session.

Example:

```text
HOME       │─92ms─│─311ms─│────802ms────│ CHECKPOINT
PT ISP 01  │─141ms│─274ms─│──693ms──│ SUCCESS
PT RES 01  │─217ms│─528ms─│────1281ms────│ SOLD OUT
```

### 29.2 Session detail

Selecting a session should show:

- browser profile
- proxy/network route
- public IP
- latency benchmark
- target variant
- full state timeline
- console errors
- navigation errors
- HTTP failure summary
- screenshot strip
- trace link
- final result

The monitor summary above the session rows shows the discovery mesh independently
from browser execution: active and unavailable sources, assigned monitor routes,
per-source latency/bytes/candidate count, backoff reason, and the source and
verification time that produced the winning variant. All route identifiers are
redacted local profile IDs.

### 29.3 Comparison view

Allow side-by-side comparison of:

- product detection
- page load
- variant selection
- add-to-cart
- checkout start
- checkpoint
- total execution time

### 29.4 Historical comparison

Later versions should support:

```text
Profile PT-ISP-01
Last 20 runs

Median product-page load    411 ms
Median ATC                   302 ms
Checkout success             94%
Network error rate           0.6%
Checkpoint rate              18%
```

This converts drop execution into measurable engineering data.

---

## 30. Security

Security is a core requirement.

### 30.1 Secrets

Store secrets through Electron `safeStorage` where possible.

Protected values include:

- proxy usernames
- proxy passwords
- CAPTCHA solver API tokens and keys
- payment card numbers, expiration dates, CVVs, VCC credentials, and gateway tokens
- provider and release-feed credentials
- future API credentials
- other app secrets

Do not store them in:

- source files
- Git
- plaintext JSON
- unencrypted SQLite columns

Proxy URLs may be imported through the proxy form. The pasted URL is parsed locally into the existing encrypted credential fields, cleared immediately after parsing, and never persisted as a plaintext URL.

Saved proxy credentials and shipping/contact details may be revealed only after an explicit native consent prompt. A reveal is held in memory for at most 30 seconds, closes when the app loses focus, and is never logged. User-requested clipboard copies expire after 60 seconds when the clipboard still contains the copied value. Reveals are unavailable during an active run. Solver keys and complete Payment Profile payloads are never revealable or copyable after they are saved; their UI exposes only replacement and deletion actions.

### 30.2 Payment information

Copify may store operator-configured card, VCC, expiration, and CVV material for
Full Auto-Checkout, but only as an Electron `safeStorage` encrypted
payload. Plaintext payment fields must never be written to SQLite, JSON, run
artifacts, browser-profile metadata, or application configuration.

`PaymentProfile` exposes only redacted metadata outside the Electron main process:

```ts
interface PaymentProfile {
  id: string;
  name: string;
  kind: "CARD" | "VCC" | "GATEWAY_TOKEN";
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  configured: boolean;
  createdAt: number;
  updatedAt: number;
}
```

The sensitive payload is encrypted and decrypted as one unit. It exists in
plaintext only during initial entry and just-in-time use by an active runner. The
main process clears the entry IPC payload after encryption, sends a scoped
one-session secret message to the runner, and drops its references after the
payment attempt. The runner must not echo the payload in errors or events.

If `safeStorage` is unavailable, locked, or cannot decrypt the selected profile,
Copify fails the Payment Profile preflight and does not downgrade to plaintext
storage. Browser-owned Shop Pay or saved-wallet state remains preferred when the
adapter can submit without extracting its credentials.

> **Security/compliance exception:** v0.14 persistently stores CVV in the encrypted
> payload by explicit product decision. PCI SSC FAQ 1280 states that card
> verification codes must not be retained after authorization, including when
> encrypted. Copify must receive specialist PCI/legal review before distribution.
> See https://www.pcisecuritystandards.org/faqs/1280/.

`GATEWAY_TOKEN` remains reserved in the internal versioned contract only. v0.14
rejects its creation, assignment, preflight eligibility, and execution;
gateway-token investigation and implementation is deferred to v0.19.

### 30.3 Secure batch Payment Profile intake

Batch VCC/card intake supports a local CSV template and multiline paste. It does
not connect directly to Revolut, MB WAY, a bank, or a card issuer.

- CSV is selected with a native file picker and read by the Electron main
  process; its raw contents never enter renderer state.
- Pasted text exists only in isolated local form state, is sent immediately to
  main, and the field releases its value. If requested, Copify clears the system
  clipboard only when it still contains the imported text.
- Main validates the batch and returns a redacted preview plus an opaque import
  token with a two-minute lifetime. The renderer receives no PAN, CVV, raw row,
  source path, or plaintext error echo.
- Validation covers required labels, `CARD`/`VCC` kind, Luhn checksum, expiration,
  CVV shape, duplicate rows within the batch, and optional provider/workflow tags
  such as Revolut or MB WAY. Existing redacted last-four/expiry collisions warn
  and require explicit inclusion; Copify stores no PAN hash or fingerprint.
- Confirmation encrypts every selected profile independently with `safeStorage`
  and commits all redacted metadata in one transaction. Encryption, secure
  storage, or persistence failure rolls back the entire import.
- Cancellation, expiry, successful commit, or app shutdown discards the
  temporary main-process batch. Copify never persists the CSV, pasted text,
  plaintext preview, opaque token, raw validation payload, or provider secrets.

The preview contract contains row number, proposed profile name, kind, brand,
last four digits, expiry, tags, and normalized error/warning codes only. Complete
Payment Profile payloads remain non-revealable after import.

Copify may store normal shipping/contact information locally if explicitly configured.

### 30.4 Browser state

Persistent browser profiles may contain authentication material.

They must:

- stay outside the source repository
- be excluded via `.gitignore`
- live under the application data directory
- never be uploaded automatically

### 30.5 Logging redaction

The logger must redact:

- `Authorization`
- `Cookie`
- `Set-Cookie`
- proxy credentials
- checkout tokens
- CAPTCHA response tokens, site-solver request bodies, and solver API keys
- payment card numbers, expiration dates, CVVs, VCC data, and gateway tokens
- credential-bearing provider endpoints and URL query strings
- passwords
- payment fields

Redaction must happen before renderer broadcast, serialization, disk persistence,
telemetry, or export. Run exports and database exports omit encrypted secret blobs
as well as plaintext values. Renderer APIs return only configured flags,
sanitized provider diagnostics, and redacted Payment Profile metadata.

---

## 31. Project Structure

Suggested initial repository:

Actual structure as implemented:

```text
copify/
│
├── apps/
│   └── desktop/
│       ├── resources/
│       │   ├── brands/         <storeId>.svg, resolved by StoreMark
│       │   └── icons/
│       └── src/
│           ├── main.ts         Electron main: IPC, orchestration, runs
│           ├── preload.ts      contextBridge API surface
│           ├── renderer.tsx    app shell and shared state
│           ├── preflight.ts    pre-run checks (section 39)
│           ├── types.ts        renderer draft shapes and helpers
│           ├── pages/          Run, Calendar, Browsers, Targets, Shipping,
│           │                   Payments, Settings, RunInspector, Proxies,
│           │                   LaunchModes, CAPTCHA, Appearance
│           ├── ui/             TitleBar, Sidebar, Menu, Drawer, Toast,
│           │                   StoreMark, primitives, icons,
│           │                   theme, ThemeProvider
│           └── styles/         tokens, base, shell, components
│
├── packages/
│   ├── core/
│   ├── runner/
│   ├── persistence/
│   └── shared/                 types, schemas, IPC contracts, store manifests
│
├── browser-profiles/
│   ├── home/
│   ├── session-a/
│   └── session-b/
│
├── data/
│
├── runs/
│
├── docs/
│   └── spec.md
│
└── package.json
```

Possible detailed package responsibilities:

```text
packages/core
  Orchestrator
  RunManager
  TargetEngine
  CommitLock
  EventBus

packages/runner
  BrowserManager
  SessionRunner
  ProfileManager
  Playwright instrumentation

packages/stores
  StoreAdapter
  SupremeAdapter
  future adapters

packages/persistence
  SQLite
  migrations
  repositories

packages/observability
  event logger
  trace manager
  screenshot manager
  network sanitizer
  metrics aggregation

packages/shared
  types
  schemas
  IPC contracts
  store manifests and capability lookups
```

`packages/stores` and `packages/observability` are not yet split out. Store
adapter implementations currently live in `packages/runner`; extracting them is
worthwhile once a second adapter exists.

---

## 32. Git Ignore Requirements

At minimum:

```gitignore
browser-profiles/
runs/
.env
*.sqlite
*.sqlite3
playwright/.auth/
dist/
node_modules/
```

Development fixtures must not contain real secrets.

---

## 33. UI Direction

Copify is an operations console, not a shopping interface. The interface is dense,
near-monochrome, and spends colour only on meaning.

### 33.1 Information architecture

Seven sections, ordered by the drop workflow — you run from the top item and
prepare below it:

```text
Run        the drop console and landing page
Calendar   upcoming releases and one-click target arming
Browsers   browser profiles, routes, cart state
Targets    what to watch for and which variants are acceptable
Shipping   addresses and which browser uses which
Payments   encrypted payment profiles and browser assignments
Settings   Routes · Monitor · Stores · CAPTCHA · Costs · Appearance · About
           Advanced appears only when About → Show experimental settings is enabled
```

There is no separate dashboard. A dashboard that only summarises other pages adds
a hop without adding information; Run carries the live state instead.

There is no global store switcher. A run is already scoped by its target's store,
and Browsers must never be filtered, because one Chrome profile can hold state for
several stores at once.

### 33.2 The drop console

`Run` is the answer to "a drop is happening, what do I do". Idle, it shows the
preflight checklist, the launch controls, and recent runs. Recording, it becomes a
live board with one row per session.

Before launch, each selected-browser row exposes ephemeral checkout-mode,
CAPTCHA-strategy, and Payment Profile overrides plus the Run-level
`maxCheckouts`. The resolved values are visible before the operator starts the
run. During and after the run, the same row shows resolved strategies, solve
duration/cost, failover outcome, checkout latency, quota state, and `order_index`
so different strategies can be benchmarked side by side.

```text
Start a run                                              [ Start run ]
Copify opens the selected browsers itself so it can record from the first page.

●  Browsers selected   2 browsers ready to launch.
●  Browsers closed     The run will open them with recording attached.
●  Routes verified     Never benchmarked: Proxy 1 (PT ISP 01).
●  Target armed        Box Logo · Box Logo, Hooded
```

Recording:

```text
READY_TO_CONFIRM   Home session   82.155.x.x PT
CAPTCHA_SOLVING    PT ISP 01      API_WITH_FALLBACK · 2.8 s
CHECKPOINT         PT ISP 01      Cart is not empty.        [ Recheck cart ]
CHECKOUT_LIMIT_REACHED PT RES 01  Order quota reached.
SOLD_OUT           PT RES 01
```

A session waiting on a human is the one thing that must catch the eye mid-drop: it
carries an amber edge and its resume action inline.

### 33.3 Visual language

- **Chrome and content are two surfaces.** A frameless window draws its own 40px
  titlebar sharing one background with the sidebar and no divider between them, so
  the chrome reads as a single L-shaped surface with the content in a well.
  Window controls are OS-drawn in the app palette via `titleBarOverlay`, which
  the renderer refreshes from the resolved theme (section 33.6).
- **A page that throws does not take the window.** Each page renders inside an
  error boundary, so the chrome, the sidebar and a run in progress survive one
  broken screen; the shell has its own boundary above them.
- **The titlebar carries identity and state**, not the page name: the mark, the
  wordmark, and a live status chip (ready count, or `REC` with a running clock).
  Page identity comes from the sidebar's active item. The sidebar collapses to a
  52px icon rail.
- **One accent, semantic only.** Primary actions are drawn from the foreground
  rather than tinted, so colour is never spent on "this is a button". Colour
  means state: green for ready and pass, amber for warnings and human handoff,
  red for failure. Never decoration.
- **Rows, not cards.** Tables share one grid between header and rows via subgrid,
  so columns cannot drift. Machine values — IPs, latencies, timings, event names,
  scores — render monospaced with tabular numerals.
- **One primary action per row**, everything else behind an overflow menu.
  Creating and editing happen in a drawer, not a form permanently occupying the
  bottom of a page.
- **Type caps at 17px** on a 13px base. There are no page-level `h1` elements.

### 33.4 Writing

Interface copy states what is true and what will happen. It does not explain the
architecture, restate the heading above it, or narrate what the user just did.

- No kicker labels above headings.
- Dropdown options are nouns. If a mode needs explaining, one line under the whole
  control, never a clause inside each option.
- Structural facts render as data — a capability badge, a disabled control with a
  reason — not as a paragraph. Prose does not scale across a dozen adapters.
- Confirmations only for what leaves no trace. A visible change is its own
  confirmation, so successful edits stay silent; failures and results with no
  on-screen effect appear as a transient toast. Toasts stack rather than
  replace one another, so a burst of failures is still readable.
- Confirmations are drawn in-app, never by the platform. A native dialog
  ignores the palette, the theme and the frameless chrome. The title states
  what will happen, the button is the verb, and Cancel holds focus.
- Empty states are one line and an action. Where there is no action to offer,
  the line says what will fill the list instead of naming the absence.
- Every unpaged list carries a filter, always visible. A control that appears
  only past some row count is one nobody knows exists, and the count it keys on
  is invisible to the operator.

### 33.5 Visual priorities

The UI emphasises state, timing, failure, action required, target rules, and
network health — in that order.

### 33.6 Theming

Dark is the default and the console's native register. Light and System exist
because the machine running a drop is not always in a dark room, and System
follows the OS.

A theme is not a palette to be maintained twice. It declares four bases —
background, foreground, accent, and a contrast multiplier — and `tokens.css`
derives every surface and text step from them with `color-mix(in oklab, …)`:

```text
--surface … --border-strong   background → foreground, at fixed steps × contrast
--fg-muted, --fg-dim          foreground → background, at fixed fades ÷ contrast
--primary-bg                  foreground pushed past itself, never tinted
```

Consequences worth keeping:

- **No stylesheet outside `tokens.css` names a colour.** Everything reads a
  token, so a new theme costs four values rather than an audit.
- **The mixes resolve at used-value time**, so the contrast slider and the
  colour pickers apply with no JavaScript recomputation.
- **Themes are attribute-scoped** (`[data-theme="dark"|"light"]`), not
  `prefers-color-scheme`. System is resolved in JS to a concrete attribute. A
  media query is document-global and could not let the Appearance preview cards
  render a theme other than the active one — and they reuse the same ramp, so a
  preview cannot drift from what the app will paint.
- **Overrides are nullable.** Unset follows the shipped token rather than
  freezing today's hex into the database, so palette changes still reach anyone
  who never customised.
- **The frame is painted before the renderer exists.** The resolved chrome
  colours are cached in `app_settings` so the next launch opens the window in
  the right theme instead of flashing the default one.
- **Nothing stops the operator picking an unreadable pair**, so Appearance
  measures instead: body, muted, primary and accent are checked against WCAG AA
  (4.5:1, or 3:1 for the accent, which is only ever a dot or a 2px rule) and
  reported as data. A failing pair is a warning, never a block.
- **Density is spacing, not type.** Control heights, row heights and padding
  scale between Comfortable and Compact; the type scale does not, because 33.3
  caps it and the layouts are designed against that cap.
- **Motion is decoration.** Under `prefers-reduced-motion` transitions and
  animations collapse. The recording dot stops pulsing but stays red — no state
  is carried by movement alone.

Appearance applies as you change it. Settings that a run snapshots — monitor
behaviour — stage behind a Save button; a theme has no such moment, and the app
itself is the preview.

---

## 34. Notifications

Useful alerts:

- checkpoint detected
- human action required
- product found
- price limit exceeded
- runner crashed
- checkout ready
- proxy route degraded or failover exhausted
- pre-checkout proxy failover completed
- IPC protocol incompatibility
- commit lock acquired
- run completed

On Windows v1:

- desktop notification
- optional sound
- UI state highlighting

Future macOS/Linux implementations should use platform-native notification abstractions.

---

## 35. Application Versioning & Reproducibility

Every run should record:

- Copify version
- build version
- Git commit if available
- store adapter version
- schema version
- OS version
- Chrome version
- Playwright version
- target snapshot
- browser profile ID
- saved primary and actual session proxy profile IDs
- proxy failover attempts/outcome
- hot-path IPC protocol version
- discovery-source capability snapshot, adaptive cadence, route allocation, and
  winning source

This is necessary because storefront behavior and automation code change over time.

A result should be reproducible enough to answer:

> "Did v0.4.3 perform worse than v0.4.2?"

---

## 36. SQLite Data Model

Initial tables may include:

```text
browser_profiles
browser_profile_proxy_backups
proxy_profiles
proxy_health_samples
monitor_discovery_state
shipping_profiles
payment_profiles
targets
runs
run_sessions
run_events
proxy_benchmarks
release_entries
release_feed_sources
app_settings
```

`browser_profile_proxy_backups` preserves each profile's unique ordered backup
IDs without changing its primary assignment. `proxy_health_samples` retains
bounded redacted aggregates needed for watchdog diagnostics; it never stores a
credential-bearing URL or provider token. Payment import source rows and opaque
batch tokens have no table and must never be persisted.

`monitor_discovery_state` stores only bounded source state: store/source/route
scope, conditional-request validators, hashed canonical URL/handle keys, last
successful probe, last status class, and backoff deadline. Hash history is capped
and pruned. Complete sitemap XML, predictive-search responses, raw search phrases,
credential-bearing URLs, and response bodies are never persisted.

Potential later tables:

```text
store_adapters
historical_metrics
run_annotations
target_templates
```

`app_settings` is a key/value table. Current keys:

```text
network_probe_url   HTTPS endpoint used by route benchmarks
store_settings      JSON map of storeId -> enabled, merged over the manifests
monitor_settings    JSON monitor behaviour: defaults, per-store overrides, routes
captcha_settings    JSON mode, provider, sanitized endpoint, timeout and fallback
appearance_settings JSON theme mode, per-theme colour overrides, density
appearance_chrome   resolved titlebar colours, read by main before first paint
window_bounds       restore size, position and maximised state of the window
```

`captcha_settings.mode` is `manual_only`, `api_with_fallback`, or `api_only`.
The default is `manual_only`; API-with-fallback defaults to a 5,000 ms timeout and
enabled manual fallback. The JSON stores only non-secret configuration and a
`credentialConfigured` flag. The solver key/token is stored separately as a
`safeStorage` ciphertext value and is excluded from settings reads and exports.
Custom provider endpoints must use HTTPS, must not contain embedded user info or
credential query parameters, and are sanitized before display or logging.

```ts
interface CaptchaSettings {
  mode: "manual_only" | "api_with_fallback" | "api_only";
  provider: "capsolver" | "capbypass" | "nslsolver" | "custom" | null;
  providerEndpoint: string | null;
  timeoutMs: number;
  fallbackEnabled: boolean;
  credentialConfigured: boolean;
}
```

`fallbackEnabled` must be `true` for `api_with_fallback` and `false` for
`api_only`; it is retained explicitly so the Settings UI and migrations can show
the resolved behavior without inferring it from provider state.

Targets persist their checkout defaults and `maxCheckouts`; Browser Profiles
persist their execution overrides and optional Payment Profile assignment. Runs
snapshot their resolved checkout cap. Run Sessions snapshot the resolved
`checkoutMode`, `captchaStrategy`, Payment Profile ID/redacted label, and any
ephemeral Run setup overrides so historical comparisons do not depend on current
editable settings.

Targets also persist nullable `directProductUrl`. Runs snapshot whether direct
polling or discovery mesh mode was selected, the supported source descriptors,
adaptive sitemap cadence, redacted route allocation, and runtime source health so
historical results do not depend on a later manifest or monitor-settings change.

`payment_profiles` stores redacted display metadata and one encrypted payload
blob. Card number, CVV, VCC secret, and gateway token never receive separate
plaintext columns. `release_entries` stores normalized source identity, store,
title, release time/timezone, retail price/currency, product URL, attribution,
image cache path/hash, and target-generation state. `release_feed_sources` stores
enabled state, adapter kind, sanitized endpoint, refresh cadence, and last result;
any feed credential uses a separate encrypted secret.

Large binary artifacts such as screenshots and traces should remain on disk, with paths referenced from SQLite.

---

## 37. Shipping & Payment Profiles

A shipping profile may contain:

```ts
interface ShippingProfile {
  id: string;

  name: string;

  fullName: string;
  email: string;
  phone: string;

  address1: string;
  address2?: string;

  postalCode: string;
  city: string;
  region?: string;
  country: string;
}
```

Shipping profiles never contain payment credentials. A Browser Profile may point
independently to one Shipping Profile and one Payment Profile. A Run setup row may
override the Payment Profile for that session without changing the browser's
saved assignment. No Payment Profile is assigned automatically.

The public Payment Profile shape is the redacted interface in section 30.2. Its
encrypted payload may contain either card/VCC fields or a gateway token, never
both unless a payment adapter explicitly requires both representations. Deleting
a Payment Profile clears browser assignments that reference it and makes affected
`FULL_AUTO` sessions fail preflight until another valid payment path is selected.

The Payment Profiles screen also exposes **Import batch**. CSV selection and
multiline paste converge on the secure intake flow in section 30.3, display only
the redacted preview, and commit as a single transaction. Batch assignment
helpers may map imported profiles to selected Browser Profiles, but no mapping is
automatic and assignment never requires decrypting the payment payload.

---

## 38. Error Taxonomy

Errors should be categorized, not stored as generic strings.

Example:

```ts
type RunnerErrorCode =
  | "BROWSER_START_FAILED"
  | "PROXY_CONNECTION_FAILED"
  | "PROXY_AUTH_FAILED"
  | "PROXY_ROUTE_DEGRADED"
  | "PROXY_FAILOVER_EXHAUSTED"
  | "IPC_PROTOCOL_MISMATCH"
  | "IPC_FRAME_INVALID"
  | "STORE_CAPABILITY_UNSUPPORTED"
  | "NAVIGATION_TIMEOUT"
  | "STORE_UNAVAILABLE"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_PARSE_FAILED"
  | "VARIANT_NOT_AVAILABLE"
  | "PRICE_LIMIT_EXCEEDED"
  | "ATC_FAILED"
  | "CHECKOUT_NAV_FAILED"
  | "CHECKPOINT_DETECTED"
  | "PAYMENT_HANDOFF_REQUIRED"
  | "CAPTCHA_TIMEOUT"
  | "CAPTCHA_SOLVER_UNAVAILABLE"
  | "CAPTCHA_TOKEN_INVALID"
  | "PAYMENT_PROFILE_UNAVAILABLE"
  | "PAYMENT_BATCH_INVALID"
  | "PAYMENT_BATCH_EXPIRED"
  | "PAYMENT_SUBMISSION_FAILED"
  | "PAYMENT_TOKEN_INVALID"
  | "RELEASE_FEED_UNAVAILABLE"
  | "RELEASE_FEED_INVALID"
  | "SOLD_OUT"
  | "SELECTOR_CHANGED"
  | "RUNNER_CRASHED"
  | "UNKNOWN";
```

This enables useful aggregate analytics later.

---

## 39. Health Checks

Preflight runs continuously on the Run page against the current selection, so the
run is either startable or the reason why not is already on screen.

Each check is `pass`, `warn`, or `fail`. **A failure blocks the run; a warning
does not.** Warnings exist so a stale benchmark cannot stop a drop, while a
misconfiguration that would certainly waste it does.

| Check | Fails when | Warns when |
|---|---|---|
| Browsers selected | nothing selected | — |
| Browsers closed | a selected browser is open | — |
| Routes | assigned proxy is missing or disabled | route never benchmarked |
| Backup routes | an enabled failover policy has no usable ordered backup | a backup benchmark is stale or reserved elsewhere |
| IPC protocol | a selected monitor/runner cannot negotiate the current hot-path version | — |
| Store capabilities | the selected mode is unsupported or its declared handler is missing | an experimental capability is selected |
| Discovery sources | a direct-URL Target has no hydration handler, or a keyword Target has no usable collection handler | sitemap/search is unsupported, blocked, or backing off on the available routes |
| Target armed | no Target, Target disabled, or store cannot execute the selected checkout mode | observing with no Target |
| Shipping ready | a checkout-enabled session has no complete address | an observing session has no address |
| Price limit set | a checkout-enabled Target has no maximum price | — |
| CAPTCHA strategy | an API-only session has no valid provider credential/endpoint | API-with-fallback diagnostics fail but its Harvester is available |
| Payment ready | a Full Auto session has neither a decryptable Payment Profile nor adapter-confirmed browser wallet/Shop Pay readiness | an Assisted session has no saved payment path |
| Checkout limit | `maxCheckouts` is neither `UNLIMITED` nor an integer >= 1 | — |

The "browsers closed" check exists because a run launches its browsers itself in
order to record from the first navigation, so an already-open browser cannot join
one. The check says that rather than refusing without explanation.

Preflight is implemented in `apps/desktop/src/preflight.ts` as a pure function and
is unit tested. The main process keeps its own guards, so the renderer prevents and
the main process still validates.

---

## 40. Drop Preparation Workflow

A typical drop-day workflow:

### Days before drop day (Profile Warming & Setup)

1. Create a Target manually or from Calendar, then set keywords, optional direct product URL, color/size priorities, maximum retail price, checkout mode, CAPTCHA strategy, and checkout cap. Leave the URL empty when the product is not public yet so the discovery mesh can find it.
2. Assign persistent browser profiles to dedicated static ISP / sticky residential routes. Configure each provider's maximum sticky-session TTL for the planned queue duration; use static ISP routes when the provider TTL cannot cover it.
3. Assign encrypted Payment Profiles where Full Auto sessions do not use an authenticated browser-owned payment path. For multiple VCCs, use the redacted CSV/paste batch preview and explicitly map the imported profiles.
4. **Warm Profiles:** Launch browser profiles via "Warm Profile" mode to log into Google/Gmail accounts (farming $\ge 0.9$ trust scores) and authenticate Shop Pay / saved payment methods.
5. Configure ordered backup proxies, verify their health and country coherence, then verify solver diagnostics and run a low-risk dry run.

### Drop day (T-minus 15 minutes)

1. Launch Copify and execute preflight verification.
2. Open assigned browser sessions (launches persistent Chrome with `rebrowser-patches` stealth hardening).
3. Browsers navigate to storefront standby (`https://eu.supreme.com/pages/shop`) to pre-warm connections and load session cookies.
4. Confirm the watchdog reports healthy primary/backup routes and start the decoupled HTTP monitor (Crawlee `HttpCrawler` with Undici `StandardHttpClient`). Direct-URL Targets use product polling; keyword Targets concurrently use every due, route-probed collection, sitemap, and predictive-search capability.
5. Wait for release (16:00:00 Europe/Lisbon).
6. **Pre-drop recovery:** If a browser primary degrades before variant selection, Copify relaunches the same persistent profile on a healthy session-only backup and restores storefront standby. After variant selection, degradation alerts but never changes the route.
7. **Drop execution:** The first fully hydrated and acceptable discovery candidate wins exactly once; the monitor emits `VariantSignalFrameV1` $\rightarrow$ runners execute sub-400ms in-page direct carting $\rightarrow$ advance to checkout.
8. **Challenge resolution:** Each runner uses its snapshotted manual/API/failover CAPTCHA strategy and records solve telemetry.
9. **Checkout execution:** Assisted sessions wait for confirmation; Full Auto sessions reserve any finite checkout slot and submit immediately.
10. **Dynamic issuer handoff:** Frictionless 3DS continues automatically. If an interactive PSD2 / 3DS challenge appears, approve it on mobile/browser and click Resume.
11. When a finite checkout cap is reached, remaining sessions stop before payment with `CHECKOUT_LIMIT_REACHED`.
12. Inspect route failover, IPC timing, and checkout metrics in the Run Inspector.

---

## 41. Dry-Run Mode

Copify includes a mode that stops before a real purchase.

Example:

```text
DRY RUN

Product detection       ENABLED
Variant selection       ENABLED
Add to cart             ENABLED
Checkout navigation     ENABLED
Purchase submission     DISABLED
```

Dry runs allow safe testing on ordinary products or test storefronts. They may
exercise CAPTCHA routing, encrypted-profile decryption, form filling, quota
reservation/release, and the transition to `READY_TO_SUBMIT`, but the final
irreversible payment request remains disabled in both checkout modes.

---

## 42. Development Roadmap

### v0.1 — Browser Foundation (DELIVERED)

- Electron + React shell.
- TypeScript project structure.
- Browser profile CRUD.
- Launch one persistent Chrome process.
- Launch multiple persistent Chrome processes.
- Open/close/restart sessions.
- Basic runner IPC.
- Session state display.

---

### v0.2 — Proxy Profiles & Network Health (DELIVERED)

- Proxy profile CRUD.
- HTTP/HTTPS/SOCKS support through Playwright.
- Secret storage for proxy credentials (`safeStorage`).
- Per-browser proxy assignment.
- Generic proxy health benchmark.
- Public IP verification and geolocation check.
- Latency/jitter/failure measurement.
- Proxy quality score.

---

### v0.3 — Run Engine & Inspector Foundation (DELIVERED)

- Run creation and run sessions.
- Structured event logger with monotonic timestamps.
- SQLite persistence.
- Normal/diagnostic/deep-debug modes.
- Screenshot manager and console capture.
- Sanitized network capture.
- Basic run timeline UI.

---

### v0.4 — Supreme Product Detection (DELIVERED)

- StoreAdapter interface and SupremeAdapter.
- Product matching with keywords and negative keywords.
- Color, size, and price parsing.
- Target engine and max-retail kill switch.
- Target check and candidate evaluation.

---

### v0.5 — Cart & Checkout Assistance (DELIVERED)

- Product navigation and variant selection.
- Add-to-cart and cart confirmation.
- Checkout navigation and shipping autofill.
- Checkpoint detection, human handoff, and resume action.

---

### v0.5.5 — Interface and Store Modularity (DELIVERED)

- Store registry and capability manifest (`storeId` string validation).
- Capability-driven UI (monitorability, assisted eligibility, size inputs, currency).
- Frameless window with integrated titlebar and collapsible sidebar.
- Drop-workflow information architecture with blocking preflight.
- Drawers for editing, overflow menus for secondary actions, transient toasts.

---

### v0.6 — Multi-Session Checkout Assistance (DELIVERED)

- Multi-browser concurrent checkout progression to filled checkout page.
- `READY_TO_CONFIRM` state.
- Session failover and live session priority.
- Action-required UI for checkpoints and cart status inspection.

---

### v0.7 — Driver Hardening & CDP Stealth (DELIVERED)

Deliver:

- Replace standard Playwright launch with `rebrowser-playwright` / apply `rebrowser-patches`.
- Eliminate `Runtime.enable` and CDP evaluation leak artifacts.
- Enforce strict Chrome launch flag sanitization (`--disable-blink-features=AutomationControlled`).
- Verify `navigator.webdriver === false` without prototype tampering.
- Pluggable `BrowserDriver` interface (NativeStealthDriver default + optional Anti-Detect API driver).

Success criteria:

- Cloudflare Turnstile bot detection tests and CreepJS fingerprint checks pass with zero automation flags detected.

---

### v0.8 — Drop-Tuned Human Input Engine

Deliver:

- Integrate `ghost-cursor` for natural Bezier mouse trajectory generation.
- Implement `HumanInput` wrapper with `FAST_DROP` calibration (100–220ms movements).
- Implement natural CDP mouse click dwell times (40–75ms `mousedown` to `mouseup`).
- Implement simulated OS clipboard paste (`Ctrl+V`) and accelerated keystroke intervals (15–35ms) for shipping forms.
- Natural smooth wheel scrolling.

Success criteria:

- Form interactions and clicks dispatch trusted CDP events with natural velocity curves that pass behavioral bot detection.

---

### v0.9 — Decoupled TLS-Spoofed Monitor & Direct-Carting

Deliver:

- Implement decoupled `HttpStoreMonitor` using Crawlee `HttpCrawler` and the Undici-backed `StandardHttpClient`; maintain a future `impit` migration path for strict TLS/HTTP fingerprint requirements.
- High-frequency polling (500ms – 2s) with proxy pool rotation.
- Instant `variantId` extraction from Shopify listing JSON / embedded scripts.
- Implement sub-400ms in-page `fetch('/cart/add.js')` direct carting within pre-warmed browsers.
- Implement fallback direct URL navigation (`/cart/{variant_id}:1`).
- Pre-warmed browser standby management on `/pages/shop`.

Success criteria:

- Monitor detects target within 1 second of drop; pre-warmed browsers reach checkout in under 1.5 seconds total without loading the product detail page.

---

### v0.10 — Profile-Proxy Coherence & Account Warming Workflow

Deliver:

- Resolve route-aware GeoIP before Native Stealth launch and apply verified timezone, locale, `Accept-Language`, and approximate geolocation fields independently.
- Apply `disable_non_proxied_udp` WebRTC policy to proxied sessions and `default_public_interface_only` to direct sessions; keep the snapshot immutable for the browser lifetime.
- Add a guided "Warm profile" workflow for manual storefront, Google, and Shop/Shop Pay setup in the existing persistent Chrome directory.
- Preserve browser-owned Shopify and Shop Pay state without extracting, copying, displaying, or logging cookie/token values.
- Detect European PSD2 / 3DS Strong Customer Authentication handoffs, deduplicate alerts, and focus the checkout once; later checkout modes may continue automatically through frictionless flows while interactive issuer challenges retain this handoff.

Success criteria:

- Profiles expose their applied GeoIP coherence and warming readiness; incomplete coherence warns without blocking. CAPTCHA occurrence is an external observation rather than a guaranteed gate.
- Development builds provide a strictly gated PSD2 / 3DS handoff simulator only for an active assisted session already at `READY_TO_CONFIRM`. It must use the same focus, notification, Run-board, and sanitized-event path as a real handoff while performing no page input, cart mutation, checkout submission, or payment action; packaged builds reject it.

---

### v0.10.5 — Multi-Source Shopify Discovery Mesh

Deliver:

- Add nullable `directProductUrl` precedence: direct targets poll only their
  product page, while keyword-only targets activate the adapter-declared mesh.
- Introduce versioned monitoring-source descriptors and handler registration for
  collection HTML, Shopify product sitemaps, predictive search, and product
  hydration without core/UI store-ID branches. v0.15 expands this foundation into
  Capability Manifest v2 governance across every feature family.
- Resolve root sitemap indexes and ranged/sharded product sitemaps, maintain a
  bounded hash/validator baseline, and hydrate only new, changed, or immediately
  keyword-relevant candidates.
- Probe up to three URL-encoded positive phrases through Shopify predictive
  search and require authoritative product-page hydration before selection.
- Execute every due source concurrently. Use a verified-match `Promise.any` race,
  retain `Promise.allSettled` diagnostics, deduplicate URL/handle/sequence, and
  emit one `VARIANT_SELECTED` only after all existing target rules pass.
- Poll collection/search at the active interval and sitemap every 30 seconds in
  standby or 5 seconds in Turbo, with gzip, conditional requests, body limits,
  independent source backoff, and per-source byte accounting.
- Prefer distinct healthy monitor routes per source, reuse routes when fewer than
  three exist, and hydrate on the discovering route. Keep these routes independent
  from the fixed checkout browser route.
- Add redacted source/candidate/winner events and Run Inspector mesh health,
  routing, latency, bandwidth, candidate count, and winning-source visibility.

Success criteria:

- Collection-first, sitemap-first, and predictive-search-first fixtures all
  select the same acceptable variant, and simultaneous matches execute exactly
  once.
- A blocked or unsupported sitemap/search source backs off visibly without
  failing collection polling or incorrectly degrading its proxy route.
- Direct-product polling remains the lowest-bandwidth path, while a target for a
  not-yet-public product can remain armed without a URL and be discovered when it
  appears in any supported public source.
- Supreme manual validation proves collection monitoring remains functional when
  sitemap or predictive search is unavailable. The mesh makes no guarantee that
  products absent from every public source can be discovered.

---

### v0.11 — Historical Drop Analytics & Post-Run Diagnostics

Deliver:

- Historical session metrics and drop comparison.
- Monotonic timing breakdowns (`monitor_to_detect`, `detect_to_cart`, `cart_to_checkout`, `human_3ds_duration`).
- Browser-profile and proxy reliability history.
- Checkpoint and Turnstile rate analytics.
- Per-session checkout/CAPTCHA strategy, solve duration/cost, and failover analytics.
- Run annotations and failure aggregation.

Success criteria:

- Post-run review highlights exact latency bottlenecks across routes and profiles.

---

### v0.12 — Cost Accounting, Budgets & Provider Reconciliation

Copify must make proxy cost visible without presenting locally measured bytes as an
invoice. The product distinguishes **Copify estimates** from **provider-confirmed
billing** at every layer of the UI and API.

#### Goals

- Show live and historical proxy traffic and estimated cost for the current day,
  rolling 7 days, calendar month, and a custom date range.
- Give the operator a practical answer to: "How much did this run, store, monitor,
  browser profile, or proxy cost?"
- Track a chosen spending budget and warn before it is consumed.
- Reconcile Copify's partial measurement with the provider's authoritative usage,
  balance, and billed-cost data where the provider supports it.
- Keep all proxy and account credentials protected by `safeStorage`; never expose
  credentials, provider tokens, request URLs, headers, cookies, or checkout data
  through cost records.

#### Accounting model

Copify already records cumulative run network usage for monitors and browser
sessions. v0.12 turns that data into a durable cost ledger, using decimal billing
units (`1 GB = 1,000,000,000 bytes`) and integer micro-USD arithmetic.

Each usage aggregate must include:

- `runId`, time bucket, usage source (`MONITOR` or `BROWSER`), store, browser
  profile/session where applicable, and proxy profile where applicable.
- received bytes, known sent bytes, request count, and a measurement-completeness
  value (`PARTIAL`, `COMPLETE`, or `UNAVAILABLE`).
- the proxy's snapshotted `costPerGbMicrosUsd`, estimated cost in micro-USD, and
  update timestamp.
- no URL, request/response header, cookie, request body, payment data, address, or
  proxy credential.

The local estimate is calculated only for non-direct traffic with a configured
rate:

```text
measured_bytes = received_bytes + known_sent_bytes
estimated_cost_micro_usd =
  floor(measured_bytes * cost_per_gb_micro_usd / 1,000,000,000)
```

Direct traffic has no proxy-cost estimate. Monitor usage includes successful,
protected, cached, and failed responses when their body/request size is known.
Browser usage uses Chromium encoded-byte events where available and known upload
sizes; it falls back to `Content-Length` and known payload size. Headers, TLS,
proxy-tunnel overhead, unknown uploads, and unsupported External CDP sessions must
make the measurement `PARTIAL` or `UNAVAILABLE`, never silently exact.

#### Provider-confirmed billing

Provider-confirmed data is the source of truth for actual spend and remaining
credit. It must remain separate from local estimates because a proxy provider may
bill traffic that the browser/network observer cannot fully measure.

Implement provider reconciliation in progressive layers:

1. **Manual snapshot** — the operator may enter a provider-reported remaining
   credit, used traffic, or billed spend and timestamp.
2. **CSV import** — accept an exported provider usage report, show a preview and
   field mapping, then retain only normalized aggregate rows. Do not retain the
   original CSV or any unnecessary provider identifiers.
3. **Optional read-only connector** — for providers with a documented account
   usage API, store a separate API token using `safeStorage`, perform an explicit
   user-requested refresh or low-frequency background refresh, and persist only
   normalized usage/balance/billed-cost results. The proxy username and password
   must never be repurposed as an API credential.

DataImpulse is the first reconciliation target. Its dashboard/reporting remains
the fallback if the installed account/API scope cannot return plan balance and
usage details. The connector must be read-only: it cannot purchase traffic,
top-up an account, change provider targeting, generate proxies, alter provider
settings, or manage sub-users. A failed sync preserves prior confirmed data,
labels its age, and never blocks a run.

Provider data is represented with an explicit authority value:

- `COPIFY_ESTIMATED` — calculated from Copify's local measurements.
- `PROVIDER_CONFIRMED` — imported or synchronised from a provider report/API.
- `MANUAL_CONFIRMED` — operator-entered snapshot, including its entered time.
- `PROVIDER_REPORTED` — a per-solve charge returned by a CAPTCHA provider.
- `MIXED` — a presentation-only aggregate containing more than one authority.

The UI must never add estimated and provider-confirmed spend together. It should
instead show the latest confirmed value alongside the comparable Copify estimate
and their difference, with measurement completeness and data age.

#### Settings → Costs & budgets

Add a dedicated Settings tab named **Costs & budgets** with:

- headline cards for total known spend, provider-reported CAPTCHA spend, estimated
  and confirmed proxy spend, proxy traffic, remaining provider credit where known,
  and estimation coverage for the selected period.
- period selector: Today, last 24 hours, rolling 7 days, calendar month, and
  custom range; all period labels state their timezone.
- a bucketed spend series over the selected period, returned on the summary as
  `series` plus `seriesGranularity`. The bucket follows the span rather than the
  preset — hourly to 48 hours, daily to 120 days, weekly beyond — and day and
  week edges are the operator's local calendar boundaries, not UTC ones. Each
  point carries proxy and CAPTCHA cost separately, along with its bytes,
  requests, and solve count, so the chart can stack the two categories without
  the renderer re-deriving anything. A point's cost is null when nothing in that
  bucket was priced, which is distinct from a bucket that cost zero.
- filters for all, proxy, or CAPTCHA costs and breakdowns by category, provider,
  proxy profile, CAPTCHA kind, store, monitor versus browser, browser profile, and
  run. Rows show the metrics relevant to their category, authority, completeness,
  and most recent activity.
- a reconciliation panel: provider connection/snapshot status, last successful
  refresh/import time, current balance/credit, imported report history, data age,
  and a clearly labelled refresh/import action.
- a budget panel supporting independent proxy and CAPTCHA daily, weekly, and
  monthly budgets in USD (stored as integer micro-USD), with configurable warning
  thresholds and an optional starting-provider-credit figure for proxy budgets.
- budget progress based on provider-confirmed spend when it exists for the period;
  otherwise it uses Copify's estimate and displays that limitation prominently.

Default threshold notifications are 50%, 80%, and 100%. Notifications are local
Windows/app alerts and are de-duplicated once per budget period and threshold.
They are informational by default. An operator may separately enable a
monitor-only hard cap: when the selected budget threshold is reached, Copify stops
new monitor requests and displays an operator alert. A hard cap must never close,
alter, or interrupt an already-running checkout browser, cart, or payment handoff.
CAPTCHA budgets are alert-only and must never cancel, delay, or prevent a solve.

Budgets apply prospectively to traffic observed after the budget is enabled; the
UI may include prior usage in its chart but must label it as pre-budget.

#### Data model and public interfaces

Add persistence for:

- normalized provider usage snapshots and balance snapshots, including provider,
  authority, time range, aggregate bytes/cost/credit, sync time, and data age.
- budget definitions, active period state, fired threshold markers, and
  monitor-only hard-cap state.
- historical, queryable cost aggregates indexed by period, provider, proxy,
  source, store, browser profile, and run.

Use schema migrations that preserve existing proxy profiles, encrypted secrets,
browser profiles/directories, monitors, runs, benchmarks, network-usage rows, and
warming/coherence data. Provider tokens are encrypted via `safeStorage` and must
not be part of database exports, telemetry, renderer logs, or error messages.

Add typed IPC APIs/events for reading period summaries and breakdowns, updating
budgets, creating/removing a provider connection, importing a report, requesting a
refresh, and publishing budget/reconciliation status. Renderer payloads contain
only redacted provider-connection metadata and normalized monetary/usage results.

#### Testing and acceptance criteria

Test all arithmetic using integer boundaries, decimal GB conversion, zero/unknown
rates, partial measurements, direct traffic, and large cumulative totals. Verify:

- monitor and browser totals equal their route/session/store/run breakdowns.
- estimates use the cost rate snapshotted with each usage record, even if a proxy's
  price changes later.
- CSV malformed rows are previewed/rejected without persisting partial imports;
  duplicate imports are idempotent.
- provider/API failures, stale snapshots, and missing permissions remain visible
  but do not stop runs.
- confirmed values never combine with estimates, and the UI labels authority,
  completeness, data age, and timezone correctly.
- budgets reset deterministically at their defined local period boundary, fire each
  threshold once, and a monitor-only hard cap never sends a checkout-runner pause,
  stop, or browser-close command.
- proxy passwords, API tokens, URLs, headers, cookies, addresses, payment data,
  and raw imported reports never appear in renderer payloads, cost tables, events,
  diagnostics, telemetry, or logs.

Manual validation uses a DataImpulse plan with a configured rate (for example,
`$1.00/GB`): run a monitor and a sticky-browser checkout rehearsal without
submitting an order; verify live estimate growth, source breakdowns, budget alert
deduplication, and a dashboard/CSV or authorized API reconciliation. The final
screen must make it clear whether a displayed number is Copify-estimated,
provider-confirmed, or manually confirmed.

Success criteria:

- An operator can understand current spend, estimated remaining credit, budget
  status, and which routes/runs generated traffic without revealing secrets.
- DataImpulse-reported usage can reconcile with Copify's estimate, while any
  unmeasured difference is explained rather than hidden.
- Cost controls never initiate payment or override a session's resolved checkout
  mode, and they never interrupt an active checkout browser.

---

### v0.13 — Hybrid CAPTCHA Engine & Strategy Routing

**Implementation status:** Packaged locally as v0.13.0; commit, tag, publishing, and installed-app smoke testing remain separate release actions.

Copify resolves supported checkout challenges locally by default while allowing
operators to opt individual sessions into low-latency API solving. The engine is
runner-local and reuses existing warmed contexts; it does not introduce a remote
Copify service or a second browser profile.

#### Deliverables

- Add the headed Local Harvester in the challenged runner's persistent
  `BrowserContext`, with automatic completion detection and solution application
  for Turnstile, reCAPTCHA v2/v3, hCaptcha, DataDome, AWS WAF, Arkose Labs
  FunCaptcha, and GeeTest v3/v4.
- Add the pluggable `CaptchaSolver` contract, a CapSolver adapter, compatible
  fast-token/custom endpoint support, asynchronous polling, cancellation, and
  normalized provider diagnostics.
- Implement the precedence rules in section 19 and snapshot the resolved strategy
  per Run Session. The Run setup board can override each selected browser for A/B
  testing without changing its saved profile.
- Implement automatic API-to-Harvester failover on timeout, provider error,
  invalid authentication, insufficient credit, or unavailable service while
  preserving the challenged checkout state.
- Add **Settings -> CAPTCHA** with app mode, provider selection, sanitized custom
  endpoint, encrypted API-key replacement/removal, timeout, fallback state, and
  explicit connection/balance diagnostics. Diagnostics expose normalized status
  and balance only and do not poll during a drop.
- Persist structured challenge, request, acquisition, and failover events with
  solve duration and normalized micro-USD cost, never the token or provider secret.
- Project each `CAPTCHA_TOKEN_ACQUIRED` event into the cost ledger exactly once,
  including Lab solves, and expose provider/kind/store/profile/run breakdowns plus
  independent CAPTCHA budgets. Validation and completion events repeat diagnostic
  cost fields but must not create additional charges. Unknown provider costs remain
  visible as unpriced solves and are excluded from spend totals.

#### Success criteria

- Successful API solves return and apply a usable solution within the provider's
  documented latency range. The sub-four-second target applies to fast token
  challenges; interactive and clearance-cookie systems may take longer.
- API-with-fallback opens the Harvester at the configured threshold (5,000 ms by
  default) or immediately on terminal provider failure, ignores late API results,
  and unblocks the existing checkout without page-state loss.
- One-click and manually completed Harvester challenges are detected and injected
  without copy-paste or an explicit Resume action.
- Two sessions in one Run can use different strategies and the Run Inspector shows
  their resolved strategy, duration, cost, failover, and outcome side by side.
- Solver keys, raw requests/responses, CAPTCHA tokens, and credential-bearing URLs
  are absent from renderer state, SQLite exports, run exports, traces, telemetry,
  screenshots, and logs.

---

### v0.14 — Encrypted Payment Profiles & Full Auto-Checkout

#### Deliverables

- Publish package version `0.14.0`, SQLite schema version `20`, and IPC version
  `21`; migrate existing targets to Assisted/Unlimited and historical checkout
  Runs to explicit Assisted legacy/manual behavior.
- Add Payment Profile CRUD for cards and VCCs using one
  `safeStorage` ciphertext payload plus redacted metadata.
- Add secure batch intake through main-process CSV parsing and multiline paste,
  with a redacted preview, two-minute opaque token, normalized Revolut/MB WAY
  tags, explicit selection, and optional batch-to-browser assignment helpers.
- Validate labels, card kind, Luhn checksum, expiry, CVV shape, and duplicates;
  encrypt and persist the selected rows atomically or roll back the whole batch.
- Support a Browser Profile default Payment Profile and an ephemeral per-session
  Run setup override. No Payment Profile is selected automatically.
- Resolve and snapshot Assisted versus Full Auto-Checkout per session. Full Auto
  supports adapter-controlled Shopify checkout form submission and authenticated
  Shop Pay submission. Gateway-token execution is deferred to v0.19.
- Add just-in-time main-to-runner secret delivery with scoped lifetime, fail-closed
  secure-storage handling, payment-surface diagnostic suppression, and complete
  payment-secret redaction.
- Implement the Run-level atomic checkout quota, reservations, failure release,
  accepted-order counting, deterministic `order_index`, `UNLIMITED` execution,
  and the `CHECKOUT_LIMIT_REACHED` terminal state.
- Continue automatically through frictionless 3DS and dynamically hand off only
  interactive OTP, bank-app, biometric, or issuer verification.

#### Success criteria

- A prepared Full Auto session dispatches its final submission in less than one
  second measured from `READY_TO_SUBMIT` after CAPTCHA/payment readiness and quota
  reservation; provider network acceptance time is measured separately.
- Assisted and Full Auto sessions can run together without sharing resolved
  secrets or strategies, and their checkout latencies/outcomes compare correctly.
- Concurrent finite-cap sessions cannot reserve or accept more orders than the
  cap; failed attempts release capacity immediately. `UNLIMITED` does not
  serialize independent submissions.
- Interactive 3DS foregrounds exactly one actionable window and resumes in the
  original checkout mode after the issuer flow returns.
- Apart from the isolated initial-entry/paste control and its scoped write-only
  IPC submission, payment plaintext never enters shared renderer state. Payment
  plaintext, ciphertext, CVV, card number, and gateway tokens never appear in
  events, artifacts, telemetry, exports, logs, or read APIs.
- Valid CSV/paste batches create the selected redacted profiles in one commit;
  malformed rows, token expiry, cancellation, unavailable `safeStorage`, or any
  encryption failure leave no partial profiles or retained source plaintext.

---

### v0.15 — Release Calendar & One-Click Arming

#### Deliverables

- Expand the versioned monitoring descriptors introduced in v0.10.5 into full
  Capability Manifest v2 governance before Calendar features consume it.
  Monitoring, targeting, cart, checkout, payment, release-feed, and future raffle
  capabilities use discriminated supported/unsupported descriptors.
- Require adapter handler registration and startup validation for every advertised
  capability. Renderer visibility, IPC authorization, preflight, and runner
  dispatch use shared selectors rather than store-ID branches.
- Add a dedicated Calendar tab for upcoming releases with store, local release
  time/timezone, retail price/currency, imagery, source attribution, and target state.
- Support offline manual release creation plus opt-in, read-only
  `ReleaseFeedProvider` adapters. Network feeds refresh only on request or at a
  configured low frequency and never become a run dependency.

```ts
interface ReleaseFeedProvider {
  id: string;
  refresh(input: {
    cursor?: string;
    since?: number;
  }): Promise<{
    releases: NormalizedRelease[];
    nextCursor?: string;
    fetchedAt: number;
  }>;
}
```

- Normalize and deduplicate releases by source identity and stable store/product/
  time keys. Cache normalized records and bounded imagery on disk, with paths and
  hashes in SQLite; do not retain unnecessary raw feed payloads.
- Preserve source timestamps and timezone identifiers, display times in the
  operator's selected timezone, and expose cache age and refresh failures.
- Generate a Target from a Calendar entry in one action, carrying store, product
  identity, release time, known retail limit, image, and source attribution. If
  required adapter inputs such as size priorities are missing, open the Target
  drawer for completion instead of arming an invalid target.

#### Success criteria

- Manual and previously cached releases remain usable with no network connection.
- Repeated feed refreshes are idempotent, update changed entries without
  duplicating them, and preserve operator edits/target links.
- One-click generation produces a valid armed Target when all required fields are
  available, otherwise it presents only the missing fields and arms after validation.
- Feed errors, invalid rows, stale data, or failed image downloads remain visible
  but never block an existing Target or active Run.
- Alternate-store and raffle-only fixtures render solely from their manifests;
  missing handlers disable the capability with a typed reason, and no core/UI
  store-ID branch is required. Raffle entry automation remains out of scope.

---

### v0.16 — Typed Hot-Path IPC & Dispatch Performance

#### Deliverables

- Preserve separate monitor and runner child processes and split IPC into a typed
  JSON control plane plus compact binary variant-signal hot path.
- Add the versioned `VariantSignalFrameV1` encoder/decoder with numeric run/target
  handles, sequence, monotonic detection time, lossless variant ID, and integer
  minor-unit price.
- Pre-register static target/session metadata during startup. Send product URLs,
  images, human-readable variant data, and diagnostics separately so direct cart
  execution does not wait for them.
- Enable advanced child-process serialization, negotiate the protocol before
  `SESSION_READY`, deduplicate sequences per target, and fail closed on malformed
  frames or incompatible worker versions.
- Add isolated Windows synthetic fan-out benchmarks and expose
  `monitor_signal_to_runner_receipt_ns` independently from network/browser time.

#### Success criteria

- Large Shopify IDs and prices round-trip losslessly, duplicate/out-of-order
  frames never execute twice, and malformed or mismatched frames cannot arm a run.
- With 20 runner recipients under synthetic Windows load, monitor emission to
  runner receipt remains below 2 ms at p95 and 5 ms at p99; browser and network
  execution time is reported separately.
- Hot-path frames contain no proxy, account, checkout, payment, or CAPTCHA secret,
  and child-process crash isolation remains unchanged.

---

### v0.17 — Runtime Proxy Resilience & Pre-Checkout Auto-Failover

#### Deliverables

- Add ordered Browser Profile backup routes, redacted watchdog snapshots, route
  reservation, and run-snapshotted health/failover policy.
- Combine passive monitor/navigation telemetry with bounded pre-warm probes.
  Classify application-level failures as packet loss and enforce the default
  timeout, rolling-failure, and latency thresholds from section 11.2.
- Let the monitor acquire another healthy route independently. Before variant
  execution, relaunch a degraded browser's same persistent profile on its next
  healthy backup, reapply GeoIP coherence, verify the route, and restore standby.
- Make failover session-only. Preserve the saved primary and backup order; after
  variant selection, carting, or checkout begins, alert and record degradation
  without changing the browser route.
- Add Run board/Inspector health state and redacted `PROXY_HEALTH_DEGRADED`,
  `PROXY_FAILOVER_STARTED`, `PROXY_FAILOVER_COMPLETED`,
  `PROXY_FAILOVER_EXHAUSTED`, and `PROXY_FAILOVER_FAILED` events.

#### Success criteria

- Timeout, failure-rate, latency, and country-mismatch fixtures select only an
  enabled, non-rotating, coherent, unreserved backup and never open two Chrome
  processes against one `userDataDir`.
- Successful failover preserves persistent profile state, returns to storefront
  standby, and does not mutate the saved primary route. Exhaustion stops safely
  before checkout with an actionable reason.
- Degradation after variant execution produces one deduplicated alert and no
  route mutation. Proxy credentials and provider session tokens never enter
  health snapshots, events, renderer state, diagnostics, or logs.

---

### v0.18 — IP Route Qualification & Evidence-Based Selection

Copify qualifies network routes before payment automation is introduced. The
goal is not to declare one proxy category, country, or provider universally best;
it is to establish which affordable routes are reliable for the operator, store,
and current time window while preserving stable browser identity.

#### Deliverables

- Add a provider-agnostic **Route Qualification** workflow covering four initial
  cohorts: Portuguese home/direct, Portuguese sticky residential, Portuguese
  static ISP, and a foreign-EU static ISP candidate (Germany initially). Additional
  countries remain ordinary candidates rather than store-specific code paths.
- Benchmark the real configured storefront through each route using bounded,
  checkout-safe requests. Record proxy tunnel/connect time, TLS time where
  observable, time to first byte, total response time, p50/p95/p99, jitter,
  success/failure rate, timeout rate, HTTP status classes, and challenge/rate-limit
  observations. Never submit a cart, payment, or order as part of qualification.
- Verify and persist redacted route identity: public exit IP, country/region,
  ASN/organization, observed network classification, protocol, and observation
  source/time. Third-party IP classifications may disagree and are evidence, not
  a universal "fraud score."
- Add an **IP Stability Test** spanning the configured pre-warm/run duration.
  Detect an exit change behind unchanged credentials, record observed sticky TTL,
  invalidate affected qualification results, and prevent a route whose remaining
  observed lifetime cannot cover the snapshotted run window from being marked
  checkout-ready.
- Add a target-scoped qualification score weighted toward reliability, then
  latency, jitter, IP stability, challenge/rate-limit observations, and effective
  cost. Preserve the raw measurements and score inputs so a recommendation is
  explainable. A faster foreign route does not win when its reliability or
  qualification confidence is materially worse.
- Add qualification confidence and freshness. Scores include sample count,
  tested endpoints, observation windows, last-qualified time, and route identity.
  A provider-forced exit change, country/ASN change, expired sticky window, or
  configurable age threshold makes the qualification stale and requires retest.
- Add a **Route Lab** UI in Settings for side-by-side cohort comparison, bounded
  test execution, saved trial notes, cost per IP/GB/month, and an explicit
  operator-controlled `QUALIFIED`, `REJECTED`, or `UNVERIFIED` decision. The UI
  must distinguish observed facts from provider claims and Copify inferences.
- Add a small-trial purchase policy to recommendations: Copify may recommend which
  cohort to test next, but it never recommends bulk purchasing from reputation or
  advertised location alone. Matched PT/DE inventory from one provider is
  preferred for country A/B tests when available, without hardcoding that provider.
- Snapshot the selected route's qualification record into each Run Session and
  expose qualification age, confidence, cohort, stability, and score beside actual
  run outcomes. Historical results may later refine cohort recommendations without
  silently changing an armed Run.
- Treat home/direct as a first-class route and cost baseline. Copify must not
  require a proxy for top-tier readiness, and it must not assume that a German or
  UK route is closer to a Shopify origin because storefront and checkout traffic
  may be served through distributed edge infrastructure.
- Keep browser-route coherence separate from payment-risk interpretation. Copify
  reports IP/billing/shipping country differences but never claims that matching
  timezone, locale, language, geolocation, EU membership, Schengen membership, or
  currency removes those differences or guarantees order acceptance.

#### Success criteria

- An operator can compare PT home, PT sticky residential, PT static ISP, and DE
  static ISP candidates over equivalent endpoints and observation windows without
  modifying store adapters or execution logic.
- A recommendation cannot become `QUALIFIED` from a single latency sample,
  provider-advertised response time, community success report, country label, or
  inferred server location. Missing sample depth remains visibly `UNVERIFIED`.
- Re-running an equivalent test produces raw and aggregate metrics that can be
  compared without overwriting prior evidence; p95/p99, failures, challenges,
  stability, confidence, freshness, and cost remain visible beside median latency.
- Forced sticky-IP rotation and unexpected country/ASN changes are detected,
  invalidate the prior identity-bound qualification, and cannot mutate an active
  checkout route.
- An armed Run uses only its snapshotted qualification and route. New benchmarks,
  price edits, provider metadata, and recommendation changes cannot alter it.
- Qualification traffic is bounded, rate-aware, independently cancellable, and
  disabled for a route while that route is executing an armed Run.
- Proxy credentials, provider session tokens, full public IPs in renderer exports,
  checkout data, addresses, and payment data never enter qualification logs,
  diagnostics, telemetry, screenshots, or exported reports.

---

### v1.0 — Stable Windows Release

Requirements:

- Production installer.
- Automatic database migrations.
- Safe update strategy.
- Robust error handling and production logging.
- Profile backup/import strategy.
- End-to-end verified Supreme drop readiness.
- Capability Manifest v2 startup validation and alternate-store fixture gate.
- Batch Payment Profile import security/redaction and atomic rollback gate.
- Typed hot-path Windows latency and compatibility gate.
- Controlled primary-route degradation and pre-checkout backup failover gate.
- Multi-source discovery degradation, deduplication, bandwidth, and collection-
  fallback gate.

---

### v1.1 — macOS

Requirements:

- macOS packaging.
- Keychain-backed `safeStorage`.
- Chrome detection and window focus behavior.
- Platform notifications.

---

### v1.2 — Linux

Requirements:

- Linux packaging (AppImage / deb).
- Secret Service / KWallet support.
- Desktop notification abstraction.

---

## 43. Testing Strategy

### Unit tests

Test:

- target matching
- variant priority
- price limits
- state transitions
- event serialization
- proxy scoring
- proxy watchdog windowing and failover eligibility
- network redaction
- `VariantSignalFrameV1` encoding, decoding, bounds, and sequence handling
- capability selector and registry validation
- direct cart payload building
- human input trajectory math
- checkout/CAPTCHA strategy precedence and snapshot resolution
- CAPTCHA event payload serialization and redaction
- checkout quota reservation, release, and order indexing
- secure batch-payment validation, token expiry, and atomic rollback
- release-feed normalization, deduplication, and timezone conversion
- discovery-source scheduling, canonical URL/handle deduplication, source backoff,
  sitemap baseline pruning, and verified-winner selection

### Integration tests

Test:

- persistent browser startup with rebrowser stealth patches
- profile reuse and cookie retention
- proxy application and GeoIP coherence
- pre-checkout same-profile proxy failover and post-variant route immutability
- decoupled monitor polling and IPC broadcasting
- concurrent collection/sitemap/predictive-search discovery, same-route hydration,
  and direct-product precedence
- hot-path protocol negotiation and 20-runner Windows fan-out
- direct-carting execution
- Harvester DOM/callback capture and token injection for every supported challenge type
- API solver success, timeout, invalid-token, credit failure, and late-result failover
- encrypted Payment Profile create/use/delete with unavailable or corrupt `safeStorage`
- CSV/paste batch preview, cancellation, expiry, full rollback, and plaintext-leak checks
- Assisted, Full Auto, frictionless 3DS, and interactive 3DS fallback flows
- concurrent finite and unlimited checkout quotas
- manual/cached Calendar operation and opt-in feed refresh
- manifest/handler mismatch, unsupported-capability, alternate-store, and raffle-only fixtures
- crash recovery
- run persistence

### Adapter tests

Use:

- local fixtures
- saved sanitized HTML / Shopify JSON
- controlled test pages

Avoid relying exclusively on the live Supreme website for automated tests.

Use controlled challenge fixtures and stub solver providers; automated tests must
not spend provider credit or submit real orders. Assert that tokens, keys, payment
data, endpoints with credentials, and raw provider bodies are absent from all
captured renderer payloads, events, logs, exports, traces, and screenshots.

Discovery fixtures cover collection-first, sitemap-first, predictive-search-first,
simultaneous matches, and no winner. Sitemap coverage includes root indexes,
ranged/sharded product maps, malformed XML, duplicates, changed entries, initial
baseline behavior, validators, compression, and body limits. Predictive-search
coverage includes URL encoding plus `200`, `403`, `404`, `429`, malformed JSON,
and irrelevant results. A candidate cannot win before same-route hydration and
the normal keyword, variant, availability, and price checks succeed.

Tests must prove one failed source does not stop healthy sources, source-level
protection responses do not mark a proxy unhealthy, one/two-route reuse remains
operational, and direct-product targets never start the discovery mesh. Accurate
per-source response-byte accounting and the 30-second standby / 5-second Turbo
sitemap cadence are acceptance gates. Live Supreme testing confirms collection
fallback only; automated tests do not assume its optional endpoints are exposed.

Calendar tests cover malformed/duplicate feed rows, source updates, stale and
offline cache reads, failed images, daylight-saving boundaries, incomplete target
generation, and preservation of operator edits. Checkout concurrency tests force
simultaneous ready states to prove finite quotas cannot overshoot, failed
reservations free capacity, success indices are deterministic, and `UNLIMITED`
does not serialize submissions.

Proxy resilience tests inject consecutive timeouts, rolling request failures,
latency spikes, public-country mismatches, stale/reserved backups, relaunch
failure, and total exhaustion. They verify that monitor failover is independent,
browser failover is session-only and pre-execution only, the same profile
directory is preserved, and the saved primary assignment is unchanged.

IPC tests cover lossless large variant IDs, integer price boundaries,
duplicate/out-of-order signals, malformed frames, protocol mismatch, runner
crashes, restart negotiation, and metadata arriving after the hot signal. A
dedicated Windows benchmark asserts p95 below 2 ms and p99 below 5 ms from
monitor emission to runner receipt with 20 recipients.

### Manual release testing

Use low-demand products and dry-run mode before using Copify on a target release.

---

## 44. Performance Principles

Copify should optimize for:

1. Reliability.
2. Determinism.
3. Observability.
4. Fast reaction (< 400ms direct-carting).
5. Low unnecessary network traffic.
6. Local fallback when an optional solver or release feed is unavailable.
7. Measured low-copy dispatch without weakening process isolation.
8. Pre-checkout route recovery without violating checkout affinity.
9. Earliest verified public-source discovery without multiplying large sitemap
   traffic at the high-frequency collection cadence.

Do not optimize a 20 ms microbenchmark at the cost of session stability.

The typed hot path is justified only by measured monitor-to-runner dispatch
latency. It must not move runners into the Electron main process, replace them
with worker threads, or introduce native shared-memory complexity.

A stable 70 ms route is preferable to a 35 ms route with intermittent failures.

---

## 45. Metrics That Matter

The most useful measurements are:

- `drop_to_product_detected_ms`
- `product_detected_to_direct_cart_ms`
- `cart_to_checkout_ms`
- `checkout_to_checkpoint_ms`
- `human_checkpoint_or_3ds_duration_ms`
- `captcha_solve_duration_ms`
- `captcha_solve_cost_micros_usd`
- `captcha_failover_count`
- `ready_to_submit_to_dispatch_ms`
- `payment_submission_to_result_ms`
- `checkout_limit_reached_count`
- `successful_order_index`
- `checkout_to_ready_confirm_ms`
- `total_run_duration_ms`
- navigation error count
- network error count
- HTTP 4xx count
- HTTP 5xx count
- proxy route stability
- proxy health degradation count
- proxy failover duration and outcome
- `monitor_signal_to_runner_receipt_ms`
- `discovery_source_to_verified_candidate_ms`
- discovery source latency, response bytes, candidate count, availability, and
  backoff duration
- discovery winner count by source
- discovery duplicate/suppressed winner count
- IPC frame rejection/duplicate count
- runner crash count

---

## 46. Product Philosophy

Copify should not become a black-box tool that says only:

```text
FAILED
```

It should say:

```text
FAILED — SOLD OUT

Product detected        +82 ms  (Decoupled TLS Monitor)
Direct-cart submitted   +140 ms (in-page cart/add.js)
Cart confirmed          +310 ms
Checkout reached        +680 ms
Shop Pay recognized     +820 ms
3DS approval completed  +3.10 s
Stock exhausted         +4.20 s

Likely bottleneck:
3DS bank approval added 2.28 s.
```

The value of Copify is not merely automation.

The long-term differentiator is:

> **Run the drop, measure everything, understand the result, improve the next run.**

---

## 48. Initial Definition of Done

The first meaningful Copify milestone is reached when the following scenario works:

1. User opens Copify on Windows.
2. Three saved browser profiles are visible.
3. Profile A uses home internet.
4. Profile B uses a configured fixed/sticky proxy.
5. Profile C uses another configured fixed/sticky proxy.
6. User clicks **Open All**.
7. Three independent headed Chrome processes launch with stealth hardening.
8. Every browser has its own persistent profile and pre-warms on the storefront.
9. Copify verifies the public route and GeoIP coherence for each session.
10. Copify verifies ordered backups and can recover a degraded route before execution by relaunching the same persistent profile without changing its saved primary.
11. A direct URL is polled directly; otherwise the decoupled monitor concurrently checks every due, supported public discovery source and degrades to collection-only when optional sources are blocked.
12. The first fully hydrated acceptable candidate wins exactly once and dispatches a versioned typed variant signal.
13. On drop, runners execute direct carting and reach checkout concurrently without waiting for diagnostic metadata.
14. Copify records timing, screenshots, console errors, sanitized network metadata, discovery-source health/bytes/winner, route-health/failover state, and hot-path dispatch latency.
15. Each session follows its snapshotted CAPTCHA and checkout strategy; Assisted sessions wait for confirmation and Full Auto sessions submit within the configured checkout quota.
16. If an issuer presents interactive 3DS verification, Copify foregrounds that session and resumes after human completion.
17. Batch-imported Payment Profiles remain encrypted and expose only redacted metadata.
18. The Run Inspector displays discovery-mesh status plus all session timelines, resolved strategies, solve telemetry, checkout latency, quota outcome, order index, IPC timing, and route failover side by side.

---

## 49. Immediate Implementation Order

Locked implementation sequence; v0.13 is the current completed milestone:

```text
1. v0.8: Ghost-cursor Bezier mouse movement & drop-tuned click dwell
2. v0.8: Simulated clipboard paste & human typing cadence for forms
3. v0.9: Decoupled Crawlee/Undici HTTP monitor with browser-standard headers; `impit` remains the future path for browser-grade TLS/HTTP fingerprint impersonation
4. v0.9: Sub-400ms in-page direct carting (fetch('/cart/add.js')) & /cart/{id}:1
5. v0.10: Automated GeoIP to Timezone/Locale/Geolocation coherence
6. v0.10: WebRTC leak prevention & Profile Warmup workflow (Google / Shop Pay)
7. v0.10.5: Capability-driven collection/sitemap/predictive-search discovery mesh with direct-URL precedence
8. v0.11: Historical drop metrics & post-run analytics
9. v0.12: Cost accounting, budgets & provider reconciliation
10. v0.13: Hybrid CAPTCHA engine, strategy routing & Local Harvester failover
11. v0.14: Encrypted Payment Profiles, secure CSV/paste batch intake, Full Auto-Checkout & atomic checkout quotas
12. v0.15: Capability Manifest v2, Release Calendar, cached feed adapters & one-click target arming
13. v0.16: Typed low-copy variant IPC, protocol negotiation & Windows dispatch performance gates
14. v0.17: Runtime proxy watchdog, ordered backups & session-only pre-checkout failover
15. v0.18: IP route qualification, PT/DE cohort lab, stability gates & evidence-based selection
16. v0.19: Gateway-token investigation, eligibility contract & execution adapters
17. v1.0: Windows production release & installer
```

---

## 50. Open Decisions

These items are intentionally not finalized yet:

- Whether Chrome only or Chrome + Edge are supported on Windows.
- Exact proxy providers used in production.
- Additional CAPTCHA solver providers beyond CapSolver and compatible custom endpoints.
- Exact community release-feed providers and authentication schemes.
- Additional payment gateways beyond the first Shopify and Shop Pay adapters.
- Exact Supreme selector implementation for fallback PDP navigation.
- Whether a companion browser extension is ever necessary.
- Cloud sync or account system.
- Commercial licensing/distribution model.
- Auto-update mechanism.
- macOS/Linux release packaging.
- Whether per-store shipping addresses are needed.
- When to split `packages/stores` and `packages/observability` out of `packages/runner`.

These should be decided only when the preceding architecture gives enough evidence.

---

## 51. Summary of Locked Decisions

The following decisions are considered **locked unless new evidence justifies changing them**:

- Product name is **Copify**.
- Copify is a local-first desktop application.
- Windows is the first platform; macOS and Linux come later.
- Stack: Electron + React + TypeScript + Node.js + SQLite (`node:sqlite` + Drizzle).
- Automation architecture is **Model B: persistent headed Chrome processes** controlled via **`rebrowser-playwright`** (zero CDP `Runtime.enable` leaks).
- Each browser uses a unique persistent profile (`userDataDir`).
- Browser runners execute in separate Node child processes.
- Child-process IPC uses a JSON control plane and versioned low-copy typed variant hot path; literal shared-memory zero-copy is out of scope.
- Storefront monitoring is **decoupled** from browser sessions, using high-frequency Crawlee/Undici HTTP requests with browser-standard headers; it does not currently spoof TLS/JA3/JA4 or HTTP/2 fingerprints.
- Targets with a direct product URL use direct polling; URL-less keyword Targets
  use a capability-declared, concurrently raced collection, sitemap, and
  predictive-search mesh whose candidates must be hydrated and fully verified before one
  deduplicated `VARIANT_SELECTED` is emitted.
- Sitemap and predictive search are best-effort public sources with adaptive
  cadence, route-scoped probes/backoff, and collection fallback; they neither
  guarantee cache bypass nor access to products absent from all public sources.
- Browser sessions remain **pre-warmed** in standby on the storefront prior to drop.
- High-speed execution utilizes **Direct-Carting via `variantId`** (`cart/add.js` in-page execution and direct cart navigation).
- Browser interactions utilize **human input abstraction (`ghost-cursor`)** with Bezier trajectories, natural click dwell, and simulated paste.
- Profiles maintain **strict 1:1 GeoIP coherence** with their assigned proxy routes (Timezone, Locale, Geolocation, WebRTC leak prevention).
- Persistent profiles support **Profile Warming** (retaining Google human trust scores $\ge 0.9$ and Shop Pay authentication).
- Proxies are modeled independently from browser profiles; a session uses one locally fixed network route for its lifetime, subject to the external provider's sticky-session TTL.
- Route selection is evidence-based and target-scoped. Home/direct remains the
  control; PT and foreign-EU proxy cohorts are qualified through bounded real-route
  measurements, and no provider, proxy category, country, or assumed Shopify
  origin is universally preferred.
- Route qualification records identity-bound stability, reliability, latency,
  jitter, challenge/rate-limit observations, cost, confidence, and freshness.
  Provider claims, community reports, and third-party IP classifications remain
  attributed evidence rather than facts or universal fraud scores.
- Browser-route GeoIP coherence prevents internal browser contradictions but does
  not erase IP/payment/address country differences or guarantee AVS, fraud, order,
  or fulfillment outcomes.
- Browser Profiles may declare ordered backup proxies. Automatic failover is a session-only same-profile relaunch before variant execution and never mutates an active checkout route or the saved primary assignment.
- Copify supports both **Assisted Checkout** and **Full Auto-Checkout**, resolved and snapshotted per session.
- CAPTCHA resolution is hybrid and local-first: manual Harvester, solver API, or API with automatic fallback, all using the runner's warmed context.
- Target, Browser Profile, and ephemeral Run-session overrides form the locked checkout/CAPTCHA strategy hierarchy defined in section 19.
- Full Auto-Checkout may submit authenticated Shop Pay or checkout-form CARD/VCC payments automatically; gateway-token execution is deferred to v0.19, and interactive issuer 3DS/PSD2 verification triggers human handoff.
- Payment Profiles and CAPTCHA/provider credentials are encrypted exclusively with Electron `safeStorage` and are strictly excluded from renderer state, exports, diagnostics, telemetry, and logs.
- Batch card/VCC intake is local CSV/paste only, exposes a redacted preview through an opaque expiring token, and commits encrypted profiles atomically; direct banking/provider APIs are out of scope.
- Targets define `maxCheckouts`; the Orchestrator enforces finite caps with atomic reservations and permits independent submissions when the value is `UNLIMITED`.
- The release Calendar is local-first: manual and cached entries work offline, while community feeds are optional read-only adapters.
- Every drop attempt is modeled as a `Run` with monotonic nanosecond precision.
- UI is an operations console: near-monochrome, rows over cards, drawers for forms, frameless window with app-drawn titlebar.
- Themes derive every token from four bases in `tokens.css`; no other stylesheet names a colour. Dark is the default, with Light and System alongside it.
- Capability-driven store architecture: Capability Manifest v2 governs UI, IPC, preflight, and runner dispatch through shared selectors and validated adapter handlers rather than core/UI store branches.
