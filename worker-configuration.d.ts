interface Env {
  ENVIRONMENT: string
  ZEUS_APP_ID?: string
  OPENROUTER_API_KEY?: string
  DB: D1Database
  STORAGE: R2Bucket
  SNOWFLAKE_ACCOUNT: string
  SNOWFLAKE_USER: string
  SNOWFLAKE_PRIVATE_KEY: string
  SNOWFLAKE_PUBLIC_KEY_FP: string
  SNOWFLAKE_ROLE: string
  SNOWFLAKE_WAREHOUSE: string
}
