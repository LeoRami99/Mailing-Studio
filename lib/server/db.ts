import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __misivaPool: Pool | undefined;
  var __misivaSchema: Promise<void> | undefined;
}

export function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function dbPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");
  if (!globalThis.__misivaPool) {
    globalThis.__misivaPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
      ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "0" } : false,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 15_000,
    });
  }
  return globalThis.__misivaPool;
}

export async function ensureSchema() {
  if (!databaseEnabled()) return;
  if (!globalThis.__misivaSchema) {
    globalThis.__misivaSchema = dbPool().query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        email VARCHAR(320) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(24) NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (role IN ('member', 'admin'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        user_agent VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS api_tokens (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL,
        token_prefix VARCHAR(24) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        scopes TEXT[] NOT NULL DEFAULT ARRAY['projects:read', 'projects:write']::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens(user_id);

      CREATE TABLE IF NOT EXISTS projects (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id VARCHAR(80) NOT NULL,
        name VARCHAR(160) NOT NULL,
        doc JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS upload_assets (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(180) NOT NULL,
        size_bytes INTEGER NOT NULL,
        media_type VARCHAR(80) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, name)
      );

      CREATE TABLE IF NOT EXISTS auth_attempts (
        key_hash CHAR(64) PRIMARY KEY,
        attempts INTEGER NOT NULL,
        window_started_at TIMESTAMPTZ NOT NULL,
        blocked_until TIMESTAMPTZ
      );
    `).then(() => undefined).catch((error) => {
      globalThis.__misivaSchema = undefined;
      throw error;
    });
  }
  return globalThis.__misivaSchema;
}

export async function query<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
  await ensureSchema();
  return dbPool().query<Row>(text, values);
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await dbPool().connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
