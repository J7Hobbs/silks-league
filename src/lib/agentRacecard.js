// The race-day agent code lives in supabase/functions/_shared/agentRacecard.js so the Edge Function runs the very same code. This
// file is the app's way in.
import './supabase'
export * from '../../supabase/functions/_shared/agentRacecard.js'
