import { redirect } from '@tanstack/react-router'
import { getRequestHeader, setCookie } from '@tanstack/react-start/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'

async function getWorkerEnv() {
  const mod = await import('cloudflare:workers')
  return mod.env as unknown as Env
}

function getAuthUrls(env: Env) {
  return {
    jwksUrl: 'https://zeus-api-production.owner.sh/.well-known/jwks.json',
    portalUrl: 'https://shibboleth.owner.sh',
    appId: env.ZEUS_APP_ID as string | undefined,
  }
}

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : undefined
}

// Synthetic identity used only in local dev so screens and server functions
// that read the current user work without a real Zeus session.
const LOCAL_DEV_USER = {
  id: 'local-dev-user',
  email: 'local-dev@owner.local',
  sessionId: 'local-dev-session',
  name: 'Local Dev',
  picture: null,
  role: null,
  restricted: false,
}

// True only when the app runs locally under wrangler/vite dev.
//
// SECURITY: ENVIRONMENT is a server-side wrangler var binding. The deploy
// command always builds with --env production (ENVIRONMENT = 'production'), and
// incoming request traffic cannot influence a var binding, so a deployed app can
// never be tricked into this branch. It fails closed: only the explicit
// 'development' value bypasses auth; every other value (production, an unknown
// env, or unset) keeps full auth enforcement. Do not widen this to a
// host/header check — those are attacker-influenceable; the env var is not.
function isLocalDev(env: Env): boolean {
  return env.ENVIRONMENT === 'development'
}

export async function getAuthUser() {
  const env = await getWorkerEnv()

  if (isLocalDev(env)) return LOCAL_DEV_USER

  const cookieHeader = getRequestHeader('Cookie') ?? ''
  const token =
    parseCookie(cookieHeader, '__zeus_app_session') ?? parseCookie(cookieHeader, '__zeus_session')

  if (!token) return null

  try {
    const { jwksUrl, appId } = getAuthUrls(env)
    const JWKS = createRemoteJWKSet(new URL(jwksUrl))

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'zeus-backend',
      algorithms: ['ES256'],
    })

    if (appId && payload.aud !== appId) return null

    return {
      id: payload.sub as string,
      email: payload.email as string,
      sessionId: payload.jti as string,
      name: (payload.name as string) ?? null,
      picture: (payload.picture as string) ?? null,
      role: (payload.role as string) ?? null,
      restricted: (payload.restricted as boolean) ?? false,
    }
  } catch {
    return null
  }
}

export async function requireAuth() {
  const user = await getAuthUser()

  if (!user) {
    const env = await getWorkerEnv()
    const { portalUrl, appId } = getAuthUrls(env)
    const callbackUrl = getRequestHeader('X-Forwarded-Proto')
      ? `${getRequestHeader('X-Forwarded-Proto')}://${getRequestHeader('Host')}/auth/callback`
      : `${getRequestHeader('Origin') || 'http://localhost:3000'}/auth/callback`
    const redirectUrl = new URL(portalUrl)
    redirectUrl.searchParams.set('redirect', callbackUrl)
    if (appId) {
      redirectUrl.searchParams.set('app', appId)
    }
    throw redirect({ href: redirectUrl.toString() })
  }

  return user
}

export async function signOut() {
  const env = await getWorkerEnv()
  const secure = env.ENVIRONMENT === 'production'
  setCookie('__zeus_app_session', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure,
  })
  setCookie('__zeus_session', '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure })
  const { portalUrl } = getAuthUrls(env)
  return { logoutUrl: `${portalUrl}/logout` }
}
