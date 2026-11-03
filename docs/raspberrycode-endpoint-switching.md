# RaspberryCode Endpoint Switching

RaspberryCode runtime endpoints are derived from a single origin. Production uses
`https://your-server.example`; local development uses `https://your-server.example`
through `.env.development`.

The shared resolver exposes these derived URLs:

- API base: `/api/v1`
- RaspberryCode Plan OpenAI base: `/api/v1/raspberrycode-plan`
- mobile remote entry: `/remote`
- web remote OAuth callback: `/web-remote/callback`
- relay WebSocket: `/ws`, with `https -> wss` and `http -> ws`

`RASPBERRYCODE_BASE_URL` is the canonical env variable for the origin. Production builds still ignore
settings overrides; the resolver uses `RASPBERRYCODE_BASE_URL` when present, otherwise falls back to
`https://your-server.example`. This prevents a stale local setting from moving release builds to a test or
custom endpoint, while keeping release/test deploy targets explicit in env files.

In non-production desktop builds, the Help menu contains `RaspberryCode Endpoint` with these actions:

- `Production (default)` stores the production origin explicitly.
- `Test` stores `https://your-server.example`.
- `Custom...` accepts an `http` or `https` origin and normalizes it to `URL.origin`.
- `Reset to Default` clears the override and returns to the env/default origin.

The setting is stored as `raspberrycodeEndpointOrigin` in app settings and only acts as a non-production
temporary override above `RASPBERRYCODE_BASE_URL`. Changing it rebuilds the menu and stops active web remote
runtimes so the next connection uses the new relay and remote URL. Existing
HTTP requests are not cancelled; later requests are rewritten by `NodeApiClient` from the production
origin to the active origin, while unrelated domains such as `cdn.your-server-alt.example` and
`feedback.example.invalid` are left untouched. Provider API domains are resolved by their own
environment rules; for example BigModel API requests use `https://bigmodel.cn` when
`RASPBERRYCODE_ENV=test` and `https://bigmodel.cn` in production.

For Web dev server, desktop host services, scripts, and CLI testing, set `RASPBERRYCODE_BASE_URL`, for
example:

```bash
RASPBERRYCODE_BASE_URL=https://your-server.example pnpm --filter @raspberrycode/web dev
RASPBERRYCODE_BASE_URL=http://localhost:3030 raspberrycode auth login
```

`RASPBERRYCODE_ENDPOINT_ORIGIN` is still read as a compatibility fallback, but new configs should use
`RASPBERRYCODE_BASE_URL`.

Android release builds only allow `https://your-server.example/remote`. Debug builds additionally allow
`https://your-server.example/remote` and the existing local/LAN development hosts.
