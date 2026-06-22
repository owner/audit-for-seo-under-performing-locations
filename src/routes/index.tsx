import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  getCurrentUser,
  doRequireAuth,
  doSignOut,
  getCounter,
  incrementCounter,
  uploadFile,
  listFiles,
} from './-index.api'

export const Route = createFileRoute('/')({
  loader: async () => {
    const user = await getCurrentUser()
    if (!user) {
      await doRequireAuth()
    }
    if (user?.restricted) {
      return { user, restricted: true as const, counter: { value: 0 }, files: { files: [] } }
    }
    const [counter, files] = await Promise.all([getCounter(), listFiles()])
    return { user: user!, restricted: false as const, counter, files }
  },
  component: IndexPage,
})

function IndexPage() {
  const { user, restricted, counter, files } = Route.useLoaderData()
  const router = useRouter()

  async function handleIncrement() {
    await incrementCounter()
    router.invalidate()
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    const buffer = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))

    await uploadFile({
      data: { name: file.name, type: file.type, base64 },
    })
    form.reset()
    router.invalidate()
  }

  async function handleSignOut() {
    const { logoutUrl } = await doSignOut()
    window.location.href = logoutUrl
  }

  if (restricted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-md">
        <h1 className="text-2xl font-bold mb-sm">Access Restricted</h1>
        <p className="text-zeus-text-secondary text-sm text-center max-w-[24rem] mb-lg">
          Your account ({user?.email}) does not have access to this app. Contact an administrator if
          you believe this is an error.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="bg-zeus-button-bg text-zeus-button-text px-lg py-sm text-sm font-medium"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[36rem] px-md py-xl">
      <header className="mb-xl flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit for SEO Under-Performing Locations</h1>
        <div className="flex items-center gap-md">
          <span className="text-sm text-zeus-text-secondary">{user.email}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-zeus-border px-sm py-xs text-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mb-xl rounded-lg border border-zeus-border p-lg">
        <h2 className="mb-md text-lg font-medium">Counter</h2>
        <div className="flex items-center gap-lg">
          <span className="text-3xl font-bold">{counter.value}</span>
          <button
            type="button"
            onClick={handleIncrement}
            className="rounded bg-zeus-button-bg px-md py-sm text-sm text-zeus-button-text hover:opacity-90"
          >
            Increment
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zeus-border p-lg">
        <h2 className="mb-md text-lg font-medium">File Upload</h2>
        <form onSubmit={handleUpload} className="mb-lg flex items-center gap-md">
          <input type="file" name="file" className="text-sm" />
          <button
            type="submit"
            className="rounded bg-zeus-button-bg px-md py-sm text-sm text-zeus-button-text hover:opacity-90"
          >
            Upload
          </button>
        </form>
        {files.files.length > 0 ? (
          <ul className="space-y-sm">
            {files.files.map((file) => (
              <li
                key={file.key}
                className="flex items-center justify-between rounded border border-zeus-border px-md py-sm text-sm"
              >
                <span className="font-medium">{file.key}</span>
                <span className="text-zeus-text-secondary">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zeus-text-secondary">No files uploaded yet.</p>
        )}
      </section>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
