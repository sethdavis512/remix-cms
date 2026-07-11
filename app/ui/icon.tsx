import type { Handle, RemixNode } from 'remix/ui'

// Small inline-SVG icon set for the admin shell nav (and the odd inline glyph).
// Lucide-style: a 24x24 viewBox drawn with the current text color as stroke, so
// icons inherit color from their surroundings. Add a name here and to IconName
// to make it available.

export type IconName =
  | 'Dashboard'
  | 'Blocks'
  | 'Box'
  | 'Globe'
  | 'Rocket'
  | 'Webhook'
  | 'KeyRound'
  | 'Users'
  | 'ScrollText'
  | 'Folder'
  | 'LogOut'
  | 'Flag'

// Inner paths per icon, drawn inside a shared <svg> wrapper below.
const PATHS: Record<IconName, RemixNode> = {
  Dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  Blocks: (
    <>
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <path d="M10 21H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2Z" />
      <path d="M3 8a5 5 0 0 1 5-5" />
    </>
  ),
  Box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  Globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
    </>
  ),
  Rocket: (
    <>
      <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.9.7-2.2-.2-3-.8-.8-2.1-.8-2.8.2Z" />
      <path d="M12 15 9 12a11 11 0 0 1 4-8c2-2 4-2.5 6-2.5C15.5 3 15 5 13 7a11 11 0 0 1-1 8Z" />
      <path d="M9 12H4s.5-2.5 2-3.5C7 8 9 8 9 8" />
      <path d="M12 15v5s2.5-.5 3.5-2c.5-1 .5-3 .5-3" />
    </>
  ),
  Webhook: (
    <>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 1 1 4 12.9" />
      <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 1 1-3.92 4.95" />
    </>
  ),
  KeyRound: (
    <>
      <path d="M2.59 13.41a2 2 0 0 0 0 2.83l1.83 1.83a2 2 0 0 0 2.83 0l6.06-6.06a6 6 0 1 0-4.66-4.66Z" />
      <circle cx="16.5" cy="7.5" r="1" />
    </>
  ),
  Users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  ScrollText: (
    <>
      <path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11" />
      <path d="M4 16a2 2 0 1 0 0 4h2" />
      <path d="M8 8h6M8 12h6" />
    </>
  ),
  Folder: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  LogOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  Flag: (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z" />
      <path d="M4 22v-7" />
    </>
  ),
}

export function Icon(handle: Handle<{ name: IconName; size?: number }>) {
  return () => {
    let { name, size = 18 } = handle.props
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        {PATHS[name]}
      </svg>
    )
  }
}
