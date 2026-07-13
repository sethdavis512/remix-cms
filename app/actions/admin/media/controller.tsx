import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  createAsset,
  deleteAsset,
  findAsset,
  isAssetInUse,
  listAssets,
  assetUrlPath,
  type Asset,
} from '../../../data/assets.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { MediaLightbox } from '../../../assets/media-lightbox.tsx'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import { Pagination } from '../../../ui/pagination.tsx'
import { paginateList, pageHref } from '../../../utils/pagination.ts'

// The Media Library: a central page to upload files and manage the assets that
// entries reference through `media` fields. Files are stored on local disk and
// served over the public /uploads/:id/:filename route.

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

// Human-readable file size for the library table.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default createController(routes.admin.media, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      let { pagination, items } = paginateList(
        await listAssets(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <MediaPage
          assets={items}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let file = context.get(FormData)!.get('file')

      if (!(file instanceof File) || file.size === 0) {
        session.flash('message', 'Choose a file to upload.')
        return redirect(routes.admin.media.index.href(), 303)
      }

      let bytes = new Uint8Array(await file.arrayBuffer())
      let asset = await createAsset(db, {
        filename: file.name,
        mimeType: file.type,
        bytes,
        uploadedBy: currentUser(context)?.id ?? null,
      })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'asset.created',
        'asset',
        asset.id,
        `Uploaded "${asset.filename}"`,
      )
      session.flash('message', `Uploaded "${asset.filename}".`)
      return redirect(routes.admin.media.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.assetId)
      let asset = Number.isInteger(id) ? await findAsset(db, id) : null

      if (asset) {
        if (await isAssetInUse(db, asset.id)) {
          session.flash(
            'message',
            `Cannot delete "${asset.filename}": it is still referenced by one or more entries.`,
          )
        } else {
          await deleteAsset(db, asset)
          await logAudit(
            db,
            currentUser(context)?.email ?? 'system',
            'asset.deleted',
            'asset',
            asset.id,
            `Deleted "${asset.filename}"`,
          )
          session.flash('message', `Deleted "${asset.filename}".`)
        }
      }

      return redirect(routes.admin.media.index.href(), 303)
    },
  },
})

// ----- Pages -----

interface MediaPageProps {
  assets: Asset[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  page: number
  totalPages: number
  total: number
}

function MediaPage(handle: Handle<MediaPageProps>) {
  return () => {
    let { assets, contentTypes, user, flash, page, totalPages, total } = handle.props

    return (
      <AdminShell
        heading="Media Library"
        activeNav="media"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>Upload a file</h2>
            <form
              method="POST"
              action={routes.admin.media.create.href()}
              enctype="multipart/form-data"
              mix={css({ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' })}
            >
              <input type="file" name="file" mix={css({ fontSize: '14px' })} />
              <button type="submit" mix={primaryButtonStyle}>
                Upload
              </button>
            </form>
          </div>

          {assets.length === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                No files yet. Upload one to get started.
              </p>
            </div>
          ) : (
            <div mix={gridStyle}>
              {assets.map((asset) => (
                <div mix={tileStyle}>
                  <div mix={previewStyle}>
                    {isImage(asset.mimeType) ? (
                      <MediaLightbox
                        src={assetUrlPath(asset)}
                        filename={asset.filename}
                        meta={`${asset.mimeType} · ${formatSize(asset.size)}`}
                      />
                    ) : (
                      <span mix={previewFallbackStyle}>{asset.mimeType || 'file'}</span>
                    )}
                  </div>
                  <div mix={tileBodyStyle}>
                    <a href={assetUrlPath(asset)} mix={tileNameStyle} title={asset.filename}>
                      {asset.filename}
                    </a>
                    <span mix={tileMetaStyle}>
                      {asset.mimeType} · {formatSize(asset.size)}
                    </span>
                    <div mix={css({ display: 'flex', justifyContent: 'flex-end' })}>
                      <form
                        method="POST"
                        action={routes.admin.media.destroy.href({ assetId: String(asset.id) })}
                      >
                        <button type="submit" mix={dangerButtonStyle}>
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="file"
            prevHref={pageHref(routes.admin.media.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.media.index.href(), page + 1, totalPages)}
          />
        </div>
      </AdminShell>
    )
  }
}

// ----- Styles -----

const gridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '16px',
})

const tileStyle = css({
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  overflow: 'hidden',
  background: 'var(--surface-1)',
})

const previewStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '140px',
  background: 'var(--surface-2)',
  overflow: 'hidden',
})

const previewFallbackStyle = css({
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  fontFamily: 'ui-monospace, monospace',
})

const tileBodyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '12px',
})

const tileNameStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const tileMetaStyle = css({
  fontSize: '12px',
  color: 'var(--text-tertiary)',
})
