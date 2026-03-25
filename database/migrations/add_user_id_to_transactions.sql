-- Migration: add_user_id_to_transactions
-- Extends transactions table to link transactions to users for KYC-based daily limit tracking.
-- Adds user_id foreign key and indexes for efficient transaction history queries.

-- Add user_id column as UUID foreign key referencing users(id)
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- Create index on user_id for efficient user transaction lookups
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

-- Create composite index on (user_id, created_at) for efficient daily limit calculations
-- This supports queries filtering by user and time window (rolling 24-hour period)
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at);
