import { createController } from 'remix/router';
import { Database } from 'remix/data-table';
import type { Handle } from 'remix/ui';
import { css } from 'remix/ui';

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts';
import {
    listContentTypes,
    type ContentType
} from '#app/data/content-types.server.ts';
import {
    countEntriesForType,
    listPublishedEntries
} from '#app/data/entries.server.ts';
import { listComponents } from '#app/data/components.server.ts';
import { listAuditEntries } from '#app/data/audit.server.ts';
import { listAssets } from '#app/data/assets.server.ts';
import { listReleases, listOpenReleases } from '#app/data/releases.server.ts';
import { listApiTokens } from '#app/data/api-tokens.server.ts';
import { countUsers } from '#app/data/users.server.ts';
import { routes } from '#app/routes.ts';
import {
    AdminShell,
    cardStyle,
    primaryButtonStyle
} from '#app/ui/admin-shell.tsx';
import { Icon, type IconName } from '#app/ui/icon.tsx';

interface DashboardStats {
    components: number;
    media: number;
    releases: number;
    openReleases: number;
    apiTokens: number;
    users: number;
    auditEvents: number;
}

// Per-type entry counts shown on the type cards, index-aligned with the
// contentTypes list.
interface TypeStats {
    entries: number;
    published: number;
}

export default createController(routes.admin, {
    middleware: [requireAdmin()],
    actions: {
        async index(context) {
            let db = context.get(Database)!;
            let contentTypes = await listContentTypes(db);
            let auth = context.get(Auth);
            let user = auth?.ok ? auth.identity : undefined;

            // Counts for the stat tiles; entry counts are gathered per type for
            // the type cards.
            let [
                components,
                assets,
                releases,
                openReleases,
                tokens,
                users,
                auditEntries
            ] = await Promise.all([
                listComponents(db),
                listAssets(db),
                listReleases(db),
                listOpenReleases(db),
                listApiTokens(db),
                countUsers(db),
                listAuditEntries(db)
            ]);
            let entryTotals = await Promise.all(
                contentTypes.map((type) => countEntriesForType(db, type.id))
            );
            let publishedTotals = await Promise.all(
                contentTypes.map((type) =>
                    listPublishedEntries(db, type.id).then(
                        (entries) => entries.length
                    )
                )
            );
            let typeStats: TypeStats[] = contentTypes.map((_, index) => ({
                entries: entryTotals[index],
                published: publishedTotals[index]
            }));

            let stats: DashboardStats = {
                components: components.length,
                media: assets.length,
                releases: releases.length,
                openReleases: openReleases.length,
                apiTokens: tokens.length,
                users,
                auditEvents: auditEntries.length
            };

            return context.render(
                <DashboardPage
                    contentTypes={contentTypes}
                    typeStats={typeStats}
                    stats={stats}
                    user={user}
                />
            );
        }
    }
});

