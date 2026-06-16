import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:   true,           // store session in localStorage so it survives tab/app close
    autoRefreshToken: true,           // silently refresh the JWT before it expires
    storage:          localStorage,   // explicit — use localStorage, not sessionStorage
    storageKey:       'silks-league-auth', // namespaced key to avoid collisions
    detectSessionInUrl: true,         // handle magic-link / OAuth redirects
  },
})