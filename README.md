# STH · Buddy for Claude Code

**v0.3.1** · Buddy keeps usage, session summaries, project diagnostics and STH catalogs in one right-hand panel. The interface is in English and follows the STH design system. Buddy keeps its original visuals and animations.

## Install

You need **Claude Code 2.1.287 or later** and Git. In your terminal:

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git
claude plugin install sth-usage@sth --scope user
```

Start Claude Code in your project, then run `/sth-usage`. If a session is already open, run `/reload-plugins` first. The user scope makes Buddy available across your projects.

The STH CLI is optional for usage tracking. Install it to manage catalogs and project skills; Buddy shows setup instructions when it is missing. See the [complete mod guide](mods/sth-usage/README.md#install-sth).

## Update or uninstall

```sh
claude plugin marketplace update sth
claude plugin update sth-usage@sth
```

Reload plugins or restart Claude Code after updating. To remove Buddy:

```sh
claude plugin uninstall sth-usage@sth
```

This uses Claude Code's standard [mod installation](https://code.claude.com/docs/en/plugins/mods/overview) and [marketplace distribution](https://code.claude.com/docs/en/plugin-marketplaces). No manual clone or development flag is needed after installation.

## Use Buddy

- `/sth-usage`: Buddy, quotas, context, observed tokens, cost and agents.
- STH or `/sth-skills`: installed skills, catalog, installation, removal and updates.
- Summary or `/sth-activity`: changed files, observed checks and verification actions.
- More: Context, Diagnostics and Resume.
- Home: close the current panel and return to Buddy.

Buddy offers a Fika break before the first prompt. The original nine-second animation and its transparency are preserved. See the [mod guide](mods/sth-usage/README.md) for behavior, data limitations and commands.

## Local development

```sh
git clone https://github.com/Skills-transfer-hub/sth-claude.git
cd sth-claude
claude --plugin-dir ./mods/sth-usage
```

The development mod reloads when its files change. Avoid loading the development copy and the installed plugin at the same time.

```sh
claude plugin validate .
claude plugin validate ./mods/sth-usage
claude plugin test ./mods/sth-usage
```

## Sources and previews

- [Interactive interface preview](mods/sth-usage/previews/usage-band/index.html) with sample data.
- [Buddy V6 Blender model](mods/sth-usage/assets/model/buddy-v6.blend).
- [Fika V1 sources](mods/sth-usage/previews/fika-3d/) and [transparent exports](mods/sth-usage/previews/fika-3d/transparent/).
- [Rendering and encoding tools](mods/sth-usage/tools/README.md).

Exploratory animation variants remain separate from the mod. Generated preview frame sequences are not tracked; source scenes, videos and runtime animation modules are included.
