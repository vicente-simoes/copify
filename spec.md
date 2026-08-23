# Copify — Product & Engineering Specification

**Document:** `spec.md`  
**Product:** Copify  
**Status:** Living specification — implemented through v0.5.5  
**Primary platform:** Windows  
**Future platforms:** macOS, Linux  
**Date:** 2026-08-23

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

2. **Assisted checkout**
   - Copify may detect products, select configured variants, add products to cart, navigate toward checkout, fill non-sensitive checkout information, and prepare a session for purchase.
   - Human intervention is required for security challenges, CAPTCHA, 3DS, unexpected checkpoints, and final purchase confirmation where appropriate.

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
- Assist with add-to-cart and checkout navigation.
- Pause and foreground the relevant browser when human intervention is required.
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

## 3. Explicit Non-Goals

Copify is **not** intended to implement:

- CAPTCHA bypass.
- hCaptcha/reCAPTCHA circumvention.
- Queue bypass.
- Fingerprint spoofing intended to defeat anti-bot systems.
- Automated evasion of retailer purchase limits.
- IP rotation designed to bypass rate limits, bans, or product limits.
- Account farming.
- Fake identities.
- Fraudulent payment behavior.
- Reverse-engineered private checkout APIs as the primary execution path.
- Automated submission of multiple purchases intended to defeat a store's one-per-customer restrictions.

Parallel sessions exist for resilience, debugging, testing, and failover. A global purchase lock should prevent accidental parallel purchase submission for the same target unless a future store adapter explicitly supports a legitimate multi-purchase workflow.

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
- **Playwright** — browser automation and browser instrumentation.
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
│  │  - Secret Storage                            │  │
│  │  - SQLite                                    │  │
│  └──────────────────────┬───────────────────────┘  │
└─────────────────────────┼──────────────────────────┘
                          │ child-process IPC
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
        Runner A     Runner B     Runner C
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

- Starting one persistent Chrome process.
- Applying the assigned proxy configuration.
- Navigating to the configured store.
- Maintaining the browser profile.
- Listening for target instructions.
- Running the store adapter.
- Producing structured events.
- Detecting checkpoints.
- Capturing allowed diagnostics.
- Responding to orchestrator commands.
- Clean shutdown.

### 8.2 Orchestrator responsibilities

The orchestrator is responsible for:

- Starting/stopping runners.
- Assigning profiles.
- Assigning proxies.
- Creating runs.
- Broadcasting product events.
- Coordinating target execution.
- Managing the global purchase/commit lock.
- Collecting events.
- Persisting run summaries.
- Controlling UI-visible state.
- Handling runner crashes and recovery.

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
- `CommitLock`

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

  shippingProfileId?: string;

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
```

### 11.1 Proxy behavior

For a single browser run:

- A browser profile gets one network route.
- The route should remain fixed for the lifetime of the session.
- Copify must not rotate proxy addresses mid-checkout.
- The application should prefer session stability over theoretical raw speed.

### 11.2 Recommended proxy categories

For persistent headed sessions, the preferred types are:

1. Home connection baseline.
2. Static ISP proxy.
3. Sticky residential proxy.

Datacenter proxies may be useful for development/testing but are not the preferred default for production drop sessions.

Mobile proxies are unnecessary for the initial product.

### 11.3 Initial proxy evaluation plan

The first practical benchmark should compare:

- Session A: normal home network.
- Session B: one Portuguese sticky residential route.
- Session C: one Portuguese static/ISP route.

Candidate reputable providers discussed:

- Bright Data.
- Decodo.
- Oxylabs.

Provider branding must not be hardcoded into execution logic. All providers map to the generic `ProxyProfile` abstraction.

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

  preferredColors: string[];
  sizePriority: string[];

  maxRetailPrice: number;

  quantity: 1;

  enabled: boolean;
}
```

`quantity` is fixed at 1 and is not user-editable. It stays in the model so a
future adapter with a legitimate multi-quantity workflow has somewhere to put it.

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

Every store therefore declares a manifest:

