# RaspberryCode
> **Provenance**: RaspberryCode is a fork of [zai-org/ZCode](https://github.com/zai-org/ZCode) (Apache-2.0). Some ecosystem links and service notes in this document are inherited from upstream.

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="RaspberryCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">Feishu community</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

RaspberryCode is an AI coding workspace with desktop and terminal interfaces. This repository contains the clients, backend services, shared UI, and Agent CLI and runtime source code.

## Updates

- **2026-10-19**: Updated to RaspberryCode v3.16.2.
- **2026-10-16**: Updated to RaspberryCode v3.16.1.
- 2026-10-10: Updated to RaspberryCode v3.15.1.
- 2026-9-23: Updated to RaspberryCode v3.14.3.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/raspberrycode-cli/](apps/raspberrycode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `RASPBERRYCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
RASPBERRYCODE_DATA_BASE_DIR="$HOME/.raspberrycode-dev-home" pnpm dev:desktop:test
```

### Server development

Use development mode when editing backend source code:

```bash
pnpm dev:server
```

After changing Agent source code, run `pnpm --filter @raspberrycode/cli... build` and restart the service. To validate the complete distribution, extract and run it as described under Packaging → RaspberryCode CLI distribution below.

### RaspberryCode CLI distribution

The command-line distribution includes the TUI and Agent behind one `raspberrycode` command. With no arguments it starts the TUI; all other arguments go to the Agent CLI. It runs locally without Electron.

```bash
# Start the terminal UI by default
raspberrycode

# Show CLI options
raspberrycode --help

# Show the distribution version
raspberrycode --version
```

When starting the general Web service's HTTP entry (`server/entry-http.js`, bot callbacks, etc.) directly, configure API/WebSocket authentication with `RASPBERRYCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

See Packaging below for build instructions. `pnpm build:raspberrycode` only creates the distribution; it does not replace an existing `raspberrycode` on `PATH`. If the command still points to an older installation or another checkout, check it with `command -v raspberrycode` on macOS / Linux or `where.exe raspberrycode` on Windows.

### CLI Source Development

See the [CLI usage guide (Chinese)](apps/raspberrycode-cli/docs/usage/README.md) for model configuration, non-interactive runs, tools and extensions, batch evaluation, and trajectory capture.

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @raspberrycode/cli dev --help
pnpm --filter @raspberrycode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @raspberrycode/cli... build
node apps/raspberrycode-cli/packages/cli/dist/raspberrycode.cjs --help
```

This entry runs the Agent CLI directly. Use the extracted `bin/raspberrycode.mjs` shown below to test the unified command.

### UI Plugin development

See the [UI Plugin guide](UI_PLUGIN.en.md) for the Excalidraw workflow, supported APIs, plugin installation and updates, and host debugging.

**Plugin PRs in `raspberrycode-plugins` must declare whether they affect a UI Plugin and list the plugin names in the PR template.** See the [required plugin-type declaration](UI_PLUGIN.en.md#declare-the-plugin-type-in-pull-requests).

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `RASPBERRYCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.raspberrycode/` subdirectory            |
| `RASPBERRYCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `RASPBERRYCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |
| `RASPBERRYCODE_DIST_BASE_URL`                | Download base URL used by the CLI distribution installer                                |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

### RaspberryCode CLI distribution

Run `pnpm build:raspberrycode` to build the CLI/TUI and backend, collect the TUI native libraries, workers, and runtime dependencies, then assemble the distribution. Running the distribution still requires Node.js; use the version specified in `mise.toml`.

Before packaging, set the download base URL with `RASPBERRYCODE_DIST_BASE_URL` in `.env`, `.env.local`, or the process environment, or pass it through `--base-url`. The URL below is a placeholder; replace it with your hosting URL when publishing:

```bash
pnpm build:raspberrycode --base-url https://downloads.example.com/raspberrycode/

# When RASPBERRYCODE_DIST_BASE_URL is already configured
pnpm build:raspberrycode

# Repackage existing Agent, backend, and Web build outputs
pnpm build:raspberrycode --skip-build

# Show options for the version, output directory, and more
pnpm build:raspberrycode --help
```

The version defaults to the root `package.json` version. Output is written to `dist/raspberrycode/`:

- `releases/<version>/raspberrycode-<version>.tar.gz`: runtime package.
- `releases/<version>/sha256.txt`: checksum file.
- `latest.json` and `install.sh`: version index and installer.

Upload the entire directory to the configured download base URL. The installer downloads the runtime package from that URL, installs it to `~/.raspberrycode/runtime` by default, and creates the `raspberrycode` command in `~/.local/bin`. Override these directories with `RASPBERRYCODE_DIST_HOME` and `RASPBERRYCODE_DIST_BIN_DIR`, respectively.

Existing Lite users should switch to the new build command, environment variables, and installer. Installation does not remove old Lite directories or migrate/delete session data.

To test a packaged build locally, extract and run it directly without uploading or installing it:

```bash
raspberrycode_version=$(node -p "require('./dist/raspberrycode/latest.json').version")
mkdir -p dist/raspberrycode/debug
tar -xzf "dist/raspberrycode/releases/$raspberrycode_version/raspberrycode-$raspberrycode_version.tar.gz" \
  -C dist/raspberrycode/debug
# Start the TUI by default
node dist/raspberrycode/debug/raspberrycode/bin/raspberrycode.mjs
```

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/raspberrycode-server-cli`                          | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/raspberrycode-cli`                                     | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
