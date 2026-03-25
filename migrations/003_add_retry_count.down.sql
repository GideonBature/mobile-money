-- Rollback: 003_add_retry_count

ALTER TABLE transactions
  DROP COLUMN IF EXISTS retry_count;