function DashboardPage(
    handle: Handle<{
        contentTypes: ContentType[];
        typeStats: TypeStats[];
        stats: DashboardStats;
        user?: AuthUser;
    }>
) {
    return () => {
        let { contentTypes, typeStats, stats, user } = handle.props;

        let tiles: {
            icon: IconName;
            label: string;
            value: number;
            sub?: string;
            href: string;
        }[] = [
            {
                icon: 'Box',
                label: 'Components',
                value: stats.components,
                href: routes.admin.components.index.href()
            },
            {
                icon: 'Image',
                label: 'Media',
                value: stats.media,
                href: routes.admin.media.index.href()
            },
            {
                icon: 'Rocket',
                label: 'Releases',
                value: stats.releases,
                sub: `${stats.openReleases} open`,
                href: routes.admin.releases.index.href()
            },
            {
                icon: 'KeyRound',
                label: 'API tokens',
                value: stats.apiTokens,
                href: routes.admin.tokens.index.href()
            },
            {
                icon: 'Users',
                label: 'Users',
                value: stats.users,
                href: routes.admin.users.index.href()
            },
            {
                icon: 'ScrollText',
                label: 'Audit log',
                value: stats.auditEvents,
                href: routes.admin.audit.index.href()
            }
        ];

        return (
            <AdminShell
                heading="Dashboard"
                activeNav="dashboard"
                contentTypes={contentTypes}
                user={user}
                actions={
                    <a
                        href={routes.admin.types.newForm.href()}
                        mix={primaryButtonStyle}
                    >
                        New content type
                    </a>
                }
            >
                <div
                    mix={css({
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '28px'
                    })}
                >
                    {contentTypes.length === 0 ? (
                        <div mix={cardStyle}>
                            <h2
                                mix={css({
                                    margin: '0 0 8px',
                                    fontSize: '17px',
                                    fontWeight: 650,
                                    letterSpacing: '-0.01em'
                                })}
                            >
                                Welcome to Remix CMS
                            </h2>
                            <p
                                mix={css({
                                    margin: '0 0 18px',
                                    color: 'var(--text-secondary)',
                                    fontSize: '14px',
                                    lineHeight: 1.6,
                                    maxWidth: '52ch'
                                })}
                            >
                                Start by defining a content type. Give it a name
                                and some fields, then create and publish entries
                                that are served over the headless API.
                            </p>
                            <a
                                href={routes.admin.types.newForm.href()}
                                mix={primaryButtonStyle}
                            >
                                Create your first content type
                            </a>
                        </div>
                    ) : (
                        <div
                            mix={css({
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '14px'
                            })}
                        >
                            <h2 mix={sectionHeadingStyle}>Content types</h2>
                            <div mix={dashboardGridStyle}>
                                {contentTypes.map((type, index) => (
                                    <a
                                        href={routes.admin.content.index.href({
                                            type: type.apiId
                                        })}
                                        mix={typeCardStyle}
                                    >
                                        <span
                                            mix={css({
                                                fontSize: '15px',
                                                fontWeight: 650,
                                                letterSpacing: '-0.01em'
                                            })}
                                        >
                                            {type.name}
                                        </span>
                                        <span
                                            mix={css({
                                                fontFamily:
                                                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                                                fontSize: '12.5px',
                                                color: 'var(--brand)'
                                            })}
                                        >
                                            /api/{type.apiIdPlural}
                                        </span>
                                        <span
                                            mix={css({
                                                fontSize: '12.5px',
                                                color: 'var(--text-tertiary)'
                                            })}
                                        >
                                            {type.fields.length} field
                                            {type.fields.length === 1
                                                ? ''
                                                : 's'}{' '}
                                            · {type.kind}
                                        </span>
                                        <span
                                            mix={css({
                                                fontSize: '12.5px',
                                                color: 'var(--text-tertiary)'
                                            })}
                                        >
                                            {typeStats[index]?.entries ?? 0}{' '}
                                            entr
                                            {(typeStats[index]?.entries ??
                                                0) === 1
                                                ? 'y'
                                                : 'ies'}{' '}
                                            ·{' '}
                                            {typeStats[index]?.published ?? 0}{' '}
                                            published
                                        </span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                    <div mix={dashboardGridStyle}>
                        {tiles.map((tile) => (
                            <a href={tile.href} mix={statTileStyle}>
                                <span mix={statIconStyle}>
                                    <Icon name={tile.icon} size={18} />
                                </span>
                                <span mix={statValueStyle}>{tile.value}</span>
                                <span mix={statLabelStyle}>{tile.label}</span>
                                <span mix={statSubStyle}>
                                    {tile.sub ?? ' '}
                                </span>
                            </a>
                        ))}
                    </div>
                </div>
            </AdminShell>
        );
    };
}

// One shared grid for the dashboard sections so type cards and stat tiles sit
// on the same column tracks.
const dashboardGridStyle = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '14px'
});

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
    transition:
        'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
    '&:hover': {
        borderColor: 'var(--brand)',
        boxShadow: 'var(--shadow-md)',
        transform: 'translateY(-2px)'
    },
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px'
    }
});

const statIconStyle = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    borderRadius: '9px',
    color: 'var(--brand)',
    background: 'var(--brand-soft)'
});

const statValueStyle = css({
    fontSize: '28px',
    fontWeight: 650,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    color: 'var(--text-primary)'
});

const statLabelStyle = css({
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-secondary)'
});

const statSubStyle = css({
    fontSize: '12px',
    color: 'var(--text-tertiary)'
});

const sectionHeadingStyle = css({
    margin: 0,
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-tertiary)'
});

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
    transition:
        'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
    '&:hover': {
        borderColor: 'var(--brand)',
        boxShadow: 'var(--shadow-md)',
        transform: 'translateY(-2px)'
    },
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px'
    }
});
