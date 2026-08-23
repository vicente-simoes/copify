# Copify — Stealth Architecture & Advanced Drop Execution Plan

**Document:** `stealth-improvement.md`  
**Status:** Architecture Specification & Implementation Roadmap  
**Target:** Drop-in Stealth & Speed Upgrade for Copify v0.7+  
**Guiding Principle:** Always select the highest-efficacy solution. Leverage proven open-source tools where possible to avoid reinventing wheels, while evaluating trade-offs, maintenance, and integration costs.

---

## 1. Executive Summary & Paradigm Definition

In competitive e-commerce releases (Shopify, Supreme, Kith, SNKRS), automation tools operate under two distinct paradigms:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Automation Paradigms                            │
├───────────────────────────────────┬────────────────────────────────────┤
│ Paradigm A: Pure Request Bots     │ Paradigm B: Persistent Browser /   │
│ (Wrath, MEKpreme, CyberAIO)       │ Anti-Detect Orchestration (Copify) │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Direct TLS/HTTP2 API calls.     │ • Real headed Chrome instances.    │
│ • Sub-100ms execution speed.      │ • 100% resilient to API & payload  │
│ • Extremely fragile: breaks when  │   encryption changes.              │
│   storefront tweaks internal      │ • Preserves real cookies, Shop Pay,│
│   payloads or bot tokens.         │   and Google 1-click trust scores. │
└───────────────────────────────────┴────────────────────────────────────┘
```

**Copify is firmly in Paradigm B.** Instead of attempting to reverse-engineer encrypted, fast-changing backend checkout APIs, Copify orchestrates real, persistent Chrome profiles using anti-detect and stealth techniques.

To rival the speed of request bots while keeping the stability of real browsers, Copify addresses five key technical layers:
1. **The Driver Layer:** Eliminating CDP leaks and automation signals (`rebrowser-patches`).
2. **The Input Layer:** Humanized Bezier trajectories and natural input cadence (`ghost-cursor`).
3. **The Monitor Layer:** Decoupled, TLS/JA3-spoofed high-frequency polling (`got-scraping`).
4. **The Profile-Proxy Coherence Engine:** Strict 1:1 binding between GeoIP, Timezone, Locale, and WebRTC.
5. **Advanced Drop Execution & Profile Trust:** Direct-Carting via Variant ID, Shop Pay session preservation, and profile trust warming.

---

## 2. Layer 1: The Driver Layer (Browser Engine & CDP Hardening)

### 2.1 Problem Analysis
- Default Playwright (`chromium.launchPersistentContext`) sets automation arguments and injects helper scripts that leak into the JavaScript execution context (`navigator.webdriver = true`, missing codecs, automation flags).
- Modern anti-bot solutions (Cloudflare Turnstile, Akamai, DataDome, Kasada) inspect `Runtime.enable` CDP side-effects in the JavaScript execution stack and detect script-based overrides (`stealth.min.js`).
- Standard CDP connections (`connectOverCDP`) leave detectable artifacts when `Page.addScriptToEvaluateOnNewDocument` or `Runtime.enable` is invoked.

### 2.2 Solutions & Tool Comparison

| Solution | Open Source? | Cost | Advantages | Disadvantages / Trade-offs |
|---|---|---|---|---|
| **Rebrowser-Patches / Rebrowser-Playwright** | Yes (MIT) | Free | • Drops directly into Node/Playwright workflow.<br>• Eliminates `Runtime.enable` CDP leaks at the root.<br>• Removes `--enable-automation` and `navigator.webdriver`.<br>• Local-first, zero third-party subscriptions. | • Relies on the host GPU for hardware-level Canvas/WebGL (standard for persistent local Chrome). |
| **Commercial Anti-Detect APIs (AdsPower, GoLogin, Multilogin)** | No (Commercial) | Subscription ($20–$100+/mo) | • Full C++ Chromium engine-level Canvas, WebGL, Audio, and Font spoofing.<br>• Automated cloud profile sync. | • Requires third-party desktop app running in background.<br>• Requires paid account/API key per user.<br>• Moves profile storage outside Copify's SQLite. |
| **Custom Chromium Build from Source** | Yes | Free (High dev cost) | • Full control over all flags, fingerprints, and engine code. | • Huge maintenance burden to keep up with monthly Chromium security releases. |

### 2.3 Proposed Architecture: Pluggable Driver Interface

```text
               ┌──────────────────────────────┐
               │     BrowserDriver Interface   │
               └──────────────┬───────────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   NativeStealthDriver               AntiDetectDriver (Optional)
   (Default, Zero-Cost)             (AdsPower / GoLogin API)
   • rebrowser-patches Playwright   • Connects to local daemon API
   • Native Chrome / Chromium       • Returns remote CDP WebSocket
   • Local profiles in SQLite       • Power-user extension
