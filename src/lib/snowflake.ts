// Snowflake SQL REST API client for Cloudflare Workers
// Uses key-pair JWT authentication (RS256)

export interface SnowflakeEnv {
  SNOWFLAKE_ACCOUNT: string
  SNOWFLAKE_USER: string
  SNOWFLAKE_PRIVATE_KEY: string
  SNOWFLAKE_PUBLIC_KEY_FP: string
  SNOWFLAKE_ROLE: string
  SNOWFLAKE_WAREHOUSE: string
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/\\r\\n/g, '\n') // literal \r\n sequences
    .replace(/\\n/g, '\n') // literal \n sequences from secret storage
    .replace(/\\r/g, '\n') // literal \r sequences
    .replace(/-----BEGIN[^-]+-----/g, '')
    .replace(/-----END[^-]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '') // strip ALL non-base64 chars (whitespace, BOM, etc.)
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return buffer
}

async function createJWT(env: SnowflakeEnv): Promise<string> {
  const account = env.SNOWFLAKE_ACCOUNT.toUpperCase().replace(/-/g, '_')
  const user = env.SNOWFLAKE_USER.toUpperCase()
  const fp = env.SNOWFLAKE_PUBLIC_KEY_FP.startsWith('SHA256:')
    ? env.SNOWFLAKE_PUBLIC_KEY_FP
    : `SHA256:${env.SNOWFLAKE_PUBLIC_KEY_FP}`

  const now = Math.floor(Date.now() / 1000)
  const encoder = new TextEncoder()

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: `${account}.${user}.${fp}`,
    sub: `${account}.${user}`,
    iat: now,
    exp: now + 3600,
  }

  const headerB64 = toBase64Url(encoder.encode(JSON.stringify(header)).buffer as ArrayBuffer)
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)).buffer as ArrayBuffer)
  const signingInput = `${headerB64}.${payloadB64}`

  const keyData = pemToArrayBuffer(env.SNOWFLAKE_PRIVATE_KEY)
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(signingInput),
  )

  return `${signingInput}.${toBase64Url(signature)}`
}

export async function querySnowflake(
  env: SnowflakeEnv,
  sql: string,
  bindings: string[] = [],
): Promise<Record<string, string | null>[]> {
  const jwt = await createJWT(env)
  const account = env.SNOWFLAKE_ACCOUNT.toLowerCase()

  const bindingsObj = bindings.reduce(
    (acc, val, i) => {
      acc[String(i + 1)] = { type: 'TEXT', value: val }
      return acc
    },
    {} as Record<string, { type: string; value: string }>,
  )

  const response = await fetch(`https://${account}.snowflakecomputing.com/api/v2/statements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      Accept: 'application/json',
      'User-Agent': 'owner-seo-audit/1.0',
    },
    body: JSON.stringify({
      statement: sql,
      timeout: 60,
      role: env.SNOWFLAKE_ROLE,
      warehouse: env.SNOWFLAKE_WAREHOUSE,
      bindings: Object.keys(bindingsObj).length > 0 ? bindingsObj : undefined,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Snowflake error ${response.status}: ${text}`)
  }

  const result = (await response.json()) as {
    resultSetMetaData: { rowType: Array<{ name: string }> }
    data: string[][]
  }

  const columns = result.resultSetMetaData.rowType.map((col) => col.name)
  return result.data.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i] ?? null])),
  )
}
