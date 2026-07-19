import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts'
import { listContentTypes, type ContentType } from '#app/data/content-types.server.ts'
import { countEntriesForType, listPublishedEntries } from '#app/data/entries.server.ts'
import { listComponents } from '#app/data/components.server.ts'
import { listAssets } from '#app/data/assets.server.ts'
import { listReleases, listOpenReleases } from '#app/data/releases.server.ts'
import { listApiTokens } from '#app/data/api-tokens.server.ts'
import { countUsers } from '#app/data/users.server.ts'
import { routes } from '#app/routes.ts'
import { AdminShell, cardStyle, primaryButtonStyle } from '#app/ui/admin-shell.tsx'
import { Icon, type IconName } from '#app/ui/icon.tsx'

interface DashboardStats {
  contentTypes: number
  entries: number
  publishedEntries: number
  components: number
  media: number
  releases: number
  openReleases: number
  apiTokens: number
  users: number
}

export default createController(routes.admin, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let contentTypes = await listContentTypes(db)
      let auth = context.get(Auth)
      let user = auth?.ok ? auth.identity : undefined

      // Counts for the stat tiles. Entry totals are summed per type (there is no
      // global entries table view); everything else has a direct list/count.
      let [components, assets, releases, openReleases, tokens, users] = await Promise.all([
        listComponents(db),
        listAssets(db),
        listReleases(db),
        listOpenReleases(db),
        listApiTokens(db),
        countUsers(db),
      ])
      let entryTotals = await Promise.all(contentTypes.map((type) => countEntriesForType(db, type.id)))
      let publishedTotals = await Promise.all(
        contentTypes.map((type) => listPublishedEntries(db, type.id).then((entries) => entries.length)),
      )
      let sum = (nums: number[]) => nums.reduce((total, n) => total + n, 0)

      let stats: DashboardStats = {
        contentTypes: contentTypes.length,
        entries: sum(entryTotals),
        publishedEntries: sum(publishedTotals),
        components: components.length,
        media: assets.length,
        releases: releases.length,
        openReleases: openReleases.length,
        apiTokens: tokens.length,
        users,
      }

      return context.render(<DashboardPage contentTypes={contentTypes} stats={stats} user={user} />)
    },
  },
})

function DashboardPage(
  handle: Handle<{ contentTypes: ContentType[]; stats: DashboardStats; user?: AuthUser }>,
) {
  return () => {
    let { contentTypes, stats, user } = handle.props

    let tiles: { icon: IconName; label: string; value: number; sub?: string; href: string }[] = [
      {
        icon: 'Blocks',
        label: 'Content types',
        value: stats.contentTypes,
        href: routes.admin.types.index.href(),
      },
      {
        icon: 'Dashboard',
        label: 'Entries',
        value: stats.entries,
        sub: `${stats.publishedEntries} published`,
        href: routes.admin.types.index.href(),
      },
      {
        icon: 'Box',
        label: 'Components',
        value: stats.components,
        href: routes.admin.components.index.href(),
      },
      { icon: 'Image', label: 'Media', value: stats.media, href: routes.admin.media.index.href() },
      {
        icon: 'Rocket',
        label: 'Releases',
        value: stats.releases,
        sub: `${stats.openReleases} open`,
        href: routes.admin.releases.index.href(),
      },
      {
        icon: 'KeyRound',
        label: 'API tokens',
        value: stats.apiTokens,
        href: routes.admin.tokens.index.href(),
      },
      { icon: 'Users', label: 'Users', value: stats.users, href: routes.admin.users.index.href() },
    ]

    return (
      <AdminShell
        heading="Dashboard"
        activeNav="dashboard"
        contentTypes={contentTypes}
        user={user}
        actions={
          <a href={routes.admin.types.newForm.href()} mix={primaryButtonStyle}>
            New content type
          </a>
        }
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '28px' })}>
          <div mix={statGridStyle}>
            {tiles.map((tile) => (
              <a href={tile.href} mix={statTileStyle}>
                <span mix={statIconStyle}>
                  <Icon name={tile.icon} size={18} />
                </span>
                <span mix={statValueStyle}>{tile.value}</span>
                <span mix={statLabelStyle}>{tile.label}</span>
                <span mix={statSubStyle}>{tile.sub ?? ' '}</span>
              </a>
            ))}
          </div>

          {contentTypes.length === 0 ? (
            <div mix={cardStyle}>
              <h2 mix={css({ margin: '0 0 8px', fontSize: '17px', fontWeight: 650, letterSpacing: '-0.01em' })}>
                Welcome to Remix CMS
              </h2>
              <p mix={css({ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, maxWidth: '52ch' })}>
                Start by defining a content type. Give it a name and some fields, then create and
                publish entries that are served over the headless API.
              </p>
              <a href={routes.admin.types.newForm.href()} mix={primaryButtonStyle}>
                Create your first content type
              </a>
            </div>
          ) : (
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '14px' })}>
              <h2 mix={sectionHeadingStyle}>Content types</h2>
              <div mix={gridStyle}>
                {contentTypes.map((type) => (
                  <a href={routes.admin.content.index.href({ type: type.apiId })} mix={typeCardStyle}>
                    <span mix={css({ fontSize: '15px', fontWeight: 650, letterSpacing: '-0.01em' })}>
                      {type.name}
                    </span>
                    <span
                      mix={css({
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '12.5px',
                        color: 'var(--brand)',
                      })}
                    >
                      /api/{type.apiIdPlural}
                    </span>
                    <span mix={css({ fontSize: '12.5px', color: 'var(--text-tertiary)' })}>
                      {type.fields.length} field{type.fields.length === 1 ? '' : 's'} · {type.kind}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </AdminShell>
    )
  }
}

const statGridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: '14px',
})

const statTileStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '18px',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  boxShadow: 'var(--shadow-sm)',
  transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
  '&:hover': {
    borderColor: 'var(--brand)',
    boxShadow: 'var(--shadow-md)',
    transform: 'translateY(-2px)',
  },
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
})

const statIconStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '34px',
  height: '34px',
  borderRadius: '9px',
  color: 'var(--brand)',
  background: 'var(--brand-soft)',
})

const statValueStyle = css({
  fontSize: '28px',
  fontWeight: 650,
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
  color: 'var(--text-primary)',
})

const statLabelStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
})

const statSubStyle = css({
  fontSize: '12px',
  color: 'var(--text-tertiary)',
})

const sectionHeadingStyle = css({
  margin: 0,
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-tertiary)',
})

const gridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '16px',
})

const typeCardStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  padding: '18px',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  boxShadow: 'var(--shadow-sm)',
  transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
  '&:hover': {
    borderColor: 'var(--brand)',
    boxShadow: 'var(--shadow-md)',
    transform: 'translateY(-2px)',
  },
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
})
