-- Migration: Add replacement tracking columns to picks table
-- Run this in the Supabase SQL editor on project wfytwcwletznzyayjkrv

ALTER TABLE picks ADD COLUMN IF NOT EXISTS original_runner_id UUID REFERENCES runners(id);
ALTER TABLE picks ADD COLUMN IF NOT EXISTS was_replaced BOOLEAN DEFAULT false;
ALTER TABLE picks ADD COLUMN IF NOT EXISTS replacement_reason TEXT;
