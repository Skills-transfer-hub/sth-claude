# Buddy · Claude Code

Version **0.3.5**. The version is also visible at the bottom of the Home panel.

Buddy tracks Claude context and quotas, changed files and checks, then helps you find STH skills that fit your project.

Software source code is MIT-licensed. Buddy artwork, animation data and STH branding are reserved; see [LICENSE](LICENSE).

## Typical uses

- Watch context and quota usage while Claude works, then inspect active agents in Context.
- Review changed files and observed test results in Summary, run a recognized check, and prepare a draft to resume the work later.
- Connect a project to an STH catalog, install a relevant skill, and check installed versions before updating or removing it.

The mod reads session and project information and saves a local Resume summary. See [Privacy and data handling](PRIVACY.md) for the exact contents, retention, external CLI behavior and deletion steps. For help, use [GitHub issues](https://github.com/Skills-transfer-hub/sth-claude/issues); do not include secrets or private project data.

## Install from GitHub

Requires Claude Code **2.1.287 or later** and Git. Run in your terminal:

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git#codex/directory-release
claude plugin install sth-usage@sth --scope user
```

Start Claude Code in your project, then run `/sth-usage`. In an already open session, run `/reload-plugins` first. The user scope enables Buddy across your projects. The STH CLI is only needed for catalog, installation and update actions; usage tracking works without it.

To update:

```sh
claude plugin marketplace update sth
claude plugin update sth-usage@sth
```

Run `/reload-plugins` or restart Claude Code after updating. To uninstall, run `claude plugin uninstall sth-usage@sth`.

See the official [mod installation guide](https://code.claude.com/docs/en/plugins/mods/overview) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces).

## Animation availability

The lightweight distribution includes the desktop animations and portable terminal animations. Their frames and playback rates are unchanged. Image-capable terminals prepare the original HD animations once: Buddy downloads pixel-data JSON from a fixed commit in the STH GitHub repository, verifies every file against the SHA-256 hashes shipped with the plugin, and caches all seven animations before playback. It never downloads or executes remote code, and never fetches frames while an animation plays.

On the first HD launch, the original Buddy still image appears with preparation progress. If the network is unavailable, preparation can be retried; Buddy does not silently substitute lower-quality frames. Fika starts its full nine-second playback only after preparation completes. After a successful preparation, HD works offline and the cache survives plugin updates that use the same artwork. Desktop and portable terminal rendering require no asset download.

The cache is `~/.cache/sth-buddy` on macOS/Linux and `%LOCALAPPDATA%/STH/Buddy` on Windows (or `.cache/sth-buddy` under the user profile when LocalAppData is unavailable). Uninstalling the plugin leaves this artwork cache for reinstalls. It contains public animation data, not prompts or project files; after closing Claude, it can be removed to reclaim disk space. See [PRIVACY.md](PRIVACY.md) for the download's data handling.

## Load the mod

Claude Code 2.1.287 or later is required. From this directory:

```sh
claude --plugin-dir .
```

The module reloads on every save in a session that has loaded it. Desktop sessions without the plugin do not receive these features automatically.

## Usage

The interface lives in the right panel. The home screen keeps Buddy, followed by a single navigation row: STH, Summary and More (Context, Diagnostics and Resume). The STH page manages installed skills and the catalog. More expands three navigation buttons. Other screens provide a single Home button. Navigation replaces the current panel instead of stacking another panel on top. The mod does not add a strip above the message field.

The Usage card shows each metric once: quotas and reset times, context, observed tokens, cost and agents. Pills follow the STH design system's neutral tokens: thin outlines, Inter labels and JetBrains Mono SVG values. Native controls keep the fonts and dimensions imposed by Claude; terminal buttons have neutral outlines. Red is reserved for errors.

Desktop pill details appear on hover. The countdown redraws every 30 seconds without requesting new usage data. “~” marks tokens accumulated since the mod loaded; earlier history may be missing. The [panel preview source on main](https://github.com/Skills-transfer-hub/sth-claude/blob/main/mods/sth-usage/previews/usage-band/index.html) shows light, dark and narrow layouts with sample data; it is not a Claude session.

| Access | Function |
| --- | --- |
| More → Context or `/sth-context` | Context breakdown: system, tools, MCP, memory, messages and active agents. |
| `/sth-usage` | Buddy, combined usage metrics and navigation to the other panels. |
| Summary or `/sth-activity` | Files actually written, tool errors and observed tests. Buttons open the diff, prepare a verification draft and show the detailed summary. Recognized tests run only when explicitly requested in the panel. |
| STH or `/sth-skills` | Installed skills, versions and updates; catalog recommendations based on project manifests. |
| `/sth-doctor` | Stack, available binaries, test commands, STH configuration and observed MCP tool status. Diagnostics do not run tests. |
| More → Resume or `/sth-resume` | Goal, files, checks and next step from the previous session. Inspect the summary before explicitly adding it to the draft; it is not sent automatically. |

Buddy distinguishes work in progress, pending permission, errors, completed turns and interruptions. A main turn lasting at least 60 seconds triggers a discreet notification in Claude.

Buddy tries to display the original image pixels when the terminal supports images: 384 × 384 for regular states and 720 × 720 for Fika. Source checkouts read the original PNGs; compact releases reconstruct their RGBA pixels from lossless compressed frame data. The encoding preserves the pixels, dimensions and frame sequence, and playback keeps its existing timing. An actual image rejection from the terminal enables a colored quadrant fallback generated from 96 × 96 poses. This remains a character-based drawing: its detail depends on the panel size and terminal font. Under tmux, the fallback is used directly. The panel adapts the animation to its size and suggests enlarging it when space is limited. Desktop keeps the existing HD images.

Context is estimated locally using Claude's `summary` mode. The mod does not call an additional model for tracking. Unknown metrics remain unavailable; cumulative billed tokens do not indicate how full the context window is.

Tests are marked as passed or failed only when an exit code has been observed. In versions where the Bash tool does not provide that code, the result remains unverified. The run button uses a recognized project command and displays its actual result. The native diff may include changes made before the current turn.

MCP status reflects exposed tools and observed calls. It does not prove that a server with no tools is connected. Skill versions are displayed when STH provides them. Updates skip pinned versions and protect local changes. The update report comes from a fresh STH status check; a failed verification remains visible as such.

The local summary is stored in `.sth/buddy-session.json` in the session directory. It contains an abbreviated goal, up to 40 paths and 12 check results, without a transcript or command output. Common secrets are masked and sensitive paths are excluded. Write errors appear in the panel.

## Install STH

If the STH binary is missing, Buddy shows the installation guide before project setup.

macOS or Linux with Homebrew:

```sh
brew install skills-transfer-hub/sth/sth
sth version
```

Windows with Scoop:

```powershell
scoop bucket add sth https://github.com/Skills-transfer-hub/scoop-sth
scoop install sth
sth version
```

Windows alternatives: `winget install STH.STH` or `choco install sth`.

Without a package manager, use the [official releases](https://github.com/Skills-transfer-hub/sth-releases/releases), verify `SHA256SUMS` and add the binary to PATH. See the [STH installation documentation](https://github.com/Skills-transfer-hub/sth-releases/blob/main/README.md).

Restart the terminal if needed, then use Check installation or `/sth-doctor`. Once STH is available, `/sth-skills` lets you connect a catalog to the project.

## Validate the mod

```sh
claude plugin validate .
claude plugin test .
```

Run these tests from the source checkout on `main`. Tests cover terminal and desktop rendering, buttons and drafts, missing data, permissions, summaries and resume, plus the existing Buddy and Fika animations. CI tests the generated compact bundle before staging a runtime-only distribution; test fixtures and simulated tool calls are not shipped to users.

## Directory review notes

This section describes runtime behavior for reviewers. Development, test and publication commands appear separately below; the running mod does not invoke its build or publishing tools.

### Hook events and decisions

`hooks/hooks.json` loads `hooks/register.tsx`, which also registers the context, activity and project observers. Every subscription names an event explicitly. There is no wildcard event subscription and no HTTP/network hook. The broad tool-name selectors below intentionally include shell tools, agents, MCP tools and tools added by the host, because permission state and error reporting must follow the actual active call.

| Event | What the hook observes or decides, and when |
| --- | --- |
| `session.start` | Registers the six `/sth-*` commands, opens Home, starts local animation timers, reads usage and Fika eligibility, reads the previous Resume summary and project manifests, probes the STH executable, and refreshes installed skills if the current project is linked. |
| `session.measure` | Updates context, quotas and cost; recalculates local context categories when context changes and shows a toast at 80% and 95% quota use. |
| `agent.spawn` | Refreshes the existing agent list after an agent is spawned. It does not create an agent. |
| `turn.start`, `turn.complete` | Updates working/completed/error/interrupted state, token totals and active agents. On main-turn completion, records observed paths and checks, saves the local Resume summary and shows a completion toast for turns lasting at least 60 seconds. |
| `prompt.edit`, `prompt.fill`, `prompt.submit` | Checks whether a nonempty user prompt makes Fika ineligible. Submission also derives the first short objective used in Resume. These hooks pass the original prompt through. |
| `classic.CwdChanged` | Clears the old project's state, reads the new project's local summary and manifests, probes STH and refreshes linked skills. It does not change the directory or rewrite the event. |
| `tool.check` | Matches any tool name (`/^/`). Retains the current main-turn call's input in memory to match later permission requests, then immediately returns `next(e)`. It does not read or change the permission answer, approve a call or run a tool. |
| `classic.PermissionRequest`, `classic.Notification` | Permission requests and notifications filtered to `permission_prompt` set Buddy's waiting display for main-agent calls. They do not answer the request. |
| `tool.call` | The activity observer matches any tool name (`/^/`), calls `next(e)` once, then reads the original result to count errors and identify paths changed by `Edit`, `Write` or `Bash`, and test results from `Bash`. A second observer matches only MCP names (`/^mcp__/`) to display the last observed server error. Both return the original result or rethrow the original failure. Neither changes arguments, permissions or output, retries a tool, or invokes another tool. |
| `process.run` | Observes completed process calls and their actual exit codes for recognized test invocations during the active turn. It returns the original result, without replacing the program, arguments, environment or output. This also covers processes initiated elsewhere in the session; observing a command does not cause Buddy to run it. |
| `command.run` | Handles only `sth-usage`, `sth-context`, `sth-activity`, `sth-resume`, `sth-skills` and `sth-doctor`. It opens the corresponding pane, refreshes its data and returns local status text. |
| `ui.open`, `ui.close`, `ui.press`, `ui.render` | Handles Buddy panes (`sth-usage`, `sth-skills`, `sth-activity`, `sth-context`, `sth-doctor`, `sth-resume`) and Buddy navigation/diagnostic buttons. Opening one Buddy pane closes the others and sets the STH pane title. Rendering displays local state; explicit button callbacks trigger the actions listed below. Closing Home or STH releases its terminal renderer. |

Permission-request payloads omit the call id, so Buddy matches active calls by tool and input. Indistinguishable calls remain waiting until every match finishes; an unmatched request remains until the turn ends. Inputs used for this match are cleared with the active turn and are not persisted, logged or sent by this observer.

### Programs and command calls

All program launches use Claude's `$.process.run` with an argument array and a timeout. `runSth`, `probe`, `runVersionProbe`, `runCliVersion`, `runCliDoctor` and `runTestCommand` are local wrappers around that API, not separate network transports. Fixed version, diagnostic and test commands are written as complete literal argument arrays at their process calls; the test wrapper rejects unsupported forms. The executable name can be selected from known installed locations, and skill/provider identifiers are individual arguments. The mod does not construct a shell command from catalog text. Project package-manager scripts can themselves run arbitrary commands defined by the project.

| Program / command | Trigger and purpose |
| --- | --- |
| `sth version` | Checks CLI availability on session start, after a directory change, and during diagnostics or Check installation. Diagnostics try `sth`, `sth.exe`, `/opt/homebrew/bin/sth`, `/usr/local/bin/sth` and `/home/linuxbrew/.linuxbrew/bin/sth`. Each probe has a 5-second timeout. |
| `sth status --json` | Reads installed skill versions/status on session start or directory change for a linked project, opening STH, Refresh, and after each setup/install/remove/update action. Timeout: 60 seconds. |
| `sth list --json` | Fetches the configured catalog when Catalog is first selected or Load catalog is pressed. Timeout: 120 seconds. |
| `sth init --no-cloud-prompt` | Only when Link this project is pressed after filling the setup form. Passes the selected provider, repository, ref, catalog path, target assistants and public/private choice through stdin, followed by the setup confirmation. Timeout: 180 seconds. |
| `sth install <folder>/<name> --provider <provider-id> --json` | Only for the selected catalog item's Install action. Downloads and installs the selected skill using its catalog metadata. Timeout: 300 seconds. |
| `sth remove <resource-name> --provider <provider-id> --yes --json` | Only after the panel's removal confirmation. Removes the selected managed skill. Timeout: 300 seconds. |
| `sth update --fail-on-changes --json` | Only for the panel's update action. Updates installed skills through STH, preserving its pinned-version and local-change rules, then checks status again. Timeout: 300 seconds. |
| `sth doctor --json` | Only on `/sth-doctor`, opening Diagnostics, or Check installation. Reads STH diagnostics. Timeout: 30 seconds. |
| `git --version`, `node --version`, `npm --version`, `pnpm --version`, `yarn --version`, `bun --version`, `python3 --version`, `python --version`, `cargo --version`, `go version`, `claude --version` | Full diagnostics probe Git and the programs relevant to detected project manifests; one package manager is selected, and `python` is tried only if `python3` is unavailable. Each probe has a 5-second timeout. This does not run project tests. |
| `npm test`, `pnpm test`, `yarn test`, `bun test`, or `claude plugin test .` | Only when the Summary panel's run-tests button is pressed, while no main turn is active. A package with a usable `test` script selects its manager from lockfiles; otherwise a Claude plugin manifest enables `claude plugin test .`. Timeout: 120 seconds. For Vitest without run mode the arguments add `-- --run` for npm or `--run` for the other managers; for Jest they add `-- --watch=false` or `--watch=false`, respectively. |

STH skill operations use `sth` from PATH, `/opt/homebrew/bin/sth` or `/usr/local/bin/sth`, reusing the last successful executable. Another location is tried only after a missing-executable error, so an operation that might already have started is not repeated after a timeout or permission failure. They run in the current session directory. Diagnostics run in the session root; the Summary test action runs in its tracked project directory. Setup clears `STH_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `AZURE_DEVOPS_TOKEN` and `BITBUCKET_TOKEN` in that subprocess environment; existing CLI/Git credential stores still follow the installed CLI's behavior.

The diagnostic list can suggest `python -m pytest` / `python3 -m pytest`, `cargo test`, `go test ./...` and package `test:*` scripts. Suggestions and prepared drafts do not execute those commands. The installation guide displays Homebrew, Scoop, winget and Chocolatey commands for the user to copy; Buddy does not run those installers.

The Open diff button calls the fixed native command `$.command.run({ command: 'diff' })` after checking availability. `$.tool.list()` only inventories exposed tools for MCP diagnostics. Buddy never invokes `$.tool.call`, a shell tool, an agent or an MCP tool. Draft actions call `$.prompt.fill`; they do not submit the text. `$.ui.blit` sends existing image pixels or terminal cells to the local Claude panel; `$.ui.resolve(...).Client` loads the shipped `ui/buddy.ts` or `ui/fika.ts` renderer, not a remote module.

### Written files and intentional project changes

The mod's direct filesystem writes are:

- `<session directory>/.sth/buddy-session.json`, at main-turn completion and after a test action: the abbreviated objective, up to 40 relative paths, 12 check records, a next step, timestamp and format version. The file is limited to 16 KiB; symlink checks protect the destination. The filesystem API creates a missing `.sth` directory. This file is local session data, not an instruction or startup file.
- The verified HD animation cache below `~/.cache/sth-buddy` or `%LOCALAPPDATA%/STH/Buddy`: `<asset-index-sha256>/<generation-uuid>/assets/buddy-codec/<sequence>/<four-digit-frame>.json`, the generation's `assets/buddy-codec/index.json`, and `<asset-index-sha256>/ready.json`. The local `prepareBuddyAssets` helper validates paths, downloads pixel data, checks size and SHA-256, writes and rereads packets, and publishes the readiness pointer only after all seven animations pass. Its injected `write` callback calls `$.fs.write`; it does not execute a command or modify the plugin installation.

STH project setup and skill management intentionally create or modify STH configuration and assistant-managed skill/instruction content through the installed STH CLI. The reviewed CLI source includes these writes:

- `sth init`: `.sth/project.json` and, when the project has a `.git` entry, a managed block in `.gitignore` for STH state files.
- Skill installation/update/removal: managed resources under `.claude/skills` for Claude/Cursor/Copilot and `.agents/skills` for Codex/Gemini/Antigravity. Other catalog resource kinds use the selected assistant's `.claude`, `.github`, `.codex`, `.cursor`, `.agents` or `.gemini` paths for agents, commands, rules and instruction fragments.
- Codex and Gemini instruction resources: managed instruction regions in project `AGENTS.md` and `GEMINI.md`, respectively, with source fragments under `.codex/sth/instructions` or `.gemini/sth/instructions`.
- CLI bookkeeping: `sth-state-v2.json` under the configured target directory and operation state such as `.sth/last-operation.json`.

These are indirect CLI writes, not calls to Buddy's filesystem writer. The installed CLI version, selected targets and catalog determine the exact additional paths and conversion behavior; a different installed version may behave differently from the reviewed source. Buddy does not directly rewrite project build files, startup files, settings files or instructions files. Project test scripts retain their own write behavior.

### Network, data and helper calls

The mod's direct HTTP host is **`raw.githubusercontent.com`**. `prepareBuddyAssets` calls its local `fetchText` callback, which calls Claude's `$.http.fetch(url, { method: 'GET' })` to read public animation JSON over HTTPS. The base is the immutable URL pinned in `tools/buddy-assets-source.json` and the shipped `assets/buddy-codec/remote.json`, under `https://raw.githubusercontent.com/Skills-transfer-hub/sth-claude/<40-character-commit>/mods/sth-usage/assets/buddy-codec/`. Only validated sequence/frame paths are appended. Preparation begins after an image-capable terminal confirms its image protocol and a complete verified cache is absent, or when Retry download is pressed. Each request has a 30-second timeout; playback never fetches frames.

These requests contain the public asset path and ordinary HTTP/connection metadata, with no prompt, transcript, project files, skill identifiers, credentials or mod-generated user id. Received bytes must match the bundled size and SHA-256 before use. The downloaded JSON is pixel data, never imported source, executed code or process arguments. The readable `hooks/vendor/inflate.js` is the bundled lossless decompressor; its optional `Error.captureStackTrace` call only annotates decoding errors.

`runSth` is a separate indirect network path: it launches the user's installed STH CLI. Status, catalog, setup, skill and diagnostic commands may contact the repositories and services configured in `.sth/project.json` and the user's CLI settings. Setup offers GitHub, GitLab, Azure DevOps and Bitbucket, including user-entered repository locations; those hosts are not a fixed mod allowlist. The CLI receives the selected repository/ref/catalog/assistant options through stdin for setup, selected skill/provider identifiers through argv for skill operations, and the project directory as cwd. Buddy does not add session prompts, tool inputs, command output or the Resume summary to those command arguments. The reviewed CLI source defaults to `api.github.com`, `raw.githubusercontent.com`, `gitlab.com`, `dev.azure.com` and `api.bitbucket.org` for repository access, and `jcdadtdkgnwobejkmpgv.supabase.co` for its configured STH Cloud features. The CLI's `STH_GITHUB_API_BASE_URL`, `STH_GITHUB_RAW_BASE_URL`, `STH_GITLAB_API_BASE_URL`, `STH_AZURE_DEVOPS_BASE_URL`, `STH_BITBUCKET_API_BASE_URL` and `STH_CLOUD_BASE_URL` environment overrides can change those destinations. The installed CLI decides its own repository requests, credentials, telemetry and other network behavior; project test scripts likewise retain their own network behavior.

Activating external links opens **`www.skillsth.com`** (dashboard) or **`github.com`** (STH installation documentation and releases). The links contain no prompt or project payload. The local developer preview separately imports Google Fonts through its design-system stylesheet; the shipped mod does not load those fonts. See [PRIVACY.md](PRIVACY.md) for storage, credentials and retention.

### Readable source and assets

The runtime hook and UI modules are readable TypeScript/JavaScript source. The compact build also ships `review-source/`: the exact packaging and image-encoding tools, upstream fflate 0.8.3 decoder input and reproduction script, the original Buddy Blender model, and a source manifest with the exact source commit and SHA-256 hashes. `review-source/fflate/rebuild.py` manually invokes a supplied esbuild 0.27.0 executable to reproduce `hooks/vendor/inflate.js` byte for byte; these build inputs are not imported or registered by the running mod. Original rendered PNG frames are inventoried by path, size and SHA-256 but remain in the source checkout; they are not duplicated in the compact archive. This is a partial source payload, not a claim that every original image input has been attached to a reviewer submission.

The current desktop client still includes encoded WebP frame strings in `ui/frames`; `ui/terminal-frames` still includes encoded BP1 terminal raster strings. These represent image assets, not executable payloads, but remain subject to the directory's encoded-asset review finding. Documenting them does not clear that finding. The builder rejects scripts at or above 1 MiB, binary/non-UTF-8 script contents and image files whose decoded format differs from their extension. These checks do not replace the directory's own scan or reviewer decision.

## Publish a compact distribution

Use a checkout of [the source on main](https://github.com/Skills-transfer-hub/sth-claude/tree/main/mods/sth-usage); compact releases retain the allowlisted review sources and omit previews, local exports and test fixtures. Commit the source changes and version bump first. The builder needs Python 3.12, Pillow 12.3.0 and NumPy 2.3.5. From the mod's source directory:

```sh
sth_release_dir=$(mktemp -d)
sth_source_root=$(git rev-parse --show-toplevel)
sth_source_commit=$(git rev-parse HEAD)
python3 tools/build_directory_bundle.py --source . --output "$sth_release_dir/bundle" --include-tests
claude plugin validate "$sth_release_dir/bundle/sth-usage"
claude plugin test "$sth_release_dir/bundle/sth-usage"
python3 tools/stage_directory_release.py --source-root "$sth_source_root" --bundle "$sth_release_dir/bundle/sth-usage" --output "$sth_release_dir/tree" --source-commit "$sth_source_commit"
python3 tools/publish_directory_release.py --source-root "$sth_source_root" --tree "$sth_release_dir/tree" --publish
```

The publisher updates only `codex/directory-release`, which contains the compact plugin, marketplace, documentation and licensing notices. It refuses older versions and never force-pushes. Omitting `--publish` performs a dry run. Original artwork and development files remain on `main`.

The default build verifies all 574 original frames, then references the immutable asset snapshot recorded in `tools/buddy-assets-source.json`. It fails if the generated asset hashes differ from that snapshot. Use `--embed-assets` for a fully self-contained build; changed artwork must be published as a new data snapshot and the pinned source updated before shipping another lightweight release. Ordinary code updates reuse the existing verified cache.

Configure the Claude Directory source to follow `codex/directory-release` so future update checks see compact releases. Directory validation and review remain separate from GitHub publication. Marketplace users can install from `https://github.com/Skills-transfer-hub/sth-claude.git#codex/directory-release`; they enable automatic updates separately in `/plugin` → Marketplaces → `sth`.

## Rebuild the preview

From [the source checkout on main](https://github.com/Skills-transfer-hub/sth-claude/tree/main/mods/sth-usage), with Node 22 or later and the STH design system available locally:

```sh
node tools/preview_usage_pills.mjs /path/to/design-system
python3 -m http.server 8768 --bind 127.0.0.1 --directory previews/usage-band
```

Open [the local preview](http://127.0.0.1:8768/). STH, Summary and More open sample views in the same panel; Home returns to the usage overview and closes the previous view. The STH view has working Installed and Catalog tabs. Installation, removal, session actions and dashboard navigation are disabled in the preview.

The generator uses the mod's SVG renderer and copies the original Buddy image and design system styles without modifying their sources. The preview uses the design system's Google Fonts import, with its declared local fallbacks. The mod does not fetch these fonts at runtime.
