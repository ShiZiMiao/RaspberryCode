# RaspberryCode unified Node distribution

## Product rules

- The Node distribution is named `zcode`, with executable `bin/zcode.mjs` and installed command `zcode`.
- `zcode` starts the existing terminal UI. All arguments are forwarded unchanged to the existing CLI (including `tui`, prompt, login, resume and internal protocol commands).
- `zcode --version` reports the distribution version. `zcode --help` is forwarded to the CLI help.
- TUI inherits the real terminal in the same process; the launcher must not consume its stdin.
- Web 模式（`zcode --web`）已于 2026-10-30 随浏览器界面（`packages/web`）整体下线：启动器不再分流 Web，所有参数（含 `--web`）一律直达 Agent CLI。发行包内 `server/entry-http.js` 仍可作为通用 Web 服务入口独立启动（bot 回调等），但不再由 `zcode` 命令拉起。

## Ownership and boundaries

The release scripts own archive assembly and installation. They reuse the CLI's existing `collectSeaTuiAssets` build API for the TUI dependency closure, workspace export rewriting, dependency-version placement, native libraries and workers. This build API is not a new runtime service dependency. Root release scripts are outside the runtime module roots in `architecture-policy.yaml`; the referenced CLI module is legacy and has no module contract.

TUI assets are placed under `agent/node_modules`, preserving package-relative paths and keeping their dependency versions separate from server dependencies. The CLI's built `provider/` config and third-party notices accompany `agent/zcode.cjs`; its external Playwright runtime is also included. Assets for the existing six SEA targets are combined; duplicate paths must have identical hashes or packaging fails. Required missing assets fail the build, including with `--skip-build`.

The launcher imports the existing Agent CLI entry in the same process, setting `process.argv[1]` to that entry so self-spawned CLI workers continue to use the canonical Agent. It introduces no session state, persistence, queue, replay or lease owner.

```mermaid
sequenceDiagram
    participant User
    participant Launcher as zcode launcher
    participant CLI as Existing CLI / TUI
    User->>Launcher: argv
    Launcher->>CLI: import Agent entry with original arguments and terminal
    CLI->>CLI: existing runtime admission and persistence
```

## Packaging and migration

- Build with `pnpm build:zcode`; output is `dist/zcode/releases/<version>/zcode-<version>.tar.gz`, plus checksum, `latest.json` and `install.sh`.
- Node remains required, at the version pinned in `mise.toml`. The archive includes TUI assets for macOS, Linux and Windows (arm64/x64); native functionality must be verified per platform rather than inferred from asset presence.
- Build download URL: `--base-url` overrides `ZCODE_DIST_BASE_URL`; environment overrides `.env.local`, which overrides `.env`. Missing URL fails before building. Installer `ZCODE_DIST_BASE_URL` overrides its embedded default.
- Installer `ZCODE_DIST_HOME` overrides `~/.zcode/runtime`; `ZCODE_DIST_BIN_DIR` overrides `~/.local/bin`. These release-only variables do not change CLI/session data directories. Installation writes the `zcode` launcher and preserves existing user data.
- `pnpm build:zcode` coexists with the existing `pnpm build:lite` (`scripts/build-zcode-lite.mjs`), which internal CI and release flows may still use; the two commands produce separate outputs (`dist/zcode` and `dist/zcode-lite`) and neither changes the other. Do not automatically delete old Lite installations. Retiring Lite requires confirming that no internal pipeline still depends on it.

## Acceptance and validation

1. Launcher process tests prove default CLI routing, unchanged CLI arguments, help/version forwarding and exit-code propagation.
2. Installer test uses a local fixture archive to prove the installed command is `zcode` and defaults to CLI while forwarding arguments unchanged.
3. Build a real release, extract outside the repository, unset workspace module fallbacks, import its TUI/native runtime and interact with it through a pseudo-terminal. Verify first render and clean keyboard exit without sending a model prompt.
4. Run root typecheck, lint and architecture checks. Report actual platform and any unexecuted cross-platform or model-call paths.

## Recorded validation (2026-09-20, open-source branch)

- `node --test scripts/zcode-distribution.test.mjs`: 5 process/installer tests passed.
- `pnpm build:zcode --base-url https://downloads.example.com/zcode/`: complete CLI, server and Web build passed. Final assembly was repeated with `--skip-build` after adding the CLI sidecar config.
- `node scripts/zcode-distribution-smoke.mjs dist/zcode/releases/3.14.0/zcode-3.14.0.tar.gz`: passed on macOS arm64, Node 24.14.0, outside the repository with an isolated data directory. Covers native TUI import, initialized screen, keyboard exit, Web HTML, server-info, workspace, WebSocket and shutdown. Exit code 0; no model prompt sent.
- Root `pnpm typecheck`, `pnpm lint` and `pnpm architecture:check --changed` passed; lint retains existing repository warnings.
- Cross-platform assets were collected, but Linux, Windows and macOS x64 execution were not tested. WebSocket connectivity is checked; an authenticated model conversation and browser GUI E2E are outside this packaging smoke test.
- Third-party notice freshness check passed after regenerating the root package manifest hash; the repository still reports 14 pre-existing material-review items, so this is not a strict release-compliance approval.

## Recorded validation (2026-09-24, closed repository `closed/infra-absorb`)

- `node --test scripts/zcode-distribution.test.mjs`: 5 process/installer tests passed.
- `pnpm build:zcode --base-url http://downloads.example.invalid/zcode/`: CLI, server and Web builds passed; assembly first failed because `@zcode/shared` has no build script and its `dist/` only exists after root `pnpm typecheck` (`tsc -b` emit). After `pnpm typecheck`, assembly with `--skip-build` passed. Running `pnpm typecheck` after the server build overwrites `packages/server/dist/entry-http.js` with the unbundled `tsc` output, so rebuild the server before assembling.
- The server HTTP bundle inlined `yauzl` and crashed on load (`Dynamic require of "fs" is not supported`); `yauzl` is now external and declared by `@zcode/server`, and both this distribution and `build:lite` copy it.
- `node scripts/zcode-distribution-smoke.mjs dist/zcode/releases/3.14.3/zcode-3.14.3.tar.gz`: passed on macOS arm64, Node 24.14.0 (native TUI import, initialized render, keyboard exit, Web HTML, server-info, workspace, WebSocket, shutdown). The TUI readiness check now strips terminal control sequences because the renderer interleaves them between characters.
- Linux, Windows and macOS x64 execution were not tested.
