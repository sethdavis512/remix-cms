import { clientEntry, css, on, ref, type Handle, type SerializableProps } from 'remix/ui'

// An image tile preview for the Media Library that opens a full-size lightbox
// on click. remix/ui ships no modal component (only the anchored popover
// primitive), so this uses a native <dialog> + showModal(): Esc closing comes
// for free, plus a visible ✕ button and click-on-backdrop to close. Each image
// tile hydrates its own instance (dialog-per-item keeps state trivial).
//
// No-JS fallback: the thumbnail is a real <a href> to the /uploads serving
// route with target="_blank", so without JavaScript a click simply opens the
// image in a new tab. The hydrated click handler preventDefaults and opens the
// dialog instead. The server-rendered <dialog> is closed (hidden) by default.

interface MediaLightboxProps extends SerializableProps {
  src: string
  filename: string
  meta: string
}

export const MediaLightbox = clientEntry(
  import.meta.url,
  function MediaLightbox(handle: Handle<MediaLightboxProps>) {
    // Captured when the dialog mounts; null on the server and until hydration,
    // so the click handler falls through to the anchor's default navigation.
    let dialog: HTMLDialogElement | null = null

    return () => {
      let { src, filename, meta } = handle.props

      return (
        <div mix={wrapperStyle}>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            title={`Preview ${filename}`}
            mix={[
              thumbLinkStyle,
              on<HTMLAnchorElement>('click', (event) => {
                if (!dialog) return
                event.preventDefault()
                dialog.showModal()
              }),
            ]}
          >
            <img src={src} alt={filename} mix={thumbImageStyle} />
          </a>

          <dialog
            mix={[
              dialogStyle,
              ref((node: Element) => {
                dialog = node as HTMLDialogElement
              }),
              // The dialog itself (padding 0) is only hit when the click lands
              // on the backdrop area outside the content box.
              on<HTMLDialogElement>('click', (event) => {
                if (event.target === event.currentTarget) dialog?.close()
              }),
            ]}
          >
            <figure mix={contentStyle}>
              <button
                type="button"
                aria-label="Close preview"
                title="Close"
                mix={[closeButtonStyle, on<HTMLButtonElement>('click', () => dialog?.close())]}
              >
                ✕
              </button>
              <img src={src} alt={filename} mix={fullImageStyle} />
              <figcaption mix={captionStyle}>
                <span mix={captionNameStyle}>{filename}</span>
                <span mix={captionMetaStyle}>{meta}</span>
              </figcaption>
            </figure>
          </dialog>
        </div>
      )
    }
  },
)

// ----- Styles -----

const wrapperStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
})

const thumbLinkStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  cursor: 'pointer',
  transition: 'filter 120ms ease, transform 120ms ease',
  '&:hover': { filter: 'brightness(1.08)', transform: 'scale(1.02)' },
})

const thumbImageStyle = css({
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
})

const dialogStyle = css({
  padding: 0,
  border: 'none',
  background: 'transparent',
  maxWidth: '90vw',
  maxHeight: '85vh',
  '&::backdrop': {
    background: 'rgba(0, 0, 0, 0.65)',
    backdropFilter: 'blur(4px)',
  },
})

const contentStyle = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  margin: 0,
  padding: '16px',
  borderRadius: '14px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
})

const fullImageStyle = css({
  display: 'block',
  maxWidth: 'calc(90vw - 32px)',
  maxHeight: 'calc(85vh - 90px)',
  objectFit: 'contain',
  borderRadius: '8px',
})

const captionStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
})

const captionNameStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  overflowWrap: 'anywhere',
})

const captionMetaStyle = css({
  fontSize: '12px',
  color: 'var(--text-tertiary)',
  whiteSpace: 'nowrap',
})

const closeButtonStyle = css({
  position: 'absolute',
  top: '8px',
  right: '8px',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  padding: 0,
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  '&:hover': { background: 'var(--surface-2)' },
})
