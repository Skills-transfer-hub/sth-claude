# Buddy · Claude Code

Version **0.3.0**. The version is also visible at the bottom of the Home panel.

Buddy tracks Claude context and quotas, changed files and checks, then helps you find STH skills that fit your project.

## Install from GitHub

Requires Claude Code **2.1.287 or later** and Git. Run in your terminal:

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git
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

## Load the mod

Claude Code 2.1.287 or later is required. From this directory:

```sh
claude --plugin-dir .
```

The module reloads on every save in a session that has loaded it. Desktop sessions without the plugin do not receive these features automatically.

## Usage

The interface lives in the right panel. The home screen keeps Buddy, followed by a single navigation row: STH, Summary and More (Context, Diagnostics and Resume). The STH page manages installed skills and the catalog. More expands three navigation buttons. Other screens provide a single Home button. Navigation replaces the current panel instead of stacking another panel on top. The mod does not add a strip above the message field.

The Usage card shows each metric once: quotas and reset times, context, observed tokens, cost and agents. Pills follow the STH design system's neutral tokens: thin outlines, Inter labels and JetBrains Mono SVG values. Native controls keep the fonts and dimensions imposed by Claude; terminal buttons have neutral outlines. Red is reserved for errors.

Desktop pill details appear on hover. The countdown redraws every 30 seconds without requesting new usage data. “~” marks tokens accumulated since the mod loaded; earlier history may be missing. A [panel preview](previews/usage-band/index.html) shows light, dark and narrow layouts with sample data; it is not a Claude session.

| Access | Function |
| --- | --- |
| More → Context or `/sth-context` | Context breakdown: system, tools, MCP, memory, messages and active agents. |
| `/sth-usage` | Buddy, combined usage metrics and navigation to the other panels. |
| Summary or `/sth-activity` | Files actually written, tool errors and observed tests. Buttons open the diff, prepare a verification draft and show the detailed summary. Recognized tests run only when explicitly requested in the panel. |
| STH or `/sth-skills` | Installed skills, versions and updates; catalog recommendations based on project manifests. |
| `/sth-doctor` | Stack, available binaries, test commands, STH configuration and observed MCP tool status. Diagnostics do not run tests. |
| More → Resume or `/sth-resume` | Goal, files, checks and next step from the previous session. Inspect the summary before explicitly adding it to the draft; it is not sent automatically. |

Buddy distinguishes work in progress, pending permission, errors, completed turns and interruptions. A main turn lasting at least 60 seconds triggers a discreet notification in Claude.

Buddy tries to display the original PNGs when the terminal supports images: 384 × 384 for regular states and 720 × 720 for Fika. An actual image rejection from the terminal enables a colored quadrant fallback generated from 96 × 96 poses. This remains a character-based drawing: its detail depends on the panel size and terminal font. Under tmux, the fallback is used directly. The panel adapts the animation to its size and suggests enlarging it when space is limited. Desktop keeps the existing HD images.

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

Tests cover terminal and desktop rendering, buttons and drafts, missing data, permissions, summaries and resume, plus the existing Buddy and Fika animations.

## Rebuild the preview

With Node 22 or later and the STH design system available locally:

```sh
node tools/preview_usage_pills.mjs /path/to/design-system
python3 -m http.server 8768 --bind 127.0.0.1 --directory previews/usage-band
```

Open [the local preview](http://127.0.0.1:8768/). STH, Summary and More open sample views in the same panel; Home returns to the usage overview and closes the previous view. The STH view has working Installed and Catalog tabs. Installation, removal, session actions and dashboard navigation are disabled in the preview.

The generator uses the mod's SVG renderer and copies the original Buddy image and design system styles without modifying their sources. The preview uses the design system's Google Fonts import, with its declared local fallbacks. The mod does not fetch these fonts at runtime.
