-- Migration: 003_add_2fa_support
-- Description: Add two-factor authentication support to users table
-- This migration adds TOTP secret storage and backup codes functionality.

-- Up migration

-- Add 2FA fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(32),
ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS two_factor_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Create backup codes table
CREATE TABLE IF NOT EXISTS backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP
);

-- Create indexes for backup codes
CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id ON backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_backup_codes_used ON backup_codes(used);

-- Add constraint to ensure only one unused backup code can be used at a time
ALTER TABLE backup_codes 
ADD CONSTRAINT chk_backup_codes_used_at 
CHECK (used_at IS NULL OR used = TRUE);

-- Create function to update used_at timestamp
CREATE OR REPLACE FUNCTION update_backup_codes_used_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.used = TRUE AND OLD.used = FALSE THEN
    NEW.used_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update used_at when backup code is used
DROP TRIGGER IF EXISTS backup_codes_used_at ON backup_codes;
CREATE TRIGGER backup_codes_used_at
  BEFORE UPDATE ON backup_codes
  FOR EACH ROW EXECUTE FUNCTION update_backup_codes_used_at();

-- Add index for email if it exists
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Down migration

-- To rollback this migration, uncomment and run the following:
-- DROP TRIGGER IF EXISTS backup_codes_used_at ON backup_codes;
-- DROP FUNCTION IF EXISTS update_backup_codes_used_at();
-- DROP TABLE IF EXISTS backup_codes;
-- ALTER TABLE users DROP COLUMN IF EXISTS two_factor_secret;
-- ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
-- ALTER TABLE users DROP COLUMN IF EXISTS two_factor_verified;
-- ALTER TABLE users DROP COLUMN IF EXISTS email;