```

#### Default Implementation (NativeStealthDriver):
1. Use **`rebrowser-playwright`** (or apply `rebrowser-patches` to the runner's Playwright runtime).
2. Launch persistent context with hardened Chrome flags:
   - `--disable-blink-features=AutomationControlled`
   - `--no-default-browser-check`
   - `--no-first-run`
   - Explicitly avoid `--enable-automation`.
3. Eliminate any `Runtime.enable` CDP leaks during page instrumentation.

---

## 3. Layer 2: The Input Layer (Human Input Abstraction)

### 3.1 Problem Analysis
- `page.click()` and `page.fill()` dispatch synthetic DOM events with `event.isTrusted = false` or missing physical mouse coordinate histories.
- Anti-bot telemetry measures:
  - Mouse movement curvature, velocity, and jitter (acceleration profiles).
  - Lack of `mousemove` events leading up to a click.
  - Duration between `mousedown` and `mouseup` (human median: 40–90ms; synthetic: 0ms).
  - Keystroke cadence and time delta between `keydown`, `keypress`, `keyup`, and `input`.

### 3.2 Solutions & Tool Comparison

| Solution | Open Source? | Advantages | Disadvantages / Trade-offs |
|---|---|---|---|
| **`ghost-cursor` / `ghost-cursor-playwright`** | Yes (MIT) | • Realistic Bezier curve generation.<br>• Fitts's Law human movement modeling.<br>• Natural overshoot and correction trajectories. | • Fixed movement speeds may be too slow for competitive drop checkout without tuning. |
| **Custom Input Synthesizer** | N/A | • Perfectly tuned for drop-speed requirements. | • Reinvents math already solved by `ghost-cursor`. |

### 3.3 Proposed Architecture: Drop-Tuned Human Input Engine

Integrate **`ghost-cursor`** and calibrate it specifically for high-speed checkout:

```ts
export interface HumanInputOptions {
  mode: "STEALTH" | "FAST_DROP";
}

export class HumanInput {
  constructor(private page: Page, private options: HumanInputOptions) {}

  // Generates high-speed Bezier trajectory (100-220ms) + natural CDP mouse down/up (40-75ms)
  async click(selectorOrLocator: Locator | string): Promise<void>;

  // Types with randomized cadence (15-35ms per key with natural jitter)
  async type(selectorOrLocator: Locator | string, text: string): Promise<void>;

  // Simulates instant OS clipboard paste (Ctrl+V / Cmd+V via CDP keyboard)
  // Essential for checkout addresses without triggering synthetic input warnings
  async paste(selectorOrLocator: Locator | string, text: string): Promise<void>;

  // Natural scroll with smooth wheel delta events
  async scrollIntoView(selectorOrLocator: Locator | string): Promise<void>;
}
```

---

## 4. Layer 3: The Monitor Layer (Decoupled TLS-Spoofed HTTP Poller)

### 4.1 Problem Analysis
- Headless Chrome polling leaks distinct TLS/HTTP2 fingerprints, consumes significant CPU/RAM, and triggers Cloudflare/Akamai rate-limiting.
- Cold-starting browsers *after* product detection adds 2–5 seconds of latency, which is fatal on limited drops.

### 4.2 Solutions & Tool Comparison

| Solution | Open Source? | Advantages | Disadvantages / Trade-offs |
|---|---|---|---|
| **`got-scraping` (by Apify)** | Yes (Apache 2.0) | • Pure Node.js library.<br>• Spoofs Chrome TLS (JA3/JA4) and HTTP/2 header orders.<br>• Native proxy rotation support.<br>• Zero external binary dependencies. | • High-security endpoints may occasionally spot Node OpenSSL vs BoringSSL differences. |
| **`tls-client` / `curl-impersonate` (via native wrapper)** | Yes (MIT) | • Exact BoringSSL TLS fingerprint of real Google Chrome.<br>• 100% indistinguishable network signature. | • Requires distributing pre-compiled native binaries (`.dll` for Windows, `.dylib` for macOS). |

### 4.3 Proposed Architecture: Decoupled High-Frequency Monitor

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                      Decoupled HTTP Monitor                 │
 │  • Uses `got-scraping` (with optional `tls-client` engine)  │
 │  • Rotates fast proxies (residential/datacenter)            │
 │  • High frequency polling (500ms - 2s)                      │
 │  • Parses Shopify JSON / XML / HTML payloads                │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                    PRODUCT_DETECTED (IPC Event)
                    Includes exact `variantId`
                                │
 ┌──────────────────────────────▼──────────────────────────────┐
 │             Pre-Warmed Persistent Chrome Sessions            │
 │  • Already open and idle on store (e.g. /pages/shop)        │
 │  • Cookie and session state already loaded                  │
 │  • Immediately executes Direct-Cart or Product navigation   │
 └─────────────────────────────────────────────────────────────┘
```

