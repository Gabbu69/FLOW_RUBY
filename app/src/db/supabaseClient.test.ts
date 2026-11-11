import { describe, expect, it, vi } from 'vitest'

describe('local-only evaluation boundary', () => {
  it('never creates a cloud client even with legacy deployment credentials', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'legacy-public-key')
    const { supabase } = await import('./supabaseClient')
    expect(supabase).toBeNull()
    vi.unstubAllEnvs()
  })
})
