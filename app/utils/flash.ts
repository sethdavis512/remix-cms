// Typed flash messages: a text plus an outcome type, so the AdminShell banner
// can signal success (green) vs neutral info (blue) vs destructive/danger
// (red) instead of rendering every outcome as a success. Structural session
// interface only — no framework imports — so this stays a pure helper.

export type FlashType = 'success' | 'info' | 'danger'

export interface FlashSession {
  get(key: string): unknown
  flash(key: string, value: string): void
}

export function flashMessage(session: FlashSession, text: string, type: FlashType = 'success') {
  session.flash('message', text)
  session.flash('messageType', type)
}

export function readFlash(session: FlashSession): { message: string | null; type: FlashType } {
  let message = session.get('message')
  let rawType = session.get('messageType')
  return {
    message: typeof message === 'string' ? message : null,
    type: rawType === 'info' || rawType === 'danger' ? rawType : 'success',
  }
}
