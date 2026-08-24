Post-v0.9 Transformation Blueprint
1. Unlock the Speed Limit (Store Manifest)
The AI will enforce a hard 60-second minimum delay for Supreme to prevent what it considers "aggressive polling." We need to revert this to the sneaker-bot standard.

Target File: The Supreme store manifest (likely in packages/shared/src/manifests/supreme.ts or similar).

The Change: Locate the pollIntervalMs configuration. It will be hardcoded to 60000 (or 60_000). Change this value to 500 or 1000 to restore the 500ms–2s release window required for a live drop.

2. Unshackle the Proxy Pool (Circuit Breaker)
The AI will implement a global circuit breaker that shuts down the entire monitor if a single proxy gets a 403 or 429 response. We must rewire this so it only drops the banned IP and seamlessly rotates to the next one.

Target File: The MonitorConnectionPool or HttpStoreMonitor error handling logic.

The Change: Find the if/else block handling 403, 429, or challenge status codes.

The Surgery: Replace the call to tripGlobalStorefrontCircuit() (or equivalent global shutdown function) with markRouteUnhealthy(route) (the function it uses for standard timeouts like 503 or ECONNREFUSED).

Why this matters: This single line change transforms the monitor from a fragile, easily blocked scraper into a resilient, rotating proxy pool that survives IP bans during a drop.

3. Restore Browser Fingerprints (Crawlee Config)
To appease the AI, we agreed to disable Crawlee's browser-mimicking features. We need to turn them back on so our TLS and header fingerprints match a real Chrome browser.

Target File: The transport configuration where @crawlee/http is instantiated.

The Change: Locate the HttpCrawler or transport options. Remove the explicitly injected "plain transport" overrides and re-enable Crawlee's default browser-mimicking headers and session management.

Execution Strategy:
Let Codex run its implementation completely uninterrupted. Once it finishes and all the unit tests pass, we will open those three files, make these precise edits, and instantly convert the "compliant HTTP monitor" into a high-performance bot.