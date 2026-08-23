# Copify v0.8 Validation Report

**Status:** Automated validation passed; manual release gate required  
**Date:** 2026-08-23  
**Tester:** Automated by Codex; manual tester pending

## Environment

- Windows version: Windows 11 (`NT 10.0.26200.0`)
- Google Chrome version: `122.0.6261.129`
- Copify version: `0.8.0` candidate
- `rebrowser-playwright`: `1.52.0`
- `ghost-cursor`: `1.4.2`
- IPC version: `11`
- SQLite schema version: `10`

## Automated Results

- Normal unit/integration suite: **PASS** — 86 passed, 5 opt-in tests skipped
- Typecheck: **PASS**
- Production build: **PASS**
- Native stealth smoke: **PASS** — 1 test
- Live v0.7 stealth compatibility: **PASS** — CreepJS and official Turnstile test widget
- FAST_DROP input smoke: **PASS** — Native Stealth and External CDP
- Mouse movement: configured 100–220 ms; live event sequence passed the 70–300 ms scheduler-tolerance gate
- Click dwell: configured 40–75 ms; live event sequence passed the 35–120 ms scheduler-tolerance gate
- Trusted mouse/keyboard/input events: **PASS**
- External CDP detach left the external browser running: **PASS**

## Manual Checkout Gate

- Low-demand product: Pending
- Reached `READY_TO_CONFIRM`: Pending
- Purchase submission attempted: **No**
- Shipping values correct: Pending
- Visible mouse movement and smooth scrolling: Pending
- Terms acknowledgement correct: Pending
- Empty-clipboard Ctrl+V path: Pending
- Nonempty clipboard left unchanged: Pending
- Insert-text fallback populated the field: Pending
- Screenshots: Pending

## Local Validation Path

When a live storefront monitor is unavailable, run `pnpm test:input` from the
workspace root. It starts a local fixture and verifies the FAST_DROP engine
without contacting a store. This validates trusted cursor, wheel, keyboard,
and text-input events, input timing, browser text-insertion fallback, and
External CDP detach behavior. It does not replace the later live-store
compatibility check.

### Current live-store note

The manual Supreme target check on 2026-08-23 was blocked before matching by
the storefront response: `Storefront access challenge detected.` The product
was independently reachable in a normal browser. This is recorded as an
external monitor-access block, not a v0.8 human-input failure. Do not retry the
target test repeatedly while the challenge remains active.

## Release Decision

Pending. Do not change workspace versions to `0.8.0` until the manual checkout and clipboard checks are complete.
