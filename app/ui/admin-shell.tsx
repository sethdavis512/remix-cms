import type { Handle, RemixNode } from 'remix/ui';
import { css } from 'remix/ui';

import type { ContentType } from '../data/content-types.server.ts';
import { routes } from '../routes.ts';
import { Document } from './document.tsx';
import { Icon, type IconName } from './icon.tsx';
import { RemixWordmark } from './remix-wordmark.tsx';

const FONT_STACK =
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK =
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export interface AdminShellProps {
    title?: string;
    heading: string;
    contentTypes: ContentType[];
    activeNav?:
        | 'dashboard'
        | 'types'
        | 'components'
        | 'media'
        | 'releases'
        | 'tokens'
        | 'users'
        | 'audit'
        | 'content';
    activeTypeApiId?: string;
    user?: { name: string; email: string };
    flash?: string | null;
    // Drives the flash banner color. Defaults to 'success' so existing callers
    // that pass a bare `flash` string keep their green confirmation banner.
    flashType?: 'success' | 'info' | 'danger';
    // Small uppercase label shown above the page heading (Contentful shows the
    // content type / section name here). Optional; pages that omit it are unchanged.
    eyebrow?: string;
    actions?: RemixNode;
    // Optional right rail. When provided the main area becomes a two-column
    // Contentful-style editor (content left, sticky rail right) and widens.
    aside?: RemixNode;
    children?: RemixNode;
}

// Contentful groups its left nav into labelled sections. Everything that isn't
// a content collection lives in one of these; the collections list is rendered
// separately below because it is data-driven.
const NAV_SECTIONS: {
    heading?: string;
    items: {
        key: NonNullable<AdminShellProps['activeNav']>;
        label: string;
        icon: IconName;
        href: () => string;
    }[];
}[] = [
    {
        items: [
            {
                key: 'dashboard',
                label: 'Home',
                icon: 'Dashboard',
                href: () => routes.admin.index.href()
            }
        ]
    },
    {
        heading: 'Content',
        items: [
            {
                key: 'types',
                label: 'Content model',
                icon: 'Blocks',
                href: () => routes.admin.types.index.href()
            },
            {
                key: 'components',
                label: 'Components',
                icon: 'Box',
                href: () => routes.admin.components.index.href()
            },
            {
                key: 'media',
                label: 'Media',
                icon: 'Image',
                href: () => routes.admin.media.index.href()
            },
            {
                key: 'releases',
                label: 'Releases',
                icon: 'Rocket',
                href: () => routes.admin.releases.index.href()
            }
        ]
    },
    {
        heading: 'Settings',
        items: [
            {
                key: 'tokens',
                label: 'API tokens',
                icon: 'KeyRound',
                href: () => routes.admin.tokens.index.href()
            },
            {
                key: 'users',
                label: 'Users',
                icon: 'Users',
                href: () => routes.admin.users.index.href()
            },
            {
                key: 'audit',
                label: 'Audit log',
                icon: 'ScrollText',
                href: () => routes.admin.audit.index.href()
            }
        ]
    }
];

