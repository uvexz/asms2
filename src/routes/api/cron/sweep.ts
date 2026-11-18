import { createFileRoute } from '@tanstack/react-router'

import { safeEqual } from '#/server/crypto/secret-box'
import { sweep } from '#/server/jobs/sweep'

export const Route = createFileRoute('/api/cron/sweep')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET ?? ''
        const header = request.headers.get('authorization') ?? ''
        const token = header.replace(/^Bearer\s+/i, '')
        if (!secret || !safeEqual(token, secret)) {
          return new Response('unauthorized', { status: 401 })
        }

        const stats = await sweep()
        return Response.json({ ok: true, stats })
      },
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET ?? ''
        const header = request.headers.get('authorization') ?? ''
        const token = header.replace(/^Bearer\s+/i, '')
        if (!secret || !safeEqual(token, secret)) {
          return new Response('unauthorized', { status: 401 })
        }
        const stats = await sweep()
        return Response.json({ ok: true, stats })
      },
    },
  },
})
