# Privacy and data handling

Last updated: 2026-10-08. Applies to the Buddy · STH Claude Code mod (`sth-usage`).

## Data the mod uses

The mod runs inside Claude Code with your local permissions. It reads session usage, context estimates, active-agent information and tool events to display progress, quotas, changed paths, errors and test results. It reads selected project manifests, directory names and `.sth/project.json` for diagnostics and catalog recommendations. This information can contain personal or confidential data. Tool inputs used to match permission requests stay in memory for the active turn; they are not logged, persisted or sent to a server by this observer.

The Resume feature derives a short objective from your first submitted prompt in the session. Fika reads the current draft and session messages to determine whether you have started writing a prompt; it does not save a transcript. Tool arguments and results are inspected to identify changed files and test exit codes, but the saved Resume summary does not contain full tool arguments, command output or a transcript.

## Local storage and retention

At turn end or after a test run requested in the panel, the mod writes `.sth/buddy-session.json` in the session directory. The file contains:

- A prompt-derived objective, limited to 180 characters.
- Up to 40 relative file paths and 12 test records, including labels, statuses and exit codes.
- A suggested next step, save timestamp and format version.

The serialized file is limited to 16 KiB. Common credential patterns and URLs are masked in the objective, and certain sensitive filenames are excluded. These filters are not a guarantee that all sensitive information is removed.

There is no automatic expiry. The file remains until it is overwritten by a later summary or deleted manually. Uninstalling the mod does not delete this project file. Disable or uninstall the mod and reload Claude Code before deleting it if you want to prevent it from being recreated. Review the file before sharing a project, and exclude `.sth/buddy-session.json` from version control when appropriate. Claude Code's own logs, session history, plugin state and retention are governed by Claude Code, separately from this file.

## Processes, credentials and network access

In the lightweight release, image-capable terminals download public HD animation packets from `raw.githubusercontent.com`, owned by GitHub, using URLs pinned to one commit in `Skills-transfer-hub/sth-claude`. Each packet's size and SHA-256 are checked against the index bundled with the plugin before playback. Requests contain no prompt, transcript, project data, STH or GitHub credential, or mod-generated user identifier. As with any HTTPS request, GitHub receives the connection's IP address and ordinary HTTP metadata; its logging and retention follow GitHub's privacy policy. The mod does not add analytics events for these downloads.

The verified animation cache remains on the user's machine without automatic expiry, across sessions, plugin updates and uninstallation. Its location is documented in the README. Failed or simultaneous preparations may leave incomplete cache generations; these are never used for playback. Closing Claude and deleting this dedicated cache removes them, but the next HD launch will require another download. Desktop and portable terminal animations remain bundled and do not make these requests. Once HD assets are verified locally, playback makes no network requests.

Usage tracking does not make an additional model request or send a mod-specific analytics event. On session start and directory changes, Buddy probes the installed STH executable with `sth version`; linked projects also refresh `sth status --json`. Full diagnostics are requested through `/sth-doctor`, Diagnostics or Check installation, and run local version checks plus `sth doctor --json`. Selecting Catalog or Load catalog runs `sth list --json`. The README's [program inventory](README.md#programs-and-command-calls) lists every command form, trigger and timeout.

Setup, installation, removal and updates launch the installed STH CLI only from the corresponding panel actions. Setup passes the selected provider, repository, ref, catalog path, target assistants and visibility through stdin. Skill actions pass the selected resource and provider identifiers as individual command arguments. The subprocess also receives the project directory as cwd. The mod does not add your prompt, transcript, observed tool inputs, command output or Resume summary to these arguments.

These STH commands can contact repositories and services configured in `.sth/project.json` and your CLI settings. The setup form accepts GitHub, GitLab, Azure DevOps and Bitbucket repositories, including user-entered hosts. The reviewed CLI source uses `api.github.com`, `raw.githubusercontent.com`, `gitlab.com`, `dev.azure.com` and `api.bitbucket.org` by default for repository access, and `jcdadtdkgnwobejkmpgv.supabase.co` for its configured STH Cloud features. CLI environment overrides can replace those hosts; the README lists the override names. Repository requests, existing CLI/Git credentials, telemetry and credential retention depend on the installed STH CLI and provider settings. Setup clears `STH_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `AZURE_DEVOPS_TOKEN` and `BITBUCKET_TOKEN` in that subprocess environment; it does not clear existing credential stores. Buddy does not upload project content itself through its animation HTTP helper.

Project setup intentionally establishes `.sth/project.json` and can add STH state-file exclusions to `.gitignore`. Skill actions intentionally change managed assistant content under `.claude`, `.github`, `.codex`, `.cursor`, `.agents` or `.gemini`; Codex/Gemini instruction resources can also update managed regions in `AGENTS.md` / `GEMINI.md`. CLI state includes `sth-state-v2.json` under the configured target directory and `.sth/last-operation.json`. These paths reflect the reviewed CLI source; exact writes depend on the installed CLI version, selected assistant targets and catalog. Uninstalling Buddy does not undo these STH changes. The mod's own filesystem writer only writes the Resume file and animation cache described above.

Project tests run only when you request them in Summary. This launches the project's package-manager test script (npm, pnpm, yarn or bun, with non-watch flags for recognized Vitest/Jest scripts) or `claude plugin test .`. The project's scripts and tools determine their own filesystem writes, subprocesses and network behavior. Merely opening Diagnostics or observing a process event does not run those tests.

The STH dashboard link opens `www.skillsth.com`; installation documentation and release links open `github.com` when you activate them. These links carry no prompt or project data. Their websites have their own data-handling practices. Resume and verification buttons fill a Claude draft; they do not submit it. If you send that draft, Claude processes it under your Claude account's settings and terms.

## Support

Use the [public GitHub issue tracker](https://github.com/Skills-transfer-hub/sth-claude/issues) for questions about the mod or this notice. Issues are public: do not post credentials, private prompts, confidential source code or unredacted summaries.
