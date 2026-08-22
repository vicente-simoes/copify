# Copify

Copify is a local Windows desktop console for isolated persistent Chrome sessions.

## v0.3

- Direct/home networking is the default; proxies are optional per browser profile.
- HTTP, HTTPS, and SOCKS5 proxy profiles support encrypted optional credentials.
- Test the direct route or a proxy to record public IP, location, latency, jitter, failures, stability, and a 0–100 quality score.
- Proxy credentials are only decrypted in Electron main immediately before runner launch and are never displayed or written to logs.

The default route probe is `https://ipwho.is/`. It can be replaced with an HTTPS endpoint returning compatible IP/geolocation JSON.

- Record stopped browser profiles as one local run and inspect each session's persisted event timeline afterward.
- Normal runs store sanitized navigation/network metadata and selected screenshots; Diagnostic adds trace and sanitized console output.
- Deep Debug requires explicit acknowledgement before writing local HAR and video, which can contain sensitive browser state.
- Ending a run finalizes recording without closing persistent Chrome sessions. Run records and artifacts remain until manually deleted.
