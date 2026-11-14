# Buddy theme · Claude

Version **0.1.1**. Buddy's colors for the Claude app, and Buddy's fika nook behind the conversation: Buddy at his bench with a coffee and a kanelbulle, little Buddies at work, asleep or peeking in through the window. Morning in light mode, evening in dark mode.

## Install

Tested on Claude Code 2.1.323 and 2.1.325. In your terminal:

```sh
claude plugin marketplace add https://github.com/Skills-transfer-hub/sth-claude.git
claude plugin install sth-theme@sth --scope user
```

Skip the first line if you already installed Buddy (`sth-usage`): both mods come from the same marketplace. Start a new session to see the theme. The user scope applies it in every project.

In Claude Desktop, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Skills-transfer-hub/sth-claude`, then add the Buddy theme. A mod installed from a terminal at the user scope also loads in Desktop's Code tab.

To update:

```sh
claude plugin marketplace update sth
claude plugin update sth-theme@sth
```

To uninstall, run `claude plugin uninstall sth-theme@sth`.

## What it changes

- **Colors.** Chalk by day, graphite by night, and the emerald of the STH terminal as the only accent (`hooks/register.tsx`).
- **Backdrop.** A scene named `fika`, drawn in vector: no image file is loaded. The app draws a backdrop as a still picture, so nothing moves in it. The scene switches between morning and evening with the light or dark appearance (CSS `prefers-color-scheme`).
- **Glass.** The app frosts its panels over the backdrop by default, which turns the scene into a smear. The theme sets no blur and a 45% tint so Buddy shows through.

## Accessibility

- Over the still scene, about 95% of the chat column reaches 4.5:1 (WCAG AA) for the muted text, and more for the other text. That is measured on the scene drawn alone under the 45% tint, not in the app. The muted grays are a notch stronger than the design system's for that.
- The scene is decoration: it has no text alternative for a screen reader to announce.
- When the system asks for more contrast (`prefers-contrast: more`), a wash of the window's own color covers the scene. In the same measure, every text then reaches 4.5:1.

## Privacy

The theme reads no session data, writes nothing to disk and makes no network request. It sets the colors and the backdrop when a session starts, and nothing else.

## Local development

```sh
git clone https://github.com/Skills-transfer-hub/sth-claude.git
cd sth-claude
claude --plugin-dir ./mods/sth-theme
```

```sh
claude plugin validate ./mods/sth-theme
claude plugin test ./mods/sth-theme
```

The scene is a function of time in `hooks/scene.ts` (`scene(t)`); the app draws one instant of it, `scene(4)`, with Buddy's cup set down on the bench.

## License

See [LICENSE](LICENSE): source code under MIT, Buddy artwork and STH branding reserved.
