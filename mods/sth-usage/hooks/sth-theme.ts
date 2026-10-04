/**
 * STH semantic tokens, copied from design-system/tokens/{colors,typography,spacing}.css.
 * Keep these roles paired with their canonical OKLch values below. The sRGB values
 * are the nearest 8-bit conversion (OKLch → OKLab → linear sRGB → sRGB, clipped to
 * the sRGB gamut), for native UI renderers that cannot parse OKLch. No remote fonts.
 */
export const STH_UI = {
  light: {
    background: '#ffffff', foreground: '#0a0a0a', card: '#ffffff',
    primary: '#171717', primaryForeground: '#fafafa',
    secondary: '#f5f5f5', secondaryForeground: '#171717',
    muted: '#f5f5f5', mutedForeground: '#737373',
    border: '#e5e5e5', input: '#e5e5e5', ring: '#a1a1a1', destructive: '#e7000b',
  },
  dark: {
    background: '#0a0a0a', foreground: '#fafafa', card: '#171717',
    primary: '#e5e5e5', primaryForeground: '#171717',
    secondary: '#262626', secondaryForeground: '#fafafa',
    muted: '#262626', mutedForeground: '#a1a1a1',
    border: '#ffffff1a', input: '#ffffff26', ring: '#737373', destructive: '#ff6467',
  },
} as const

export const STH_OKLCH = {
  light: {
    background: 'oklch(1 0 0)', foreground: 'oklch(0.145 0 0)', card: 'oklch(1 0 0)',
    primary: 'oklch(0.205 0 0)', primaryForeground: 'oklch(0.985 0 0)',
    secondary: 'oklch(0.97 0 0)', secondaryForeground: 'oklch(0.205 0 0)',
    muted: 'oklch(0.97 0 0)', mutedForeground: 'oklch(0.556 0 0)',
    border: 'oklch(0.922 0 0)', input: 'oklch(0.922 0 0)', ring: 'oklch(0.708 0 0)',
    destructive: 'oklch(0.577 0.245 27.325)',
  },
  dark: {
    background: 'oklch(0.145 0 0)', foreground: 'oklch(0.985 0 0)', card: 'oklch(0.205 0 0)',
    primary: 'oklch(0.922 0 0)', primaryForeground: 'oklch(0.205 0 0)',
    secondary: 'oklch(0.269 0 0)', secondaryForeground: 'oklch(0.985 0 0)',
    muted: 'oklch(0.269 0 0)', mutedForeground: 'oklch(0.708 0 0)',
    border: 'oklch(1 0 0 / 10%)', input: 'oklch(1 0 0 / 15%)', ring: 'oklch(0.556 0 0)',
    destructive: 'oklch(0.704 0.191 22.216)',
  },
} as const

// Fixed terminal surface: the emerald is reserved for actual terminal success.
export const STH_TERMINAL = {
  background: '#121212', chrome: '#1d1d1d', border: '#2e2e2e',
  foreground: '#e8e8e8', mutedForeground: '#717171', accent: '#3bb974',
} as const

export const STH_FONTS = {
  sans: '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif',
  mono: '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
} as const

export const STH_RADII = { inner: 8, control: 10, card: 14, badge: 26 } as const
