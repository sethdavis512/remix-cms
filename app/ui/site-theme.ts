import { css } from 'remix/ui'

// Shared visual language for the public site (home + blog): a warm "galley
// proof" editorial look. Paper surfaces and ink text in oklch, one cobalt
// accent, a display serif for headlines, a grotesque for UI text, and mono
// reserved for actual code. `themeVars` declares light-mode tokens (default)
// with dark-mode overrides and a box-sizing reset; spread it into a page's
// root `css({ ...themeVars, ... })`. The mixins below apply via `mix`.

export const SERIF_STACK = "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
export const SANS_STACK = "'Archivo', 'Avenir Next', 'Helvetica Neue', Helvetica, sans-serif"
export const MONO_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

export const themeVars = {
  // Light-mode design tokens (default): warm ivory paper, warm ink.
  '--paper': 'oklch(0.965 0.014 84)',
  '--paper-raised': 'oklch(0.985 0.008 84)',
  '--ink': 'oklch(0.26 0.022 65)',
  '--ink-soft': 'oklch(0.44 0.02 65)',
  '--ink-faint': 'oklch(0.52 0.016 70)',
  '--rule': 'oklch(0.86 0.02 80)',
  '--accent': 'oklch(0.47 0.17 262)',
  '--accent-strong': 'oklch(0.4 0.16 262)',
  '--on-accent': 'oklch(0.975 0.008 84)',
  // Dark-mode overrides: warm charcoal, never pure black.
  '@media (prefers-color-scheme: dark)': {
    '--paper': 'oklch(0.225 0.012 65)',
    '--paper-raised': 'oklch(0.26 0.014 65)',
    '--ink': 'oklch(0.93 0.012 84)',
    '--ink-soft': 'oklch(0.76 0.014 80)',
    '--ink-faint': 'oklch(0.66 0.012 75)',
    '--rule': 'oklch(0.34 0.014 65)',
    '--accent': 'oklch(0.75 0.11 262)',
    '--accent-strong': 'oklch(0.83 0.09 262)',
    '--on-accent': 'oklch(0.2 0.02 262)',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  '& ::selection': { background: 'var(--accent)', color: 'var(--on-accent)' },
}

// Root <main> shell every public page shares.
export const pageShell = css({
  ...themeVars,
  margin: 0,
  minHeight: '100vh',
  padding: '0 clamp(20px, 5vw, 48px)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: SANS_STACK,
  fontSize: '16px',
  lineHeight: 1.6,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
})

// Small-caps kicker used for section labels and metadata lines.
export const eyebrow = css({
  margin: 0,
  fontFamily: SANS_STACK,
  fontWeight: 600,
  fontSize: '12px',
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: 'var(--ink-faint)',
})

// Inline text link: accent ink with a hairline underline that firms up on hover.
export const textLink = css({
  color: 'var(--accent)',
  textDecoration: 'underline',
  textDecorationColor: 'color-mix(in oklch, var(--accent) 35%, transparent)',
  textDecorationThickness: '1px',
  textUnderlineOffset: '4px',
  transition: 'color 120ms ease, text-decoration-color 120ms ease',
  '&:hover, &:focus-visible': {
    color: 'var(--accent-strong)',
    textDecorationColor: 'var(--accent-strong)',
    outline: 'none',
  },
})

const ctaBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px 22px',
  borderRadius: '3px',
  fontFamily: SANS_STACK,
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  transition: 'background-color 140ms ease, color 140ms ease, border-color 140ms ease',
}

export const primaryCta = css({
  ...ctaBase,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  border: '1px solid var(--accent)',
  '&:hover, &:focus-visible': {
    background: 'var(--accent-strong)',
    borderColor: 'var(--accent-strong)',
    outline: 'none',
  },
})

export const secondaryCta = css({
  ...ctaBase,
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--rule)',
  '&:hover, &:focus-visible': {
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
    outline: 'none',
  },
})