---

## 5. Layer 4: The Profile-Proxy Coherence Engine

### 5.1 Problem Analysis
- Anti-bot and anti-fraud systems compare the public IP's GeoIP database record against client-side browser attributes.
- Mismatches trigger elevated risk scores:
  - Client timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) vs. GeoIP timezone.
  - `Accept-Language` header and `navigator.language` vs. IP country.
  - WebRTC local/public interface leaks revealing the host machine's true IP.

### 5.2 Implementation Strategy

For every `BrowserProfile` with an assigned `ProxyProfile`:

1. **GeoIP Resolution:**
   - During proxy benchmarking or session startup, resolve proxy IP metadata (Country, Region, City, Timezone, Coordinates).
2. **Browser Parameter Injection:**
   - **Timezone Emulation:** Configure Chrome timezone via `--timezone=<ResolvedTimezone>` and Playwright's `timezoneId` parameter (e.g., `"Europe/Lisbon"`).
   - **Locale & Language:** Pass matching `--lang=<Locale>` (e.g., `"pt-PT"`) and configure HTTP `Accept-Language` headers to reflect the target region.
   - **Geolocation Spoofing:** Override geolocation coordinates via `context.setGeolocation({ latitude, longitude, accuracy: 50 })`.
   - **WebRTC Leak Prevention:** Add Chrome launch argument `--force-webrtc-ip-handling-policy=default_public_interface_only` to prevent local LAN IP leakage through STUN/TURN requests.
3. **Strict 1:1 Affinity:**
   - A persistent browser profile must never boot under a mismatched IP route. If a proxy profile changes drastically (e.g., UK to US), Copify warns the user to avoid cookie invalidation.

---

## 6. Layer 5: Advanced Drop Execution & Profile Trust (The Reseller Edge)

To achieve top-tier drop performance, Copify incorporates three specific optimizations used by professional sneaker resellers:

### 6.1 Direct-Cart Flow (Variant ID Shortcut)

#### The Problem:
Navigating to the Product Detail Page (PDP), waiting for full DOM rendering, selecting color thumbnails, clicking size dropdowns, and pressing "Add to Cart" takes **2.5 to 5.0 seconds** in browser automation. On hyped drops, inventory sells out before PDP checkout navigation finishes.

#### The Solution:
When the decoupled HTTP monitor detects the drop, it extracts the exact `variantId` for the user's preferred color and size from the store's JSON/HTML feed.

The runner then executes **Direct Carting** via one of two fast paths:

1. **In-Page Fetch Injection (Primary):**
   ```ts
   // Executed directly inside the pre-warmed browser tab (same-origin cookies preserved)
   await page.evaluate(async (variantId) => {
     const res = await fetch('/cart/add.js', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
       body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] })
     });
     return res.ok;
   }, variantId);
   ```
