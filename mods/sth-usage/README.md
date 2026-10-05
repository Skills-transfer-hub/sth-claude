# Buddy · Claude Code

Version **0.3.3**. The version is also visible at the bottom of the Home panel.

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

The `tool.check` hook observes the decision returned by `next(e)` to display Buddy's waiting state. It returns the original continuation result, including its decision, reason and metadata; it never grants permission or replaces a user's decision. `classic.PermissionRequest` and permission notifications only update that state. Tool and `process.run` hooks observe completed calls for changed paths, errors and actual test exit codes, then return the original results. They do not alter commands or their output.

The Open diff button runs Claude's built-in `/diff` command when available. Resume and verification actions only fill a draft. Project changes reset project-specific panel state through `classic.CwdChanged`; they do not alter settings, instructions or the new working directory. The pane navigation hook closes the other Buddy panes and sets the STH pane title.

Network downloads are restricted to the immutable public animation URLs described above. Downloaded bytes are verified pixel data and never become command arguments or executable code. The cache writer only writes animation JSON and its readiness pointer in the dedicated cache directory. The readable `hooks/vendor/inflate.js` implements the lossless decompressor; its optional `Error.captureStackTrace` call only annotates decoding errors. It is not a script loader. Long encoded strings in `ui/frames` and `ui/terminal-frames` are the unchanged bundled desktop WebP images and terminal raster data, not executable downloads. Their original artwork and build tools remain in the public source checkout on `main` for review.

Local programs run independently of these downloads: the installed STH CLI handles status, catalog refresh, project setup, installation, removal and updates; diagnostics run binary version checks and `sth doctor`; an explicitly requested test action runs the recognized project test command. These processes retain the user's local CLI permissions and may contact the services configured in STH. The privacy notice describes the session and project data read locally and the separate GitHub image requests.

## Publish a compact distribution

Use a checkout of [the source on main](https://github.com/Skills-transfer-hub/sth-claude/tree/main/mods/sth-usage); compact releases omit build tools and previews. Commit the source changes and version bump first. The builder needs Python 3.12, Pillow 12.3.0 and NumPy 2.3.5. From the mod's source directory:

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
