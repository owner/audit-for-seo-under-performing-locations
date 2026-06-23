import { createServerFn } from '@tanstack/react-start'

async function getWorkerEnv() {
  const mod = await import('cloudflare:workers')
  return mod.env as unknown as Env
}

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAuthUser } = await import('../lib/auth.server')
  return getAuthUser()
})

export const doRequireAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
})

export const doSignOut = createServerFn({ method: 'POST' }).handler(async () => {
  const { signOut } = await import('../lib/auth.server')
  return signOut()
})

export const getCounter = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
  const env = await getWorkerEnv()
  const result = await env.DB.prepare('SELECT value FROM counter WHERE id = ?')
    .bind('global')
    .first<{ value: number }>()
  return { value: result?.value ?? 0 }
})

export const incrementCounter = createServerFn({ method: 'POST' }).handler(async () => {
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
  const env = await getWorkerEnv()
  await env.DB.prepare('UPDATE counter SET value = value + 1 WHERE id = ?').bind('global').run()
  const result = await env.DB.prepare('SELECT value FROM counter WHERE id = ?')
    .bind('global')
    .first<{ value: number }>()
  return { value: result?.value ?? 0 }
})

export const uploadFile = createServerFn({ method: 'POST' })
  .validator((data: { name: string; type: string; base64: string }) => data)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../lib/auth.server')
    await requireAuth()
    const env = await getWorkerEnv()
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))
    await env.STORAGE.put(data.name, bytes, {
      httpMetadata: { contentType: data.type },
    })
    return { success: true }
  })

export const listFiles = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
  const env = await getWorkerEnv()
  const listed = await env.STORAGE.list()
  return {
    files: listed.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded.toISOString(),
    })),
  }
})
