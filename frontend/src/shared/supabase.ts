import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy frontend/.env.example to frontend/.env and fill in the values.',
  )
}

/** Public connection values already embedded in the Vite bundle. */
export const SUPABASE_REST_URL = `${url.replace(/\/+$/, '')}/rest/v1/`
export const SUPABASE_ANON_KEY = anonKey

export const supabase = createClient(url, anonKey)
