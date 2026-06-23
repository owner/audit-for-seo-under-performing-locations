/**
 * Snowflake SQL REST API client for Cloudflare Workers.
 * Uses key-pair JWT authentication — no external libraries needed.
 *
 * Required Worker secrets (set via Zeus run page → Integrations → Snowflake):
 *   SNOWFLAKE_ACCOUNT       e.g. "xy12345.us-east-1"
 *   SNOWFLAKE_USER          e.g. "ZEUS_APP_USER"
 *   SNOWFLAKE_PRIVATE_KEY   PEM string (PKCS#8, no header/footer, no newlines)
 *   SNOWFLAKE_PUBLIC_KEY_FP SHA-256 fingerprint, e.g. "SHA256:abc123..."
 *   SNOWFLAKE_WAREHOUSE     e.g. "COMPUTE_WH"
 *   SNOWFLAKE_ROLE          e.g. "ANALYTICS_ROLE"
 */

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer)
}

async function signJwt(
  account: string,
  user: string,
  privateKeyPem: string,
  publicKeyFp: string
): Promise<string> {
  // Import RSA private key (PKCS#8 PEM → DER)
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const acct = account.toUpperCase()
  const usr = user.toUpperCase()
  const now = Math.floor(Date.now() / 1000)

  const header = encodeJson({ alg: 'RS256', typ: 'JWT' })
  const payload = encodeJson({
    iss: `${acct}.${usr}.${publicKeyFp}`,
    sub: `${acct}.${usr}`,
    iat: now,
    exp: now + 3600,
  })

  const sigInput = new TextEncoder().encode(`${header}.${payload}`)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, sigInput)

  return `${header}.${payload}.${base64url(sig)}`
}

// ─── SQL execution ────────────────────────────────────────────────────────────

export interface SnowflakeRow {
  [col: string]: string | number | boolean | null
}

interface SnowflakeEnv {
  SNOWFLAKE_ACCOUNT: string
  SNOWFLAKE_USER: string
  SNOWFLAKE_PRIVATE_KEY: string
  SNOWFLAKE_PUBLIC_KEY_FP: string
  SNOWFLAKE_WAREHOUSE: string
  SNOWFLAKE_ROLE: string
}

export async function snowflakeQuery(env: SnowflakeEnv, sql: string): Promise<SnowflakeRow[]> {
  const jwt = await signJwt(
    env.SNOWFLAKE_ACCOUNT,
    env.SNOWFLAKE_USER,
    env.SNOWFLAKE_PRIVATE_KEY,
    env.SNOWFLAKE_PUBLIC_KEY_FP
  )

  const url = `https://${env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/statements`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      statement: sql,
      timeout: 120,
      warehouse: env.SNOWFLAKE_WAREHOUSE,
      role: env.SNOWFLAKE_ROLE,
      parameters: { TIMESTAMP_OUTPUT_FORMAT: 'YYYY-MM-DD' },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Snowflake query failed (${res.status}): ${text}`)
  }

  const body = (await res.json()) as {
    resultSetMetaData: { rowType: { name: string }[] }
    data: string[][]
  }

  const cols = body.resultSetMetaData.rowType.map((c) => c.name)
  return body.data.map((row) =>
    Object.fromEntries(cols.map((col, i) => [col, row[i] ?? null]))
  )
}
