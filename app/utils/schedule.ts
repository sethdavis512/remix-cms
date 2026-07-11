// Shared helpers for datetime-local scheduling inputs (releases and per-entry
// publish/unpublish timers). Times are interpreted in the server's timezone.

// "2026-05-30T09:00" (datetime-local, server-local time) -> epoch ms, or null
// when blank/invalid.
export function parseScheduledAt(value: string): number | null {
  if (value.trim() === '') return null
  let ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

// epoch ms -> a short human-readable timestamp for admin display.
export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// epoch ms -> datetime-local input value in server-local time.
export function toDatetimeLocal(ms: number): string {
  let d = new Date(ms)
  let pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
