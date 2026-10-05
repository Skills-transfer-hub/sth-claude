# Buddy by STH · 0.3.2

This branch contains the generated distribution. Source code and original artwork remain on [main](https://github.com/Skills-transfer-hub/sth-claude/tree/main).

Requires Claude Code 2.1.287 or later and Git.

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git#codex/directory-release
claude plugin install sth-usage@sth --scope user
```

Restart Claude Code or run `/reload-plugins`, then `/sth-usage`. To receive future versions automatically, enable auto-update for `sth` in `/plugin` → Marketplaces. Manual update: `claude plugin update sth-usage@sth`.

See [usage](mods/sth-usage/README.md), [privacy](mods/sth-usage/PRIVACY.md), [licensing](mods/sth-usage/LICENSE) and the bundled third-party notices.

Built from [76d7a3c](https://github.com/Skills-transfer-hub/sth-claude/commit/76d7a3c98c3aa01457b94f9192cb121a87f56a64); `release.json` records the source and file hashes.
