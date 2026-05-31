-- Silks League — Form String Migration
-- Run once in the Supabase SQL Editor
ALTER TABLE runners ADD COLUMN IF NOT EXISTS form_string TEXT;
