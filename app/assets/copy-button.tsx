import { clientEntry, css, on, type Handle, type SerializableProps } from 'remix/ui'

const HOLD_MS = 1400

interface CopyButtonProps extends SerializableProps {
  text: string
  label?: string
}

// A small copy-to-clipboard button that hydrates independently. Used to make the
// API curl snippets one-click copyable.
export const CopyButton = clientEntry(
  import.meta.url,
  function CopyButton(handle: Handle<CopyButtonProps>) {
    let copied = false

    return () => {
      let label = copied ? 'Copied' : (handle.props.label ?? 'Copy')

      return (
        <button
          type="button"
          mix={[
            buttonStyle,
            on('click', async (_event, signal) => {
              try {
                await navigator.clipboard.writeText(handle.props.text)
              } catch {
                return
              }
              copied = true
              await handle.update()
              await wait(HOLD_MS)
              if (signal.aborted) return
              copied = false
              await handle.update()
            }),
          ]}
          style={{ color: copied ? 'var(--success)' : undefined }}
        >
          {label}
        </button>
      )
    }
  },
)

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

const buttonStyle = css({
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '6px 12px',
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  '&:hover': { background: 'var(--surface-2)' },
})
