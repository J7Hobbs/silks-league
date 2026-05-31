-- Silks League — Username Migration
-- Run once in the Supabase SQL Editor

-- Add username column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;

-- Unique constraint (allows multiple NULLs, only enforces uniqueness on non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON profiles (username)
  WHERE username IS NOT NULL;
