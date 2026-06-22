import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { defineHandlerCallback } from '@tanstack/react-router/ssr/server'
import { createLogger, runWithLogContext } from './lib/logger'

const log = createLogger('server')

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const requestId = crypto.randomUUID().slice(0, 8)
    const start = Date.now()

    return runWithLogContext({ requestId }, async () => {
      let route = url.pathname
      let error: string | undefined
      let response: Response

      try {
        const handler = createStartHandler(
          defineHandlerCallback((ctx) => {
            const matches = ctx.router.state.matches
            const leaf = matches[matches.length - 1]
            if (leaf?.routeId) route = leaf.routeId
            if (url.pathname.startsWith('/_serverFn/')) {
              route = `/_serverFn/${url.pathname.slice('/_serverFn/'.length)}`
            }
            return defaultStreamHandler(ctx)
          }),
        )
        response = await handler(request)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        response = new Response('Internal error', { status: 500 })
      }

      const durationMs = Date.now() - start
      log.info('request', {
        message: `${request.method} ${route} → ${response.status} (${durationMs}ms)`,
        http: {
          method: request.method,
          route,
          path: url.pathname,
          status: response.status,
          durationMs,
          userAgent: request.headers.get('user-agent')?.slice(0, 200) || undefined,
          cfRay: request.headers.get('cf-ray') || undefined,
          ip: request.headers.get('cf-connecting-ip') || undefined,
        },
        error,
      })

      return response
    })
  },
}