```ts
interface StoreManifest {
  id: string;                 // "supreme-eu"
  name: string;               // "Supreme"
  region: string | null;      // "EU"
  currency: StoreCurrency;
  status: "stable" | "beta" | "experimental" | "unsupported";

  capabilities: {
    monitor: "shared" | "in-browser" | null;
    cartInspection: boolean;
    addToCart: boolean;
    checkoutAutofill: boolean;
  };

  variants: {
    sizes: { kind: "enum"; values: string[] } | { kind: "freeform" };
    colors: { kind: "freeform" };
  };
}
```

Manifests are pure data and live in `packages/shared`, so both the main process
and the renderer can read them. Adapter *implementations* stay behind
`StoreAdapter`.

The manifest is the single source of truth for store-specific UI:

| Question | Answered by |
|---|---|
| Can this target be monitored or tested? | `capabilities.monitor !== null` |
| Can a run use assisted checkout? | `addToCart && checkoutAutofill` |
| Should a cart column exist? | `capabilities.cartInspection` |
| Size chips or a free-text field? | `variants.sizes.kind` |
| Which currency? | `currency` — derived, never asked |

A store with no adapter is an ordinary manifest with `monitor: null` rather than
a special case, so it renders through the same path and simply reads as having no
adapter yet.

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

Supreme is the first supported store.

The first version should use the **actual storefront through headed Chromium**.

It should not depend on undocumented internal/private checkout APIs as its primary mechanism.

### 16.1 Supreme adapter responsibilities

- Navigate to the appropriate Supreme storefront.
- Detect product listing updates.
- Locate target products by robust product-name rules.
- Read product price.
- Read available colors.
- Read available sizes.
- Apply target priority rules.
- Add the selected variant to cart.
- Navigate to checkout.
- Fill allowed non-sensitive checkout information.
- Detect checkout queues.
- Detect CAPTCHA/security checkpoints.
- Detect payment/3DS handoff points.
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

---

## 17. Monitoring Strategy

A naive architecture would have every browser continuously poll the storefront.

Copify should instead support a **shared monitor + runner reaction model** where practical.

```text
             Product Monitor
                   │
        TARGET BECOMES AVAILABLE
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
    Runner A    Runner B    Runner C
```

Benefits:

- fewer duplicate requests
- consistent target detection time
- easier debugging
- lower store traffic
- simpler timing comparison

The shared monitor must itself use reasonable request/navigation behavior.

A store adapter may choose browser-native monitoring if the storefront makes a shared monitor impractical.

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
  | "CHECKPOINT"
  | "READY_TO_CONFIRM"
  | "SUBMITTING"
  | "SUBMITTED"
  | "SUCCESS"
  | "SOLD_OUT"
  | "PRICE_LIMIT"
  | "ERROR"
  | "STOPPED";
```

Every transition must create a `RunEvent`.

---

## 19. Human Handoff

Copify must detect situations that require user control.

Examples:

- CAPTCHA.
- hCaptcha.
- reCAPTCHA.
- unexpected checkpoint.
- checkout queue requiring manual waiting.
- payment verification.
- 3DS.
- unexpected site state.

When detected:

1. Runner enters `CHECKPOINT`.
2. Automation pauses.
3. Browser is brought to the foreground.
4. UI highlights the affected session.
5. Optional sound/desktop notification fires.
6. User completes the challenge.
7. User presses **Resume**.
8. The runner reevaluates the page before continuing.

Copify must not implement automated challenge circumvention.

---

## 20. Purchase Commit Lock

Multiple sessions may reach checkout simultaneously.

Copify should include a **global target-level commit lock**.

Purpose:

- preserve redundancy
- prevent accidental duplicate submissions
- allow failover
- improve post-run analysis

Concept:

```ts
interface CommitLock {
  targetId: string;
  ownerSessionId?: string;

  claim(sessionId: string): boolean;
  release(sessionId: string): void;
}
```

Behavior:

```text
Runner A reaches READY_TO_CONFIRM
    ↓
claims CommitLock
    ↓
becomes active purchase path

Runner B reaches READY_TO_CONFIRM
    ↓
cannot claim lock
    ↓
remains paused fallback

Runner A fails
    ↓
lock released
    ↓
Runner B may claim lock
```

This lock is an intentional core design decision.

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
```

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

Sensitive recording should stop before payment confirmation where possible.

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
- future API credentials
- other app secrets

Do not store them in:

- source files
- Git
- plaintext JSON
- unencrypted SQLite columns

### 30.2 Payment information

Copify should not store raw:

- card number
- CVV
- full payment credentials

