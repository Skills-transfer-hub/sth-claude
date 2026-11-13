# Buddy by STH · 0.3.6

This branch contains the generated distribution, readable runtime source and [submitted build inputs](mods/sth-usage/review-source/README.md). The original rendered PNG frames remain in [the exact source commit](https://github.com/Skills-transfer-hub/sth-claude/tree/2544087dcbe346439ecd1bb3a2abec0896a1671a/mods/sth-usage/assets); their SHA-256 hashes are included in the review-source manifest.

Requires Claude Code 2.1.287 or later and Git.

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git#codex/directory-release
claude plugin install sth-usage@sth --scope user
```

Restart Claude Code or run `/reload-plugins`, then `/sth-usage`. To receive future versions automatically, enable auto-update for `sth` in `/plugin` → Marketplaces. Manual update: `claude plugin update sth-usage@sth`.

See [usage](mods/sth-usage/README.md), [privacy](mods/sth-usage/PRIVACY.md), [licensing](mods/sth-usage/LICENSE) and the bundled third-party notices.

Built from [2544087](https://github.com/Skills-transfer-hub/sth-claude/commit/2544087dcbe346439ecd1bb3a2abec0896a1671a); `release.json` records the source and file hashes.
