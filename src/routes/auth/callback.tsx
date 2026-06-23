import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const handleCallback = createServerFn({ method: 'GET' })
  .validator((data: { token: string; refresh?: string }) => data)
  .handler(async ({ data }) => {
    const mod = await import('cloudflare:workers')
    const env = mod.env as unknown as Env
    const isProduction = env.ENVIRONMENT === 'production'
    const jwksUrl = 'https://zeus-api-production.owner.sh/.well-known/jwks.json'

    const JWKS = createRemoteJWKSet(new URL(jwksUrl))

    const { payload } = await jwtVerify(data.token, JWKS, {
      issuer: 'zeus-backend',
      algorithms: ['ES256'],
    })

    const maxAge = Math.max(0, (payload.exp ?? 0) - Math.floor(Date.now() / 1000))
    const secure = isProduction

    // Subdomain-scoped access token
    setCookie('__zeus_app_session', data.token, {
      path: '/',
      maxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure,
    })

    // Legacy root-domain cookie for backward compatibility
    setCookie('__zeus_session', data.token, {
      path: '/',
      maxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure,
    })

    // Refresh token cookie if provided
    if (data.refresh) {
      setCookie('__zeus_app_refresh', data.refresh, {
        path: '/',
        maxAge: 90 * 24 * 60 * 60,
        httpOnly: true,
        sameSite: 'lax',
        secure,
      })
    }

    return { success: true }
  })

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    __zeus_token: (search['__zeus_token'] as string) || '',
    __zeus_refresh: (search['__zeus_refresh'] as string) || '',
  }),
  loaderDeps: ({ search }) => ({ token: search.__zeus_token, refresh: search.__zeus_refresh }),
  loader: async ({ deps }) => {
    if (!deps.token) {
      throw redirect({ to: '/' })
    }
    try {
      await handleCallback({ data: { token: deps.token, refresh: deps.refresh || undefined } })
    } catch {
      // Invalid token, redirect to home
    }
    throw redirect({ to: '/' })
  },
  component: () => <div>Redirecting...</div>,
})
