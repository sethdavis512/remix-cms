import { createCookie } from 'remix/cookie';
import { createFsSessionStorage } from 'remix/session-storage/fs';

// Session cookie is always signed and hardened. SESSION_SECRET is REQUIRED in
// production so we never ship a demo secret. In local dev (and tests) we fall
// back to a fixed, stable secret when it is unset — a random one would change
// on every server restart and silently log you out after each file-change
// reload. Pin SESSION_SECRET in .env to use a real secret and silence the warning.
const DEV_FALLBACK_SECRET = 'dev-insecure-stable-secret-not-for-production';
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    let isLocal =
        process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!isLocal) {
        throw new Error('SESSION_SECRET is required');
    }
    sessionSecret = DEV_FALLBACK_SECRET;
    if (process.env.NODE_ENV === 'development') {
        console.warn(
            '[session] SESSION_SECRET is not set — using an insecure, stable dev secret so local logins survive restarts. Set SESSION_SECRET in .env for a real one.'
        );
    }
}

export const sessionCookie = createCookie('__session', {
    secrets: [sessionSecret],
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/'
});

// Filesystem-backed storage for the running app. Tests use an in-memory store.
export function createAppSessionStorage() {
    return createFsSessionStorage('./tmp/sessions');
}