Prefer browser-supported or payment-provider-supported mechanisms.

Copify may store normal shipping/contact information locally if explicitly configured.

### 30.3 Browser state

Persistent browser profiles may contain authentication material.

They must:

- stay outside the source repository
- be excluded via `.gitignore`
- live under the application data directory
- never be uploaded automatically

### 30.4 Logging redaction

The logger must redact:

- `Authorization`
- `Cookie`
- `Set-Cookie`
- proxy credentials
- checkout tokens
- passwords
- payment fields

Redaction should happen before disk persistence.

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
│           ├── pages/          Run, Browsers, Targets, Shipping, Settings,
│           │                   RunInspector, Proxies, LaunchModes
│           ├── ui/             TitleBar, Sidebar, Menu, Drawer, Toast,
│           │                   StoreMark, primitives, icons
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

Five sections, ordered by the drop workflow — you run from the top item and
prepare below it:

```text
Run        the drop console and landing page
Browsers   browser profiles, routes, cart state
Targets    what to watch for and which variants are acceptable
Shipping   addresses and which browser uses which
Settings   Routes · Stores · Advanced · About
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
CHECKPOINT         PT ISP 01      Cart is not empty.        [ Recheck cart ]
SOLD_OUT           PT RES 01
```

A session waiting on a human is the one thing that must catch the eye mid-drop: it
carries an amber edge and its resume action inline.

### 33.3 Visual language

- **Chrome and content are two surfaces.** A frameless window draws its own 40px
  titlebar sharing one background with the sidebar and no divider between them, so
  the chrome reads as a single L-shaped surface with the content in a well.
  Window controls are OS-drawn in the app palette via `titleBarOverlay`.
- **The titlebar carries identity and state**, not the page name: the mark, the
  wordmark, and a live status chip (ready count, or `REC` with a running clock).
  Page identity comes from the sidebar's active item. The sidebar collapses to a
  52px icon rail.
- **One accent, semantic only.** Primary actions are near-white. Colour means
  state: green for ready and pass, amber for warnings and human handoff, red for
  failure. Never decoration.
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
  on-screen effect appear as a transient toast.
- Empty states are one line and an action.

### 33.5 Visual priorities

The UI emphasises state, timing, failure, action required, target rules, and
network health — in that order.

---

## 34. Notifications

Useful alerts:

- checkpoint detected
- human action required
- product found
- price limit exceeded
- runner crashed
- checkout ready
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
- proxy profile ID

This is necessary because storefront behavior and automation code change over time.

A result should be reproducible enough to answer:

> "Did v0.4.3 perform worse than v0.4.2?"

---

## 36. SQLite Data Model

Initial tables may include:

```text
browser_profiles
proxy_profiles
shipping_profiles
targets
runs
run_sessions
run_events
proxy_benchmarks
app_settings
```

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
```

Large binary artifacts such as screenshots and traces should remain on disk, with paths referenced from SQLite.

---

## 37. Shipping Profiles

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

Payment credentials are intentionally excluded.

---

## 38. Error Taxonomy

Errors should be categorized, not stored as generic strings.

Example:

```ts
type RunnerErrorCode =
  | "BROWSER_START_FAILED"
  | "PROXY_CONNECTION_FAILED"
  | "PROXY_AUTH_FAILED"
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
| Target armed | assisted with no target, target disabled, or store cannot assist | observing with no target |
| Shipping ready | assisted and no selected browser has a complete address | some selected browsers will only observe |
| Price limit set | assisted and the target has no maximum price | — |

The "browsers closed" check exists because a run launches its browsers itself in
order to record from the first navigation, so an already-open browser cannot join
one. The check says that rather than refusing without explanation.

Preflight is implemented in `apps/desktop/src/preflight.ts` as a pure function and
is unit tested. The main process keeps its own guards, so the renderer prevents and
the main process still validates.

---

## 40. Drop Preparation Workflow

A typical drop-day workflow:

### Before drop day

1. Create target.
2. Set product keywords.
3. Set color priority.
4. Set size priority.
5. Set maximum retail price.
6. Assign browser profiles.
7. Assign proxy/network routes.
8. Test every route.
9. Verify browser state.
10. Verify shipping data.
11. Run a low-risk dry run.

### Drop day