export function AdminShell(handle: Handle<AdminShellProps>) {
    return () => {
        let {
            title,
            heading,
            contentTypes,
            activeNav,
            activeTypeApiId,
            user,
            flash,
            flashType = 'success',
            eyebrow,
            actions,
            aside,
            children
        } = handle.props;

        // Group the runtime-defined types Strapi-style: repeatable collections
        // and one-entry singles get their own sidebar sections.
        let collectionTypes = contentTypes.filter(
            (type) => type.kind === 'collection'
        );
        let singleTypes = contentTypes.filter((type) => type.kind === 'single');

        return (
            <Document title={title ?? `${heading} · Remix CMS`}>
                <div mix={themeStyle}>
                    <a href="#main-content" mix={skipLinkStyle}>
                        Skip to content
                    </a>
                    <div mix={layoutStyle}>
                        <aside mix={sidebarStyle}>
                            {/* Space switcher block: Contentful anchors the sidebar with the
                  space name + active environment. Ours shows the Remix brand and
                  a fixed 'master' environment. */}
                            <a
                                href={routes.admin.index.href()}
                                mix={spaceCardStyle}
                                aria-label="Remix CMS"
                            >
                                <RemixWordmark />
                            </a>

                            <div mix={navScrollStyle}>
                                {NAV_SECTIONS.map((section) => (
                                    <>
                                        {section.heading ? (
                                            <p mix={navHeadingStyle}>
                                                {section.heading}
                                            </p>
                                        ) : null}
                                        <nav
                                            mix={navStyle}
                                            aria-label={
                                                section.heading ?? 'Main'
                                            }
                                        >
                                            {section.items.map((item) => (
                                                <NavLink
                                                    href={item.href()}
                                                    label={item.label}
                                                    icon={item.icon}
                                                    active={
                                                        activeNav === item.key
                                                    }
                                                />
                                            ))}
                                        </nav>
                                    </>
                                ))}

                                {contentTypes.length === 0 ? (
                                    <>
                                        <p mix={navHeadingStyle}>Collections</p>
                                        <nav
                                            mix={navStyle}
                                            aria-label="Collections"
                                        >
                                            <span
                                                mix={css({
                                                    padding: '8px 12px',
                                                    fontSize: '13px',
                                                    color: 'var(--text-tertiary)'
                                                })}
                                            >
                                                No content types yet
                                            </span>
                                        </nav>
                                    </>
                                ) : null}
                                {collectionTypes.length > 0 ? (
                                    <>
                                        <p mix={navHeadingStyle}>Collections</p>
                                        <nav
                                            mix={navStyle}
                                            aria-label="Collections"
                                        >
                                            {collectionTypes.map((type) => (
                                                <NavLink
                                                    href={routes.admin.content.index.href(
                                                        { type: type.apiId }
                                                    )}
                                                    label={type.name}
                                                    icon="Folder"
                                                    active={
                                                        activeNav ===
                                                            'content' &&
                                                        activeTypeApiId ===
                                                            type.apiId
                                                    }
                                                />
                                            ))}
                                        </nav>
                                    </>
                                ) : null}
                                {singleTypes.length > 0 ? (
                                    <>
                                        <p mix={navHeadingStyle}>Singles</p>
                                        <nav mix={navStyle} aria-label="Singles">
                                            {singleTypes.map((type) => (
                                                <NavLink
                                                    href={routes.admin.content.index.href(
                                                        { type: type.apiId }
                                                    )}
                                                    label={type.name}
                                                    icon="File"
                                                    active={
                                                        activeNav ===
                                                            'content' &&
                                                        activeTypeApiId ===
                                                            type.apiId
                                                    }
                                                />
                                            ))}
                                        </nav>
                                    </>
                                ) : null}
                            </div>

                            <div mix={sidebarFooterStyle}>
                                {user ? (
                                    <div
                                        mix={css({
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '2px'
                                        })}
                                    >
                                        <span
                                            mix={css({
                                                fontSize: '13px',
                                                fontWeight: 600
                                            })}
                                        >
                                            {user.name}
                                        </span>
                                        <span
                                            mix={css({
                                                fontSize: '12px',
                                                color: 'var(--text-tertiary)'
                                            })}
                                        >
                                            {user.email}
                                        </span>
                                    </div>
                                ) : null}
                                <form
                                    method="POST"
                                    action={routes.auth.logout.href()}
                                >
                                    <button
                                        type="submit"
                                        mix={logoutButtonStyle}
                                    >
                                        <Icon name="LogOut" size={16} />
                                        Sign out
                                    </button>
                                </form>
                            </div>
                        </aside>

                        <main id="main-content" mix={mainStyle}>
                            <header mix={topbarStyle}>
                                <div
                                    mix={css({
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '3px',
                                        minWidth: 0
                                    })}
                                >
                                    {eyebrow ? (
                                        <span mix={eyebrowStyle}>
                                            {eyebrow}
                                        </span>
                                    ) : null}
                                    <h1 mix={headingStyle}>{heading}</h1>
                                </div>
                                {actions ? (
                                    <div
                                        mix={css({
                                            display: 'flex',
                                            gap: '10px',
                                            flexShrink: 0
                                        })}
                                    >
                                        {actions}
                                    </div>
                                ) : null}
                            </header>

                            {flash ? (
                                <div
                                    role="status"
                                    mix={flashStyles[flashType]}
                                >
                                    {flash}
                                </div>
                            ) : null}

                            {aside ? (
                                <div mix={editorLayoutStyle}>
                                    <div mix={editorMainStyle}>{children}</div>
                                    <div mix={editorAsideStyle}>{aside}</div>
                                </div>
                            ) : (
                                <div mix={contentStyle}>{children}</div>
                            )}
                        </main>
                    </div>
                </div>
            </Document>
        );
    };
}

function NavLink(
    handle: Handle<{
        href: string;
        label: string;
        icon?: IconName;
        active?: boolean;
    }>
) {
    return () => {
        let { href, label, icon, active } = handle.props;
        return (
            <a
                href={href}
                aria-current={active ? 'page' : undefined}
                mix={active ? navLinkActiveStyle : navLinkStyle}
            >
                {icon ? <Icon name={icon} size={16} /> : null}
                {label}
            </a>
        );
    };
}

