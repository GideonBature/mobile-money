-- Migration: 003_add_retry_count
-- Description: Track application-level retry attempts for transaction processing

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
