import type { SupabaseClient } from '@supabase/supabase-js'

// The evaluation build is local-only, including when legacy deployment
// credentials remain configured. No environment flag can re-enable the
// shared, unscoped schema. Authenticated owner isolation is a future migration.
// https://supabase.com/docs/guides/database/postgres/row-level-security
export const supabase: SupabaseClient | null = null
