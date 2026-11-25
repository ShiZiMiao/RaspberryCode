# @raspberrycode/raspberrycode-cua

Self-hosted Windows Computer Use runtime.

The source implementation lives in `src/` and is loaded from `dist/runtime/index.js`
after a build. When that artifact is missing, the package entry falls back to a
fail-closed placeholder: every runtime surface reports **unavailable**, predicates
about official CUA frames are `false`, and permission ports keep their privacy
fail-closed semantics.

Build:

```bash
pnpm build:cua
```

Capabilities (Windows self-hosted):

- UIA tree observation with diff, truncation budget, `input_target` / `value_known`
- Element actions: message posting, UIA semantic actions, physical injection
- Coordinate actions: click / drag / scroll, bound to the current window frame
- Targeted background text input: ValuePattern / TextPattern / `EM_REPLACESEL`
- Two-phase window restore: `prepare` → `restore` with a single-use `recovery_id`
- Per-window serial queues, cross-window concurrency
- Receipts with `delivery`, `receiver_focus`, `next_step`, `queued_ms`

License: Apache-2.0.
