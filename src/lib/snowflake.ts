import { SignJWT, importPKCS8 } from 'jose'

export interface SnowflakeEnv {
  SNOWFLAKE_ACCOUNT: string
  SNOWFLAKE_USER: string
  SNOWFLAKE_PRIVATE_KEY: string
  SNOWFLAKE_PUBLIC_KEY_FP: string
  SNOWFLAKE_ROLE: string
  SNOWFLAKE_WAREHOUSE: string
}

/**
 * Cloudflare Worker secrets stored via `wrangler secret put` encode newlines
 * as literal \n (backslash + n). jose's importPKCS8 needs actual newlines to
 * parse the PEM header/footer correctly, so we normalise first.
 */
function normalisePem(raw: string): string {
  return raw.replace(/\\n/g, '\n')
}

async function buildJwt(env: SnowflakeEnv): Promise<string> {
  // Snowflake expects the account identifier in all-caps with dots → hyphens
  const account = env.SNOWFLAKE_ACCOUNT.toUpperCase().replace(/\./g, '-')
  const user = env.SNOWFLAKE_USER.toUpperCase()

  const privateKey = await importPKCS8(normalisePem(env.SNOWFLAKE_PRIVATE_KEY), 'RS256')

  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`${account}.${user}.SHA256:${env.SNOWFLAKE_PUBLIC_KEY_FP}`)
    .setSubject(`${account}.${user}`)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
}

/**
 * Execute a SQL statement via Snowflake HTTP API v2.
 * Positional ? bindings are passed as an array in order.
 */
export async function querySnowflake(
  env: SnowflakeEnv,
  sql: string,
  binds: (string | number | null)[] = [],
): Promise<Record<string, string | null>[]> {
  // API host uses lowercase account identifier with dots → hyphens
  const account = env.SNOWFLAKE_ACCOUNT.toLowerCase().replace(/\./g, '-')
  const jwt = await buildJwt(env)

  const bindings: Record<string, { type: string; value: string }> = {}
  for (let i = 0; i < binds.length; i++) {
    const v = binds[i]
    bindings[String(i + 1)] = {
      type: typeof v === 'number' ? 'FIXED' : 'TEXT',
      value: v == null ? '' : String(v),
    }
  }

  const res = await fetch(`https://${account}.snowflakecomputing.com/api/v2/statements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
    },
    body: JSON.stringify({
      statement: sql,
      ...(binds.length > 0 ? { bindings } : {}),
      role: env.SNOWFLAKE_ROLE,
      warehouse: env.SNOWFLAKE_WAREHOUSE,
      timeout: 60,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    data: (string | null)[][]
    resultSetMetaData: { rowType: { name: string }[] }
  }

  const cols = json.resultSetMetaData.rowType.map((c) => c.name)
  return (json.data ?? []).map((row) =>
    Object.fromEntries(cols.map((col, i) => [col, row[i] ?? null])),
  )
}
