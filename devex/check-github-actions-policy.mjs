import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const workflowsDir = '.github/workflows'
const minAgeDays = Number(process.env.MIN_ACTION_RELEASE_AGE_DAYS ?? 7)
const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000
const now = new Date(process.env.ACTION_POLICY_NOW ?? Date.now())
const token = process.env.GITHUB_TOKEN
const failures = []
const cache = new Map()

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'generated-app-github-actions-policy',
}

if (token) {
  headers.Authorization = 'Bearer ' + token
}

async function github(pathname) {
  const response = await fetch('https://api.github.com' + pathname, { headers })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(pathname + ' failed with ' + response.status + ': ' + (await response.text()))
  }
  return response.json()
}

function parseUses(line) {
  const match = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?(?:\s+#\s*(.*))?$/)
  if (!match) return null

  const spec = match[1]
  if (spec.startsWith('./') || spec.startsWith('docker://')) return null

  const atIndex = spec.lastIndexOf('@')
  if (atIndex === -1) return { spec, ref: null, tag: null }

  const repoPath = spec.slice(0, atIndex)
  const ref = spec.slice(atIndex + 1)
  const parts = repoPath.split('/')
  if (parts.length < 2) return { spec, ref, tag: null }

  const tag = match[2]?.match(/\btag:\s*([^\s]+)/)?.[1] ?? null
  return { spec, owner: parts[0], repo: parts[1], ref, tag }
}

async function resolveTag(owner, repo, tag) {
  const key = owner + '/' + repo + '@' + tag
  const cached = cache.get(key)
  if (cached) return cached

  const encodedTag = tag.split('/').map(encodeURIComponent).join('/')
  const ref = await github('/repos/' + owner + '/' + repo + '/git/ref/tags/' + encodedTag)
  if (!ref) throw new Error(owner + '/' + repo + '@' + tag + ' does not exist')

  let sha = ref.object.sha
  let tagDate = null
  if (ref.object.type === 'tag') {
    const tagObject = await github('/repos/' + owner + '/' + repo + '/git/tags/' + sha)
    sha = tagObject.object.sha
    tagDate = tagObject.tagger?.date ?? null
  }

  const release = await github('/repos/' + owner + '/' + repo + '/releases/tags/' + encodedTag)
  const commit = await github('/repos/' + owner + '/' + repo + '/commits/' + sha)
  const releaseDate = release?.published_at ?? tagDate ?? commit?.commit?.committer?.date
  if (!releaseDate)
    throw new Error(owner + '/' + repo + '@' + tag + ' has no release, tag, or commit date')

  const result = { sha, releaseDate }
  cache.set(key, result)
  return result
}

async function workflowFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await workflowFiles(entryPath)))
    } else if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

for (const file of await workflowFiles(workflowsDir)) {
  const content = await readFile(file, 'utf8')
  const lines = content.split('\n')

  for (const [index, line] of lines.entries()) {
    const usage = parseUses(line)
    if (!usage) continue

    const location = file + ':' + (index + 1)
    if (!usage.ref) {
      failures.push(location + ' ' + usage.spec + ' is missing an @ref')
      continue
    }
    if (!/^[a-f0-9]{40}$/i.test(usage.ref)) {
      failures.push(
        location + ' ' + usage.spec + ' must be pinned to a full 40-character commit SHA',
      )
      continue
    }
    if (!usage.tag) {
      failures.push(location + ' must include a same-line "# tag: <release-tag>" comment')
      continue
    }

    try {
      const resolved = await resolveTag(usage.owner, usage.repo, usage.tag)
      if (resolved.sha.toLowerCase() !== usage.ref.toLowerCase()) {
        failures.push(
          location +
            ' ' +
            usage.owner +
            '/' +
            usage.repo +
            '@' +
            usage.tag +
            ' resolves to ' +
            resolved.sha +
            ', not ' +
            usage.ref,
        )
      }

      const releaseDate = new Date(resolved.releaseDate)
      if (now.getTime() - releaseDate.getTime() < minAgeMs) {
        failures.push(
          location +
            ' ' +
            usage.owner +
            '/' +
            usage.repo +
            '@' +
            usage.tag +
            ' is too new: ' +
            resolved.releaseDate +
            '; require at least ' +
            minAgeDays +
            ' days',
        )
      }
    } catch (error) {
      failures.push(location + ' ' + error.message)
    }
  }
}

if (failures.length > 0) {
  console.error('GitHub Actions policy check failed:')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log(
  'GitHub Actions policy check passed. All external actions are pinned and at least ' +
    minAgeDays +
    ' days old.',
)
