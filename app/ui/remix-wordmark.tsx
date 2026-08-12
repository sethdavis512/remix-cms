import type { Handle } from 'remix/ui';
import { css } from 'remix/ui';

// The Remix wordmark (from api.remix.run/remix-wordmark-dark-mode.svg) lives
// in public/remix-wordmark.svg and is served by the staticFiles middleware.
// Remix v3 has no bundler asset pipeline, so instead of importing the SVG as
// a module it is applied as a CSS mask over a currentColor background — that
// keeps the mark following the surrounding text color in both themes, which
// an <img> could not do.
const WORDMARK_URL = '/remix-wordmark.svg';

const wordmarkStyle = css({
    display: 'inline-block',
    width: '132px',
    height: '13px',
    backgroundColor: 'currentColor',
    maskImage: `url(${WORDMARK_URL})`,
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    maskPosition: 'center',
    WebkitMaskImage: `url(${WORDMARK_URL})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    WebkitMaskPosition: 'center'
});

export function RemixWordmark(_handle: Handle) {
    return () => <span mix={wordmarkStyle} aria-hidden="true" />;
}
