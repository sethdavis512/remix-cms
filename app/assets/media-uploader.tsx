import { clientEntry, css, on, ref, type Handle, type SerializableProps } from 'remix/ui'

// The Media Library drop zone. Server-renders a real multipart <form> so uploads
// work with zero JavaScript (pick a file, hit Upload, get the flash-and-redirect
// from the media controller). On hydration it enhances into a modern drag-and-
// drop surface: drop or browse for one or many files, each uploads immediately
// over fetch/XHR (with a live progress bar), a thumbnail preview appears as soon
// as bytes leave the browser, and every finished upload offers a jump-to-asset
// link plus copy-link. Enhancement is gated behind a client-only ref so the
// no-JS submit button never shows once JavaScript is running.

interface MediaUploaderProps extends SerializableProps {
  // POST target for uploads (routes.admin.media.create).
  action: string
  // Where "View in library" sends the user (routes.admin.media.index) so freshly
  // uploaded files show up in the persisted, server-rendered grid.
  indexHref: string
}

type UploadStatus = 'uploading' | 'done' | 'error'

interface UploadedAsset {
  id: number
  filename: string
  mimeType: string
  size: number
  url: string
}

interface UploadItem {
  id: number
  name: string
  size: number
  isImage: boolean
  previewUrl: string | null
  progress: number
  status: UploadStatus
  error: string | null
  asset: UploadedAsset | null
}

