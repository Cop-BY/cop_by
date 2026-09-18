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

export async function ensureIntegrationApiKeyTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS integration_api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key_id TEXT UNIQUE,
      key_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
      rate_limit_per_minute INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    ALTER TABLE integration_api_keys
    ADD COLUMN IF NOT EXISTS public_key_id TEXT UNIQUE
  `;
}

export async function ensureIntegrationSwapTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS integration_swap_intents (
      intent_id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_token TEXT NOT NULL,
      output_token TEXT NOT NULL,
      input_amount TEXT NOT NULL,
      quoted_output_amount TEXT,
      actual_output_amount TEXT,
      min_output_amount TEXT,
      squid_request_id TEXT,
      squid_quote_id TEXT,
      approval_target TEXT,
      tx_to TEXT,
      tx_data TEXT,
      tx_value TEXT,
      swap_tx_hash TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS integration_swaps_integration_created_idx
    ON integration_swap_intents (integration_id, created_at DESC)
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS integration_swaps_user_created_idx
    ON integration_swap_intents (user_address, created_at DESC)
  `;
}

export async function ensureBrebTables() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS breb_fx_cache (
      cache_key TEXT PRIMARY KEY,
      sell_rate TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS breb_quotes (
      quote_id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      from_token TEXT NOT NULL,
      destination_cop TEXT,
      sell_rate TEXT NOT NULL,
      effective_usd_cop TEXT NOT NULL,
      source_amount TEXT,
      source_amount_usd TEXT,
      net_usdc_to_bridge TEXT,
      swap_provider TEXT,
      fees JSONB NOT NULL DEFAULT '[]'::jsonb,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS bridge_customers (
      customer_id TEXT PRIMARY KEY,
      email_normalized TEXT UNIQUE,
      email_hash TEXT,
      full_name_hash TEXT,
      kyc_status TEXT NOT NULL,
      cop_endorsement TEXT,
      kyc_link TEXT,
      tos_link TEXT,
      kyc_link_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS bridge_customer_wallets (
      user_address TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      email_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS bridge_customer_wallets_customer_idx
    ON bridge_customer_wallets (customer_id)
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS breb_email_otps (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL,
      user_address TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS breb_email_otps_lookup_idx
    ON breb_email_otps (email_normalized, user_address, created_at DESC)
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS bridge_external_accounts (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      bre_b_key_last4 TEXT,
      account_owner_name TEXT,
      verification_status TEXT NOT NULL,
      validated_bank_name TEXT,
      validated_document_last4 TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS breb_payouts (
      payout_id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      user_address TEXT NOT NULL,
      customer_id TEXT,
      from_token TEXT NOT NULL,
      quote_id TEXT,
      destination_cop TEXT NOT NULL,
      source_amount TEXT NOT NULL,
      source_amount_usd TEXT,
      net_usdc_to_bridge TEXT NOT NULL,
      effective_usd_cop TEXT,
      swap_provider TEXT,
      deposit_address TEXT,
      deposit_amount TEXT,
      bridge_transfer_id TEXT,
      external_account_id TEXT,
      bre_b_key_last4 TEXT,
      account_owner_name TEXT,
      status TEXT NOT NULL,
      fees JSONB NOT NULL DEFAULT '[]'::jsonb,
      approval_target TEXT,
      tx_to TEXT,
      tx_data TEXT,
      tx_value TEXT,
      fee_tx_to TEXT,
      fee_tx_data TEXT,
      source_tx_hash TEXT,
      swap_tx_hash TEXT,
      idempotency_key TEXT,
      error TEXT,
      error_code TEXT,
      additional_funding_usdc TEXT,
      deposit_verified_at TIMESTAMPTZ,
      fees_verified_at TIMESTAMPTZ,
      bridge_payout_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE UNIQUE INDEX IF NOT EXISTS breb_payouts_source_tx_hash_idx
    ON breb_payouts (source_tx_hash)
    WHERE source_tx_hash IS NOT NULL
  `;
  await getSql()`
    CREATE UNIQUE INDEX IF NOT EXISTS breb_payouts_idempotency_idx
    ON breb_payouts (integration_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS breb_payouts_integration_created_idx
    ON breb_payouts (integration_id, created_at DESC)
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS breb_payouts_bridge_transfer_idx
    ON breb_payouts (bridge_transfer_id)
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS breb_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE TABLE IF NOT EXISTS integration_request_logs (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      status INTEGER,
      error_code TEXT,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await getSql()`
    CREATE INDEX IF NOT EXISTS integration_request_logs_integration_created_idx
    ON integration_request_logs (integration_id, created_at DESC)
  `;
}