1. Launch Copify.
2. Run preflight.
3. Open all browser sessions.
4. Confirm network health.
5. Arm target.
6. Start run recording.
7. Start monitor.
8. Wait for product.
9. Let runners progress toward checkout.
10. Handle human checkpoints.
11. Commit through one active session.
12. End run.
13. Inspect run immediately afterward.

---

## 41. Dry-Run Mode

Copify should eventually include a mode that stops before a real purchase.

Example:

```text
DRY RUN

Product detection       ENABLED
Variant selection       ENABLED
Add to cart             ENABLED
Checkout navigation     ENABLED
Purchase submission     DISABLED
```

Dry runs allow safe testing on ordinary products or test storefronts.

---

## 42. Development Roadmap

### v0.1 — Browser Foundation

Deliver:

- Electron + React shell.
- TypeScript project structure.
- Browser profile CRUD.
- Launch one persistent Chrome process.
- Launch multiple persistent Chrome processes.
- Open/close/restart sessions.
- Basic runner IPC.
- Session state display.

Success criteria:

- Three Chrome sessions run concurrently.
- Each uses a separate persistent profile.
- Closing/reopening Copify retains browser state.
- One runner crash does not crash the app.

---

### v0.2 — Proxy Profiles & Network Health

Deliver:

- Proxy profile CRUD.
- HTTP/HTTPS/SOCKS support through Playwright.
- Secret storage for proxy credentials.
- Per-browser proxy assignment.
- Generic proxy health benchmark.
- Public IP verification.
- Geolocation check.
- Latency/jitter/failure measurement.
- Proxy quality score.

Success criteria:

- Three sessions can run using three distinct configured routes.
- Copify confirms the route used by every session.
- Bad proxies are clearly identified before a run.

---

### v0.3 — Run Engine & Inspector Foundation

Deliver:

- Run creation.
- Run sessions.
- event logger.
- monotonic timestamps.
- SQLite persistence.
- normal/diagnostic/deep-debug modes.
- screenshot manager.
- console capture.
- sanitized network capture.
- optional Playwright traces.
- basic run timeline UI.

Success criteria:

- A complete browser session can be replayed conceptually from its event timeline.
- Two sessions can be compared by timing.
- No sensitive headers are written in Normal mode.

---

### v0.4 — Supreme Product Detection

Deliver:

- StoreAdapter interface.
- SupremeAdapter.
- product matching.
- color parsing.
- size parsing.
- price parsing.
- target engine.
- max-retail kill switch.
- shared monitor where practical.

Success criteria:

- Copify correctly identifies a configured Supreme target.
- It reports available target variants.
- It correctly chooses the highest-priority acceptable variant.
- It refuses targets above max retail.

---

### v0.5 — Cart & Checkout Assistance

Deliver:

- product navigation.
- variant selection.
- add-to-cart.
- cart confirmation.
- checkout navigation.
- shipping autofill.
- checkpoint detection.
- human handoff.
- resume action.

Success criteria:

- On a safe test run, Copify reaches checkout from an armed target without manual browsing.
- Security/payment challenges pause correctly.

---

### v0.5.5 — Interface and store modularity

Delivered:

- Store registry and capability manifest (section 15.1); `storeId` moves from a
  fixed enum to a registry-validated string with no data migration.
- Capability-driven UI: monitorability, assisted eligibility, cart columns, size
  inputs and currency all read from the manifest instead of store-specific
  branches.
- Frameless window with an integrated titlebar and a collapsible sidebar.
- Design tokens; near-white primary actions with colour reserved for state.
- Information architecture reorganised around the drop workflow (section 33.1),
  with Run as the drop console and a blocking preflight (section 39).
- Rows with overflow menus in place of button-covered cards; drawers in place of
  permanent forms; transient toasts in place of a persistent notice bar.
- Run Inspector as a full view with the timeline from section 29.1.
- Copy pass removing kickers, restated headings, architecture explanations, and
  confirmations of already-visible changes.
- Knobs removed: proxy provider branding, expected city, quantity, per-item
  enabled checkboxes, raw benchmark history.

Success criteria:

- A new store adapter is added without editing the renderer, beyond dropping in
  its brand art.
- A misconfigured run cannot be started, and the reason is visible before trying.

---

### v0.6 — Multi-Session Failover

Deliver:

