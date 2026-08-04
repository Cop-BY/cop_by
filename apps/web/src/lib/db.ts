import { neon } from "@neondatabase/serverless";

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  return neon(databaseUrl);
}

export async function ensureSwapTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS swap_intents (
      intent_id TEXT PRIMARY KEY,
      user_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      swap_type TEXT NOT NULL DEFAULT 'buy',
      requested_copm TEXT NOT NULL,
      output_token TEXT NOT NULL DEFAULT 'COPm',
      output_amount TEXT,
      recipient_address TEXT,
      tokens_spent JSONB NOT NULL DEFAULT '[]'::jsonb,
      squid_request_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      swap_tx_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
      copm_received TEXT,
      fee_usd TEXT,
      onchain_log_tx_hash TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    ALTER TABLE swap_intents
    ADD COLUMN IF NOT EXISTS fee_usd TEXT
  `;
  await getSql()`
    ALTER TABLE swap_intents
    ADD COLUMN IF NOT EXISTS recipient_address TEXT
  `;
  await getSql()`
    ALTER TABLE swap_intents
    ADD COLUMN IF NOT EXISTS swap_type TEXT NOT NULL DEFAULT 'buy'
  `;
  await getSql()`
    ALTER TABLE swap_intents
    ADD COLUMN IF NOT EXISTS output_token TEXT NOT NULL DEFAULT 'COPm'
  `;
  await getSql()`
    ALTER TABLE swap_intents
    ADD COLUMN IF NOT EXISTS output_amount TEXT
  `;
}

export async function ensureTransferTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS copm_transfers (
      transfer_id TEXT PRIMARY KEY,
      sender_address TEXT NOT NULL,
      recipient_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      copm_amount TEXT NOT NULL,
      tx_hash TEXT,
      onchain_log_tx_hash TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function ensureAgentSessionTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      user_address TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      allowed_pair TEXT NOT NULL,
      max_trade_usd TEXT NOT NULL,
      max_copm_trade TEXT,
      max_usdt_trade TEXT,
      max_copm_volume TEXT,
      max_usdt_volume TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      signature TEXT,
      onchain_session_tx_hash TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS agent_sessions_user_status_idx
    ON agent_sessions (user_address, status, expires_at)
  `;
  await getSql()`
    ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS max_copm_trade TEXT
  `;
  await getSql()`
    ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS max_usdt_trade TEXT
  `;
  await getSql()`
    ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS max_copm_volume TEXT
  `;
  await getSql()`
    ALTER TABLE agent_sessions
    ADD COLUMN IF NOT EXISTS max_usdt_volume TEXT
  `;
}

export async function ensureAgentTradeTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS agent_trades (
      intent_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_token TEXT NOT NULL,
      output_token TEXT NOT NULL,
      input_amount TEXT NOT NULL,
      quoted_output_amount TEXT,
      actual_output_amount TEXT,
      squid_request_id TEXT,
      squid_quote_id TEXT,
      batch_to TEXT,
      batch_data TEXT,
      batch_value TEXT,
      trade_tx_hash TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS agent_trades_session_created_idx
    ON agent_trades (session_id, created_at DESC)
  `;
  await getSql()`
    ALTER TABLE agent_trades
    ADD COLUMN IF NOT EXISTS actual_output_amount TEXT
  `;
}
