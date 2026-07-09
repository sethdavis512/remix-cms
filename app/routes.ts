import { get, post, route } from 'remix/routes'

// The typed URL contract for the whole app. Everything else (links, redirects,
// tests) generates URLs from this via `routes.<name>.href(...)`.
export const routes = route({
  assets: get('/assets/*path'),
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
      destroy: post('/content-types/:typeId/delete'),
    },

    // Content Manager (entries), scoped by content type api id (:type)
    content: {
      index: get('/content/:type'),
      newForm: get('/content/:type/new'),
      create: post('/content/:type'),
      editForm: get('/content/:type/:entryId'),
      update: post('/content/:type/:entryId'),
      destroy: post('/content/:type/:entryId/delete'),
      publish: post('/content/:type/:entryId/publish'),
    },
  }),

  // Public headless read API
  api: route('api', {
    list: get('/:type'),
    show: get('/:type/:id'),
  }),
})