- global `CommitLock`.
- READY_TO_CONFIRM state.
- session failover.
- lock release/reassignment.
- live session priority.
- improved action-required UI.

Success criteria:

- Three sessions may reach checkout.
- Only one is allowed to become the active commit path.
- A failed active session can hand off to a waiting fallback.

---

### v0.7 — Historical Analytics

Deliver:

- historical session metrics.
- browser-profile reliability.
- proxy reliability history.
- percentile timings.
- run-to-run comparison.
- failure aggregation.
- annotations.

Possible metrics:

```text
Median product detection
Median product page load
Median ATC
Median checkout load
Checkout success rate
Network error rate
Checkpoint rate
Runner crash rate
```

---

### v1.0 — Stable Windows Release

Requirements:

- installer.
- automatic database migrations.
- safe update strategy.
- robust error handling.
- production logging.
- profile backup/import strategy.
- complete run inspector.
- settings UI.
- tested Windows Chrome discovery.
- secure secret storage.
- stable Supreme adapter.

---

### v1.1 — macOS

Requirements:

- macOS packaging.
- Keychain-backed `safeStorage`.
- Chrome detection.
- window focus behavior.
- notifications.
- filesystem validation.

---

### v1.2 — Linux

Requirements:

- packaging choice.
- Chrome/Chromium detection strategy.
- Secret Service/KWallet support.
- desktop notification abstraction.
- path handling.
- distro compatibility policy.

---

## 43. Testing Strategy

### Unit tests

Test:

- target matching
- variant priority
- price limits
- state transitions
- commit lock
- event serialization
- proxy scoring
- network redaction

### Integration tests

Test:

- persistent browser startup
- profile reuse
- proxy application
- runner IPC
- trace creation
- crash recovery
- run persistence

### Adapter tests

Use:

- local fixtures
- saved sanitized HTML
- controlled test pages

Avoid relying exclusively on the live Supreme website for automated tests.

### Manual release testing

Use low-demand products and dry-run mode before using Copify on a target release.

---

## 44. Performance Principles

Copify should optimize for:

1. Reliability.
2. Determinism.
3. Observability.
4. Fast reaction.
5. Low unnecessary network traffic.

Do not optimize a 20 ms microbenchmark at the cost of session stability.

A stable 70 ms route is preferable to a 35 ms route with intermittent failures.

---

## 45. Metrics That Matter

The most useful initial measurements are:

- `drop_to_product_detected_ms`
- `product_detected_to_open_ms`
- `product_open_to_variant_selected_ms`
- `variant_selected_to_atc_ms`
- `atc_to_cart_confirmed_ms`
- `cart_to_checkout_ms`
- `checkout_to_checkpoint_ms`
- `human_checkpoint_duration_ms`
- `checkout_to_ready_confirm_ms`
- `total_run_duration_ms`
- navigation error count
- network error count
- HTTP 4xx count
- HTTP 5xx count
- proxy route stability
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

Product detected        +92 ms
Product opened          +171 ms
Variant selected        +244 ms
ATC                     +518 ms
Checkout opened         +1.21 s
Checkpoint detected     +1.84 s
User resumed            +6.91 s
Variant unavailable     +7.22 s

