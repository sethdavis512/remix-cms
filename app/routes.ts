import { get, post, route } from 'remix/routes'

// The typed URL contract for the whole app. Everything else (links, redirects,
// tests) generates URLs from this via `routes.<name>.href(...)`.
export const routes = route({
  assets: get('/assets/*path'),
  // Public serving route for uploaded media. Lookup is by :id; :filename is
  // cosmetic (the original name, for nicer URLs) and never used to read disk.
  uploads: get('/uploads/:id/:filename'),
  home: '/',

  auth: route('auth', {
    loginForm: get('/login'),
    login: post('/login'),
    logout: post('/logout'),
  }),

  admin: route('admin', {
    index: get('/'),

    // Content-Type Builder
    types: {
      index: get('/content-types'),
      newForm: get('/content-types/new'),
      create: post('/content-types'),
      editForm: get('/content-types/:typeId'),
      update: post('/content-types/:typeId'),
      confirmDestroy: get('/content-types/:typeId/delete'),
      destroy: post('/content-types/:typeId/delete'),
    },

    // Component builder: reusable field groups embedded by content types
    components: {
      index: get('/components'),
      newForm: get('/components/new'),
      create: post('/components'),
      editForm: get('/components/:componentId'),
      update: post('/components/:componentId'),
      destroy: post('/components/:componentId/delete'),
    },

    // API tokens: bearer auth for the public read API. While no tokens exist
    // the API stays fully public.
    tokens: {
      index: get('/tokens'),
      create: post('/tokens'),
      setRequire: post('/tokens/require'),
      destroy: post('/tokens/:tokenId/delete'),
    },

    // User management: invite admins and reset passwords. There is no SMTP;
    // generated temp passwords are shown once to the acting admin.
    users: {
      index: get('/users'),
      create: post('/users'),
      resetPassword: post('/users/:userId/reset-password'),
      destroy: post('/users/:userId/delete'),
    },

    // Content releases: grouped publish/unpublish actions that fire together,
    // on a schedule or manually
    releases: {
      index: get('/releases'),
      create: post('/releases'),
      show: get('/releases/:releaseId'),
      update: post('/releases/:releaseId'),
      destroy: post('/releases/:releaseId/delete'),
      publish: post('/releases/:releaseId/publish'),
      // Static path: the target release comes from the form body (release_id)
      // because the entry page picks it with a <select>.
      addItem: post('/releases/items/add'),
      removeItem: post('/releases/:releaseId/items/:itemId/delete'),
    },

    // Audit log: read-only record of every admin mutation
    audit: {
      index: get('/audit'),
    },

    // Media Library: upload, list, and delete assets referenced by media fields
    media: {
      index: get('/media'),
      create: post('/media'),
      destroy: post('/media/:assetId/delete'),
    },

    // Content Manager (entries), scoped by content type api id (:type)
    content: {
      index: get('/content/:type'),
      newForm: get('/content/:type/new'),
      create: post('/content/:type'),
      editForm: get('/content/:type/:entryId'),
      update: post('/content/:type/:entryId'),
      confirmDestroy: get('/content/:type/:entryId/delete'),
      destroy: post('/content/:type/:entryId/delete'),
      publish: post('/content/:type/:entryId/publish'),
      // Per-entry publish_at / unpublish_at timers ("Scheduling" card on the
      // entry edit page). Blank input clears the timer.
      schedule: post('/content/:type/:entryId/schedule'),
    },
  }),

  // Public headless read API
  api: route('api', {
    list: get('/:type'),
    show: get('/:type/:id'),
  }),
})
