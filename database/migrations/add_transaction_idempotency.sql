ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS idempotency_expires_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
  ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_expires_at
  ON transactions(idempotency_expires_at)
  WHERE idempotency_expires_at IS NOT NULL;