2. **Direct Cart Permlink Navigation (Fallback):**
   ```ts
   // Directly opens checkout pre-loaded with the item
   await page.goto(`https://${storeDomain}/cart/${variantId}:1`, { waitUntil: 'domcontentloaded' });
   ```

*Result:* Carting time drops from **~3,500ms down to < 400ms**, landing the user immediately on the checkout / queue page.

---

### 6.2 Profile Trust & Account Warming Workflow

#### The Problem:
Cloudflare Turnstile and Shopify Bot Protection evaluate visitor reputation using passive signals:
- Presence of established cookies (`__cf_bm`, `cf_clearance`, `_shopify_s`).
- History of normal browsing activity.
- Active Google account session with a high reCAPTCHA v3 / Turnstile human trust score (score $\ge 0.9$).

A brand-new, empty browser profile launched 2 minutes before a drop is flagged as high-risk and presented with aggressive visual CAPTCHA challenges.

#### The Copify Solution:
1. **Profile Warming Mode:**
   - Copify provides a built-in "Warm Profile" action on the Browsers page.
   - Users can launch their persistent browser profiles to:
     - Log into their dedicated Google / Gmail account.
     - Log into Shop Pay / Apple Pay / PayPal.
     - Browse the target storefront (e.g., Supreme, Shopify stores, YouTube, news sites) to establish natural browsing history and cache.
2. **Cookie State Persistence:**
   - Because Copify uses **Model B (Persistent UserDataDir)**, all Google sessions, Turnstile clearance tokens, and storefront cookies persist permanently across app restarts.
   - On drop day, the browser opens with high pre-existing reputation, resulting in automatic 1-click CAPTCHA passes.

---

### 6.3 Shop Pay Session Preservation & 1-Click Fast Checkout

#### The Problem:
Filling out standard shipping address and payment card forms manually or via autofill is vulnerable to timing delays, address validation popups, and card 3DS security handoffs.

#### The Solution:
- On Shopify/Supreme storefronts, **Shop Pay** offers the fastest path to order confirmation.
- **Session Preservation:** Copify ensures persistent profiles retain Shop Pay authentication cookies (`_shopify_essential`, `pay_session`).
- **1-Click Fast Checkout:** When Shop Pay is active on the profile, navigating to checkout automatically bypasses address entry and advances directly to the 1-click confirmation or SMS verification screen.
- Copify pauses at `READY_TO_CONFIRM`, foregrounds the browser, and lets the user approve the order in 1 click.

> [!NOTE]
> **Portugal & European Region Context:**
> - **Supreme EU Storefront:** Runs on `eu.supreme.com` in EUR (€) with weekly drops at 16:00 Lisbon time (`Europe/Lisbon`).
> - **Shop Pay in Portugal:** Fully supported on Supreme EU with Portuguese phone numbers (`+351`), Portuguese addresses, and standard Portuguese bank cards / virtual cards.
> - **PSD2 / 3DS (Strong Customer Authentication):** European banking regulations occasionally prompt an app-based 3DS approval (e.g., MB WAY, Revolut, ActivoBank, CGD, Santander). When 3DS triggers, Copify's `CHECKPOINT` state instantly brings the headed browser to the foreground so you can tap "Approve" on your banking app without losing the session.


---

## 7. Implementation Roadmap & Phasing

```text
Phase 1: Driver Hardening & CDP Stealth
  ├── Replace Playwright dependency with `rebrowser-playwright` / apply `rebrowser-patches`
  ├── Strip automation flags (`--disable-blink-features=AutomationControlled`)
  └── Unit test `navigator.webdriver === false` and verify zero CDP `Runtime.enable` leaks

Phase 2: Drop-Tuned Human Input Engine
  ├── Integrate `ghost-cursor` for Bezier mouse movements
  ├── Implement `HumanInput` wrapper with `FAST_DROP` profile (100-220ms movements)
  └── Implement simulated OS clipboard paste (`Ctrl+V`) for form filling

Phase 3: Decoupled TLS-Spoofed Monitor
  ├── Implement `HttpStoreMonitor` using `got-scraping` (JA3/JA4 fingerprinting)
  ├── Extract `variantId` directly from Shopify listing JSON / embedded scripts
  └── Connect monitor IPC to broadcast `variantId` to active runners

Phase 4: Direct-Cart & Fast Execution Engine
  ├── Implement in-page `fetch('/cart/add.js')` direct carting
  ├── Implement fallback direct URL navigation (`/cart/{variant_id}:1`)
  └── Maintain backward compatibility with standard PDP UI navigation

Phase 5: Profile Coherence & Warming Workflow
  ├── Auto-sync Timezone, Locale, and Geolocation based on proxy IP
  ├── Inject WebRTC leak prevention flags
  └── Add "Warm Profile" UI action and documentation for Google/Shop Pay session retention
```

---

## 8. Conclusion

By combining **persistent headed Chrome profiles**, **`rebrowser-patches` (zero CDP leaks)**, **`ghost-cursor` (humanized inputs)**, **`got-scraping` (decoupled TLS monitor)**, **Direct-Carting via Variant ID**, and **Profile Trust Warming**, Copify delivers a resilient, high-speed orchestration platform built on the proven strategies of successful sneaker automation.