export const MediaUploader = clientEntry(
  import.meta.url,
  function MediaUploader(handle: Handle<MediaUploaderProps>) {
    // Setup-scope state; every mutation is followed by handle.update().
    let hydrated = false
    let dragging = false
    let items: UploadItem[] = []
    let nextId = 1
    let fileInput: HTMLInputElement | null = null

    function markHydrated() {
      if (hydrated) return
      hydrated = true
      handle.update()
    }

    function addFiles(files: FileList | File[]) {
      let list = Array.from(files)
      if (list.length === 0) return
      for (let file of list) startUpload(file)
      handle.update()
    }

    function startUpload(file: File) {
      let isImage = file.type.startsWith('image/')
      let item: UploadItem = {
        id: nextId++,
        name: file.name,
        size: file.size,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'uploading',
        error: null,
        asset: null,
      }
      items = [item, ...items]

      let body = new FormData()
      body.append('file', file)

      let xhr = new XMLHttpRequest()
      xhr.open('POST', handle.props.action)
      xhr.setRequestHeader('Accept', 'application/json')

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        item.progress = event.loaded / event.total
        handle.update()
      }

      xhr.onload = () => {
        let payload: { ok?: boolean; asset?: UploadedAsset; error?: string } = {}
        try {
          payload = JSON.parse(xhr.responseText)
        } catch {
          payload = {}
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload.ok && payload.asset) {
          item.status = 'done'
          item.progress = 1
          item.asset = payload.asset
        } else {
          item.status = 'error'
          item.error = payload.error ?? `Upload failed (${xhr.status})`
        }
        handle.update()
      }

      xhr.onerror = () => {
        item.status = 'error'
        item.error = 'Network error during upload.'
        handle.update()
      }

      xhr.send(body)
    }

    function dismiss(id: number) {
      let item = items.find((entry) => entry.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      items = items.filter((entry) => entry.id !== id)
      handle.update()
    }

    return () => {
      let { action, indexHref } = handle.props
      let doneCount = items.filter((item) => item.status === 'done').length

      return (
        <div mix={[rootStyle, ref(() => markHydrated())]}>
          <form
            method="POST"
            action={action}
            enctype="multipart/form-data"
            mix={[
              formStyle,
              on<HTMLFormElement>('submit', (event) => {
                // With JS, files upload on selection/drop; keep the button from
                // doing a full-page multipart POST. Without JS this handler never
                // runs and the native submit works normally.
                if (hydrated) event.preventDefault()
                if (fileInput?.files?.length) addFiles(fileInput.files)
              }),
            ]}
          >
            <label
              mix={[
                zoneStyle,
                dragging ? zoneActiveStyle : null,
                on<HTMLLabelElement>('dragover', (event) => {
                  event.preventDefault()
                  if (dragging) return
                  dragging = true
                  handle.update()
                }),
                on<HTMLLabelElement>('dragleave', (event) => {
                  event.preventDefault()
                  dragging = false
                  handle.update()
                }),
                on<HTMLLabelElement>('drop', (event) => {
                  event.preventDefault()
                  dragging = false
                  let dropped = (event as DragEvent).dataTransfer?.files
                  if (dropped && dropped.length) addFiles(dropped)
                  else handle.update()
                }),
              ]}
            >
              <input
                type="file"
                name="file"
                accept="image/*,application/pdf"
                multiple
                mix={[
                  fileInputStyle,
                  ref((node: Element) => {
                    fileInput = node as HTMLInputElement
                  }),
                  on<HTMLInputElement>('change', (event) => {
                    let picked = (event.currentTarget as HTMLInputElement).files
                    if (picked && picked.length) addFiles(picked)
                  }),
                ]}
              />

              <span mix={iconRingStyle} aria-hidden="true">
                <UploadGlyph />
              </span>
              <span mix={zoneTitleStyle}>Drop files to upload</span>
              <span mix={zoneHintStyle}>
                or <span mix={zoneLinkStyle}>browse</span> — images and PDFs
              </span>

              {hydrated ? null : (
                <span mix={noJsHintStyle}>Choose a file, then press Upload.</span>
              )}
            </label>

            {hydrated ? null : (
              <div mix={fallbackBarStyle}>
                <button type="submit" mix={fallbackButtonStyle}>
                  Upload
                </button>
              </div>
            )}
          </form>

          {items.length > 0 ? (
            <div mix={panelStyle}>
              <div mix={panelHeadStyle}>
                <span mix={panelTitleStyle}>
                  {doneCount === items.length
                    ? `${items.length} uploaded`
                    : `Uploading ${items.length - doneCount} of ${items.length}`}
                </span>
                {doneCount > 0 ? (
                  <a href={indexHref} mix={panelLinkStyle}>
                    View in library →
                  </a>
                ) : null}
              </div>

              <div mix={itemsGridStyle}>
                {items.map((item) => (
                  <UploadCard item={item} onDismiss={() => dismiss(item.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )
    }
  },
)

// A single upload tile: thumbnail, name/size, and a footer that swaps between a
// progress bar (uploading), a jump-to + copy row (done), or an error message.
function UploadCard(
  handle: Handle<{ item: UploadItem; onDismiss: () => void }>,
) {
  let copied = false

  return () => {
    let { item, onDismiss } = handle.props
    let pct = Math.round(item.progress * 100)

    return (
      <div mix={cardStyle}>
        <button
          type="button"
          aria-label={`Remove ${item.name}`}
          title="Remove"
          mix={[cardDismissStyle, on<HTMLButtonElement>('click', () => onDismiss())]}
        >
          ✕
        </button>

        <div mix={thumbStyle}>
          {item.previewUrl ? (
            <img src={item.previewUrl} alt={item.name} mix={thumbImageStyle} />
          ) : (
            <span mix={thumbFallbackStyle}>{fileKind(item.name, item.isImage)}</span>
          )}
          {item.status === 'done' ? <span mix={badgeStyle}>✓</span> : null}
        </div>

        <div mix={cardBodyStyle}>
          <span mix={cardNameStyle} title={item.name}>
            {item.name}
          </span>
          <span mix={cardMetaStyle}>{formatSize(item.size)}</span>

          {item.status === 'uploading' ? (
            <div mix={trackStyle}>
              <div mix={fillStyle} style={{ width: `${pct}%` }} />
            </div>
          ) : null}

          {item.status === 'error' ? (
            <span mix={errorTextStyle}>{item.error}</span>
          ) : null}

          {item.status === 'done' && item.asset ? (
            <div mix={actionsRowStyle}>
              <a
                href={item.asset.url}
                target="_blank"
                rel="noreferrer"
                mix={jumpButtonStyle}
              >
                Jump to asset →
              </a>
              <button
                type="button"
                mix={[
                  copyButtonStyle,
                  on<HTMLButtonElement>('click', async (_event, signal) => {
                    let url = new URL(item.asset!.url, window.location.origin).href
                    try {
                      await navigator.clipboard.writeText(url)
                    } catch {
                      return
                    }
                    copied = true
                    await handle.update()
                    await wait(1400)
                    if (signal.aborted) return
                    copied = false
                    await handle.update()
                  }),
                ]}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }
}

function UploadGlyph(_handle: Handle) {
  return () => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  )
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileKind(name: string, isImage: boolean): string {
  if (isImage) return 'IMG'
  let ext = name.split('.').pop()
  return ext && ext !== name ? ext.toUpperCase().slice(0, 4) : 'FILE'
}

// ----- Styles -----

const rootStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
})

const formStyle = css({ margin: 0 })

const zoneStyle = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minHeight: '184px',
  padding: '28px 24px',
  textAlign: 'center',
  cursor: 'pointer',
  borderRadius: '16px',
  border: '1.5px dashed var(--border-strong)',
  background:
    'radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--brand-soft) 60%, transparent) 0%, transparent 60%), var(--surface-1)',
  color: 'var(--text-secondary)',
  transition: 'border-color 150ms ease, background 150ms ease, transform 150ms ease',
  '&:hover': {
    borderColor: 'var(--brand)',
    color: 'var(--text-primary)',
  },
})

const zoneActiveStyle = css({
  borderColor: 'var(--brand)',
  borderStyle: 'solid',
  transform: 'scale(1.006)',
  background:
    'radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--brand-soft) 120%, transparent) 0%, transparent 65%), var(--surface-1)',
  color: 'var(--text-primary)',
})

// Visually hidden but still focusable/clickable through the wrapping <label>,
// and still a real form control for the no-JS submit path.
const fileInputStyle = css({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
})

const iconRingStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '46px',
  height: '46px',
  borderRadius: '13px',
  color: 'var(--brand)',
  background: 'var(--brand-soft)',
  border: '1px solid color-mix(in srgb, var(--brand) 22%, transparent)',
})

const zoneTitleStyle = css({
  fontSize: '15px',
  fontWeight: 650,
  color: 'var(--text-primary)',
})

const zoneHintStyle = css({ fontSize: '13px' })

const zoneLinkStyle = css({ color: 'var(--brand)', fontWeight: 600 })

const noJsHintStyle = css({
  marginTop: '4px',
  fontSize: '12px',
  color: 'var(--text-tertiary)',
})

const fallbackBarStyle = css({ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' })

const fallbackButtonStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 15px',
  borderRadius: '7px',
  border: '1px solid transparent',
  background: 'var(--brand)',
  color: '#fff',
  '&:hover': { background: 'var(--brand-strong)' },
})

const panelStyle = css({ display: 'flex', flexDirection: 'column', gap: '12px' })

const panelHeadStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
})

const panelTitleStyle = css({
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-tertiary)',
})

const panelLinkStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--brand)',
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
})

const itemsGridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '14px',
})

const cardStyle = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  overflow: 'hidden',
  boxShadow: 'var(--shadow-sm)',
})

const cardDismissStyle = css({
  position: 'absolute',
  top: '7px',
  right: '7px',
  zIndex: 2,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  padding: 0,
  fontSize: '11px',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: '6px',
  border: 'none',
  color: '#fff',
  background: 'rgba(15, 17, 25, 0.55)',
  '&:hover': { background: 'rgba(15, 17, 25, 0.78)' },
})

const thumbStyle = css({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '116px',
  background:
    'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface-1) 0% 50%) 50% / 18px 18px',
  overflow: 'hidden',
})

const thumbImageStyle = css({ width: '100%', height: '100%', objectFit: 'cover' })

const thumbFallbackStyle = css({
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  fontFamily: 'ui-monospace, monospace',
})

const badgeStyle = css({
  position: 'absolute',
  bottom: '8px',
  right: '8px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  fontSize: '12px',
  fontWeight: 700,
  color: '#fff',
  borderRadius: '50%',
  background: 'var(--success)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
})

const cardBodyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '11px 12px 13px',
})

const cardNameStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const cardMetaStyle = css({ fontSize: '12px', color: 'var(--text-tertiary)' })

const trackStyle = css({
  marginTop: '2px',
  height: '6px',
  borderRadius: '999px',
  background: 'var(--surface-2)',
  overflow: 'hidden',
})

const fillStyle = css({
  height: '100%',
  borderRadius: '999px',
  background: 'var(--brand)',
  transition: 'width 140ms ease',
})

const errorTextStyle = css({ fontSize: '12px', color: 'var(--danger)', fontWeight: 500 })

const actionsRowStyle = css({
  marginTop: '4px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
})

const jumpButtonStyle = css({
  fontSize: '12.5px',
  fontWeight: 600,
  color: 'var(--brand)',
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
})

const copyButtonStyle = css({
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '4px 9px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-secondary)',
  '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
})