// Shared button styles reused across admin pages. Primary carries the accent;
// secondary and danger stay quiet (ghost) so a row of controls has a clear
// hierarchy instead of several competing solid fills.
const buttonBase = {
    font: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '9px 15px',
    borderRadius: '7px',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    transition:
        'background-color 130ms ease, border-color 130ms ease, color 130ms ease',
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px'
    }
} as const;

export const primaryButtonStyle = css({
    ...buttonBase,
    border: '1px solid transparent',
    background: 'var(--brand)',
    color: '#fff',
    '&:hover': { background: 'var(--brand-strong)' }
});

export const secondaryButtonStyle = css({
    ...buttonBase,
    border: '1px solid var(--border-strong)',
    background: 'var(--surface-1)',
    color: 'var(--text-secondary)',
    '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' }
});

export const dangerButtonStyle = css({
    ...buttonBase,
    fontSize: '13px',
    padding: '8px 12px',
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--danger)',
    '&:hover': { background: 'var(--danger-soft)' }
});

// Solid danger fill for the final "yes, delete it" action on confirm pages,
// where the destructive choice is the page's primary action.
export const primaryDangerButtonStyle = css({
    ...buttonBase,
    border: '1px solid transparent',
    background: 'var(--danger)',
    color: '#fff',
    '&:hover': { opacity: 0.9 }
});

export const cardStyle = css({
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '22px 24px',
    boxShadow: 'var(--shadow-sm)'
});

// Accessible inline text link: brand color (>= 4.5:1 on our surfaces in both
// themes) plus an underline, so links never rely on color alone. Replaces the
// unreadable default-blue anchor on our dark surfaces.
export const linkStyle = css({
    color: 'var(--brand)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    fontWeight: 500,
    '&:hover': { color: 'var(--brand-strong)' },
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px',
        borderRadius: '2px'
    }
});

// Refined-neutral palette: cool, indigo-tinted greys carrying a single
// restrained indigo accent. Neutrals lean very slightly toward the accent hue
// so the whole surface reads as one considered system rather than flat grey.
// A three-tier text ramp (primary / secondary / tertiary) does the hierarchy
// work; --brand-soft backs quiet accent fills (active nav, focus rings).
// Exported so standalone admin-adjacent pages (login) share the same tokens
// instead of hardcoding their own palette.
export const themeStyle = css({
    '--brand': '#4c57c4',
    '--brand-strong': '#3d47a5',
    '--brand-soft': 'rgba(76, 87, 196, 0.10)',
    // ~5.4:1 on --surface-1, so the ghost danger button's 13px text passes AA
    // (the previous #d63d43 sat just under 4.5:1).
    '--danger': '#c13238',
    '--danger-soft': 'rgba(193, 50, 56, 0.11)',
    '--success': '#2e9e63',
    '--success-soft': 'rgba(46, 158, 99, 0.13)',
    '--surface-0': '#eceef4',
    '--surface-1': '#fcfcfe',
    '--surface-2': '#e6e8f1',
    '--surface-input': '#ffffff',
    '--border': '#dadde8',
    '--border-strong': '#c5c9d8',
    '--text-primary': '#1b1e28',
    '--text-secondary': '#525a6b',
    '--text-tertiary': '#888fa0',
    '--shadow-sm': '0 1px 2px rgba(20, 22, 34, 0.05)',
    '--shadow-md': '0 4px 16px -8px rgba(20, 22, 34, 0.14)',
    '@media (prefers-color-scheme: dark)': {
        '--brand': '#8b93f2',
        '--brand-strong': '#a6acf7',
        '--brand-soft': 'rgba(139, 147, 242, 0.14)',
        '--danger': '#ff6369',
        '--danger-soft': 'rgba(255, 99, 105, 0.15)',
        '--success': '#40c97f',
        '--success-soft': 'rgba(64, 201, 127, 0.14)',
        '--surface-0': '#101219',
        '--surface-1': '#181b23',
        '--surface-2': '#232734',
        '--surface-input': '#101219',
        '--border': '#2a2e3a',
        '--border-strong': '#3a3f4d',
        '--text-primary': '#e6e8ef',
        '--text-secondary': '#a2a9b7',
        '--text-tertiary': '#6f7686',
        '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
        '--shadow-md': '0 6px 20px -10px rgba(0, 0, 0, 0.5)'
    },
    '& *, & *::before, & *::after': { boxSizing: 'border-box' },
    minHeight: '100vh',
    background: 'var(--surface-0)',
    color: 'var(--text-primary)',
    fontFamily: FONT_STACK,
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale'
});

// Visually hidden until focused: the first tab stop jumps keyboard users past
// the whole sidebar straight to the page content.
const skipLinkStyle = css({
    position: 'absolute',
    left: '-9999px',
    zIndex: 20,
    padding: '10px 16px',
    borderRadius: '0 0 8px 0',
    background: 'var(--brand)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    textDecoration: 'none',
    '&:focus': { left: 0, top: 0 }
});

