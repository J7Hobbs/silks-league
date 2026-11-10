// The shared pipeline lives in supabase/functions/_shared/adminToday.js so the Edge Functions run the very same code. This
// file is the app's way in, so the app's imports are unchanged.
import './supabase'
export * from '../../supabase/functions/_shared/adminToday.js'
