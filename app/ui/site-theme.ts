import { css } from 'remix/ui'

// Shared visual tokens for the public site (home + blog) so both surfaces read
// as one site. `themeVars` declares the light-mode design tokens (default) with
// dark-mode overrides and a box-sizing reset; spread it into a page's root
// `css({ ...themeVars, ... })`. The CTA mixins are ready to apply via `mix`.

export const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

export const themeVars = {
  // Light-mode design tokens (default).
  '--surface-0': '#dee2e6',
  '--surface-3': '#f0f4f7',
  '--surface-4': '#f7fbff',
  '--border': '#d4dade',
  '--text-primary': '#313539',
  '--text-secondary': '#5c6672',
  '--text-tertiary': '#94989c',
  '--brand-blue': '#2dacf9',
  '--brand-strong': '#1892e0',
  // Dark-mode overrides.
  '@media (prefers-color-scheme: dark)': {
    '--surface-0': '#1e2226',
    '--surface-3': '#313539',
    '--surface-4': '#363a3e',
    '--border': '#3d4348',
    '--text-primary': '#dee2e6',
    '--text-secondary': '#aeb3b8',
    '--text-tertiary': '#94989c',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
}

const ctaBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '11px 20px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 700,
  textDecoration: 'none',
  transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
}

export const primaryCta = css({
  ...ctaBase,
  background: 'var(--brand-blue)',
  color: '#fff',
  border: '1px solid transparent',
  '&:hover, &:focus-visible': { background: 'var(--brand-strong)', outline: 'none' },
})

export const secondaryCta = css({
  ...ctaBase,
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  '&:hover, &:focus-visible': {
    background: 'var(--surface-4)',
    color: 'var(--brand-blue)',
    outline: 'none',
  },
})
