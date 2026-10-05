# Privacy and data handling

Last updated: 2026-10-05. Applies to the Buddy · STH Claude Code mod (`sth-usage`).

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

Usage tracking does not make an additional model request or send a mod-specific analytics event. Diagnostics can run local version checks and `sth doctor`. STH status and catalog refreshes, setup and skill actions invoke your installed STH CLI; those commands can contact configured repositories or services, use existing CLI or Git credentials, and create or modify STH configuration and managed files. Their network behavior, telemetry and credential storage follow your STH CLI and provider settings. Project tests run only when you request them in the panel; those scripts have their own behavior.

The STH dashboard and documentation links open external websites when you activate them. Their websites have their own data-handling practices. Resume and verification buttons fill a Claude draft; they do not submit it. If you send that draft, Claude processes it under your Claude account's settings and terms.

## Support

Use the [public GitHub issue tracker](https://github.com/Skills-transfer-hub/sth-claude/issues) for questions about the mod or this notice. Issues are public: do not post credentials, private prompts, confidential source code or unredacted summaries.