Likely bottleneck:
Checkpoint handling added 5.07 s.
```

The value of Copify is not merely automation.

The long-term differentiator is:

> **Run the drop, measure everything, understand the result, improve the next run.**

---

## 47. Branding

**Product name:** Copify

The name should be used independently of Supreme or Shopify branding.

Avoid names such as:

- Supreme Copify
- Shopify Copify

Store names should only appear as supported adapters/integrations.

Potential internal tagline:

> **Prepare. Run. Inspect. Improve.**

This is an internal positioning line, not a finalized marketing slogan.

---

## 48. Initial Definition of Done

The first meaningful Copify milestone is reached when the following scenario works:

1. User opens Copify on Windows.
2. Three saved browser profiles are visible.
3. Profile A uses home internet.
4. Profile B uses a configured fixed/sticky proxy.
5. Profile C uses another configured fixed/sticky proxy.
6. User clicks **Open All**.
7. Three independent headed Chrome processes launch.
8. Every browser has its own persistent profile.
9. Copify verifies the public route for each session.
10. User creates a test run.
11. Every runner sends structured events.
12. User browses through each session.
13. Copify records timing, screenshots, console errors, and sanitized network metadata.
14. User ends the run.
15. The Run Inspector displays all three session timelines side by side.
16. Closing and reopening Copify preserves the browser profiles.
17. No raw payment credentials or proxy passwords appear in logs.

This milestone corresponds approximately to **v0.1 + v0.2 + the core of v0.3**.

Only after this foundation is reliable should Supreme-specific purchase assistance become the development priority.

---

## 49. Immediate Implementation Order

Recommended coding order:

```text
1. Repository + Electron/React/TypeScript scaffold
2. Shared IPC/type contracts
3. SQLite setup and migrations
4. BrowserProfile CRUD
5. Runner child-process protocol
6. Persistent Chrome launcher
7. Session dashboard
8. ProxyProfile CRUD
9. safeStorage secret handling
10. Proxy application to runners
11. Proxy benchmark
12. Run model
13. structured event logger
14. Run artifacts directory
15. Run Inspector timeline
16. diagnostic modes
17. StoreAdapter abstraction
18. SupremeAdapter
19. Target engine
20. ATC/checkout assistance
21. CommitLock/failover
22. Historical analytics
```

---

## 50. Open Decisions

These items are intentionally not finalized yet:

- Whether Chrome only or Chrome + Edge are supported on Windows.
- Exact proxy providers used in production.
- Exact Supreme selector implementation.
- Exact monitor implementation.
- Whether final purchase confirmation is always manual or store-configurable.
- Whether a companion browser extension is ever necessary.
- Cloud sync or account system.
- Commercial licensing/distribution model.
- Auto-update mechanism.
- macOS/Linux release packaging.
- Whether per-store shipping addresses are needed, and the table behind them. The
  assignment grid is built for extra columns but renders one until a second
  checkout-capable adapter exists.
- Whether preflight should move into a shared package so the main process and the
  renderer enforce one implementation rather than two.
- When to split `packages/stores` and `packages/observability` out of
  `packages/runner`.

These should be decided only when the preceding architecture gives enough evidence.

---

## 51. Summary of Locked Decisions

The following decisions are considered **locked unless new evidence justifies changing them**:

- Product name is **Copify**.
- Copify is a local-first desktop application.
- Windows is the first platform.
- macOS and Linux come later.
- Electron + React + TypeScript is the application stack.
- Playwright controls real headed Chrome.
- SQLite stores local structured data.
- Browser architecture is **Model B: independent persistent Chrome processes**.
- Each browser uses a unique persistent profile.
- Browser runners execute in separate Node child processes.
- Proxies are modeled independently from browser profiles.
- A session uses one fixed network route for its lifetime.
- Proxy reliability matters more than raw latency.
- Run inspection is a first-class feature.
- Every drop attempt is modeled as a `Run`.
- Every state transition becomes a structured event.
- Both wall-clock and monotonic timestamps are recorded.
- Normal logging is sanitized.
- Playwright trace is optional diagnostic data.
- Full HAR is not a default production artifact.
- Sensitive credentials are protected through OS-backed secret storage.
- Copify does not store raw card/CVV information.
- The application is store-agnostic.
- Supreme is the first store adapter.
- Target configurations support keyword, color, and size priority.
- Targets include a maximum retail-price kill switch.
- Security challenges trigger human handoff.
- Parallel sessions use a global commit/purchase lock.
- Development begins with browser/session infrastructure and observability before Supreme-specific automation.
- Electron Vite is the build tooling; Drizzle schema over `node:sqlite` is the
  persistence layer.
- The renderer uses component state and IPC events, with no UI state library, no
  component library, and no icon dependency.
- Stores declare a capability manifest, and the interface renders from it rather
  than branching on store identity.
- A store with no adapter is an ordinary manifest, not a special case.
- `storeId` is a registry-validated string, never an enum.
- The interface is near-monochrome: primary actions are near-white and colour is
  reserved for state.
- The window is frameless with an app-drawn titlebar.
- Navigation follows the drop workflow, and Run is both the landing page and the
  drop console.
- Preflight blocks on critical failures and passes on warnings.
- Data is presented as rows with one primary action; the rest goes in an overflow
  menu, and creating or editing happens in a drawer.
- Interface copy states what is true and what will happen, and structural facts
  render as data rather than prose.
