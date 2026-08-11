import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts'
import { listContentTypes, type ContentType } from '#app/data/content-types.server.ts'
import {
  createAsset,
  deleteAsset,
  findAsset,
  isAssetInUse,
  listAssets,
  assetUrlPath,
  type Asset,
} from '#app/data/assets.server.ts'
import { logAudit } from '#app/data/audit.server.ts'
import { MediaLightbox } from '#app/assets/media-lightbox.tsx'
import { MediaUploader } from '#app/assets/media-uploader.tsx'
import { routes } from '#app/routes.ts'
import { AdminShell, dangerButtonStyle } from '#app/ui/admin-shell.tsx'
import { ConfirmDeleteCard, EmptyState } from '#app/ui/primitives.tsx'
import { Pagination } from '#app/ui/pagination.tsx'
import { paginateList, pageHref } from '#app/utils/pagination.ts'
import { flashMessage, readFlash, type FlashType } from '#app/utils/flash.ts'

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
      let flash = readFlash(session)
      let { pagination, items } = paginateList(
        await listAssets(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <MediaPage
          assets={items}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={flash.message}
          flashType={flash.type}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      // The drop-zone uploader posts each file over fetch with an
      // `Accept: application/json` header and wants the created asset back so it
      // can render a preview and a jump-to link. A plain no-JS form submit gets
      // the classic flash-and-redirect instead.
      let wantsJson = (context.request.headers.get('accept') ?? '').includes('application/json')
      let file = context.get(FormData)!.get('file')

      if (!(file instanceof File) || file.size === 0) {
        if (wantsJson) {
          return Response.json({ ok: false, error: 'Choose a file to upload.' }, { status: 400 })
        }
        flashMessage(session, 'Choose a file to upload.', 'danger')
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

      if (wantsJson) {
        return Response.json(
          {
            ok: true,
            asset: {
              id: asset.id,
              filename: asset.filename,
              mimeType: asset.mimeType,
              size: asset.size,
              url: assetUrlPath(asset),
            },
          },
          { status: 201 },
        )
      }

      flashMessage(session, `Uploaded "${asset.filename}".`)
      return redirect(routes.admin.media.index.href(), 303)
    },

    // Interstitial confirm page: deleting an asset removes the stored file, so
    // it is never one click. In-use assets show the block reason here too.
    async confirmDestroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.assetId)
      let asset = Number.isInteger(id) ? await findAsset(db, id) : null
      if (!asset) return redirect(routes.admin.media.index.href(), 303)

      return context.render(
        <ConfirmDeleteAssetPage
          asset={asset}
          inUse={await isAssetInUse(db, asset.id)}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
        />,
      )
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.assetId)
      let asset = Number.isInteger(id) ? await findAsset(db, id) : null

      if (asset) {
        if (await isAssetInUse(db, asset.id)) {
          flashMessage(
            session,
            `Cannot delete "${asset.filename}": it is still referenced by one or more entries.`,
            'danger',
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
          flashMessage(session, `Deleted "${asset.filename}".`, 'danger')
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
  flashType?: FlashType
  page: number
  totalPages: number
  total: number
}

function MediaPage(handle: Handle<MediaPageProps>) {
  return () => {
    let { assets, contentTypes, user, flash, flashType, page, totalPages, total } = handle.props

    return (
      <AdminShell
        heading="Media Library"
        activeNav="media"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '24px' })}>
          <MediaUploader
            action={routes.admin.media.create.href()}
            indexHref={routes.admin.media.index.href()}
          />

          {assets.length > 0 ? (
            <div mix={libraryHeadStyle}>
              <h2 mix={css({ margin: 0, fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)' })}>
                In your library
              </h2>
            </div>
          ) : null}

          {assets.length === 0 ? (
            <EmptyState>No files yet. Upload one to get started.</EmptyState>
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
                      <a
                        href={routes.admin.media.confirmDestroy.href({
                          assetId: String(asset.id),
                        })}
                        mix={dangerButtonStyle}
                      >
                        Delete
                      </a>
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

function ConfirmDeleteAssetPage(
  handle: Handle<{
    asset: Asset
    inUse: boolean
    contentTypes: ContentType[]
    user?: AuthUser
  }>,
) {
  return () => {
    let { asset, inUse, contentTypes, user } = handle.props
    return (
      <AdminShell heading="Delete file" activeNav="media" contentTypes={contentTypes} user={user}>
        <ConfirmDeleteCard
          title={`Delete "${asset.filename}"?`}
          warning={
            inUse
              ? 'This file is still referenced by one or more entries, so deleting it will be blocked. Remove it from those entries first.'
              : null
          }
          confirmLabel="Delete file"
          actionHref={routes.admin.media.destroy.href({ assetId: String(asset.id) })}
          cancelHref={routes.admin.media.index.href()}
        >
          This permanently deletes the file ({asset.mimeType} · {formatSize(asset.size)}) from
          the media library and from disk. This cannot be undone.
        </ConfirmDeleteCard>
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

const libraryHeadStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '-8px',
})

const tileStyle = css({
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  overflow: 'hidden',
  background: 'var(--surface-1)',
  boxShadow: 'var(--shadow-sm)',
  transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: 'var(--shadow-md)',
    borderColor: 'var(--border-strong)',
  },
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