const layoutStyle = css({
    display: 'grid',
    gridTemplateColumns: '248px 1fr',
    minHeight: '100vh',
    '@media (max-width: 720px)': { gridTemplateColumns: '1fr' }
});

const sidebarStyle = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '18px 14px',
    borderRight: '1px solid var(--border)',
    background: 'var(--surface-1)',
    '@media (min-width: 721px)': { position: 'sticky', top: 0, height: '100vh' }
});

// Space switcher card: bordered block holding the brand + environment, the way
// Contentful frames the active space at the top of its sidebar.
const spaceCardStyle = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: '0 4px 8px',
    padding: '12px',
    borderRadius: '9px',
    color: 'var(--text-primary)',
    textDecoration: 'none',
    '&:hover': { borderColor: 'var(--border-strong)' },
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px'
    }
});

const envLabelStyle = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11.5px',
    fontWeight: 600,
    color: 'var(--text-tertiary)'
});

const envDotStyle = css({
    width: '7px',
    height: '7px',
    borderRadius: '999px',
    background: 'var(--success)'
});

// The nav region scrolls independently between the pinned space card and the
// pinned user/footer, so long collection lists never push those off-screen.
const navScrollStyle = css({
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
});

const navStyle = css({ display: 'flex', flexDirection: 'column', gap: '1px' });

const navHeadingStyle = css({
    margin: '18px 0 6px',
    padding: '0 12px',
    fontSize: '10.5px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: 'var(--text-tertiary)'
});

const navLinkBase = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '7px',
    fontSize: '13.5px',
    textDecoration: 'none',
    transition: 'background-color 120ms ease, color 120ms ease',
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '-2px'
    }
} as const;

const navLinkStyle = css({
    ...navLinkBase,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' }
});

// Active item: a uniformly filled accent pill. No one-sided rule or border —
// the fill plus brand-colored, heavier text carries the active state.
const navLinkActiveStyle = css({
    ...navLinkBase,
    fontWeight: 600,
    color: 'var(--brand)',
    background: 'var(--brand-soft)'
});

const sidebarFooterStyle = css({
    marginTop: 'auto',
    paddingTop: '16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingLeft: '2px',
    paddingRight: '2px'
});

const logoutButtonStyle = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    font: 'inherit',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '8px 12px',
    width: '100%',
    borderRadius: '7px',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    transition: 'background-color 130ms ease, color 130ms ease',
    '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
    '&:focus-visible': {
        outline: '2px solid var(--brand)',
        outlineOffset: '2px'
    }
});

const mainStyle = css({
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0
});

const topbarStyle = css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '18px 32px',
    borderBottom: '1px solid var(--border)',
    background: 'color-mix(in srgb, var(--surface-1) 82%, transparent)',
    backdropFilter: 'saturate(1.4) blur(8px)',
    position: 'sticky',
    top: 0,
    zIndex: 5
});

const headingStyle = css({
    margin: 0,
    fontSize: '19px',
    fontWeight: 650,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)'
});

// Flash banners share a shape but signal outcome through color: green for
// success, blue for neutral info (e.g. unpublished), red for destructive
// outcomes (e.g. deleted) and errors.
const flashBaseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '20px 32px 0',
    padding: '11px 16px',
    borderRadius: '9px',
    fontSize: '13.5px',
    fontWeight: 500
} as const;

const flashStyles = {
    success: css({
        ...flashBaseStyle,
        color: 'var(--success)',
        background: 'var(--success-soft)',
        border: '1px solid color-mix(in srgb, var(--success) 32%, transparent)'
    }),
    info: css({
        ...flashBaseStyle,
        color: 'var(--brand-strong)',
        background: 'var(--brand-soft)',
        border: '1px solid color-mix(in srgb, var(--brand) 32%, transparent)'
    }),
    danger: css({
        ...flashBaseStyle,
        color: 'var(--danger)',
        background: 'var(--danger-soft)',
        border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)'
    })
};

const contentStyle = css({ padding: '28px 32px 48px', maxWidth: '1000px' });

const eyebrowStyle = css({
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-tertiary)'
});

// Two-column editor: a wide content column plus a fixed-width rail that sticks
// below the topbar as the fields scroll. Collapses to a single column on narrow
// viewports so the rail drops beneath the content.
const editorLayoutStyle = css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    alignItems: 'start',
    gap: '24px',
    padding: '28px 32px 48px',
    '@media (max-width: 980px)': { gridTemplateColumns: '1fr' }
});

const editorMainStyle = css({ minWidth: 0 });

const editorAsideStyle = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    '@media (min-width: 981px)': { position: 'sticky', top: '90px' }
});
