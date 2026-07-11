import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { createAppRouter } from './app/router.ts'
import { db } from './app/data/db.ts'
import { runScheduledWork } from './app/data/scheduler.server.ts'
import { createAppSessionStorage } from './app/middleware/session.ts'

const router = createAppRouter({
  database: db,
  sessionStorage: createAppSessionStorage(),
  dev: process.env.NODE_ENV === 'development',
})

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100

const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await router.fetch(request)
    } catch (error) {
      if (!(request.signal.aborted && error === request.signal.reason)) {
        console.error(error)
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  }),
)

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})

// Run scheduled work (due releases plus per-entry publish/unpublish timers)
// even when no requests arrive. The public API also checks lazily on read, so
// this timer is a backstop, not the only path.
async function tickScheduledWork() {
  try {
    let result = await runScheduledWork(db)
    for (let release of result.releases) {
      console.log(`Published scheduled release "${release.name}" (#${release.id})`)
    }
    for (let entry of result.publishedEntries) {
      console.log(`Published scheduled entry #${entry.id}`)
    }
    for (let entry of result.unpublishedEntries) {
      console.log(`Unpublished scheduled entry #${entry.id}`)
    }
  } catch (error) {
    console.error('Failed to run scheduled work', error)
  }
}

tickScheduledWork()
setInterval(tickScheduledWork, 60_000).unref()

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
