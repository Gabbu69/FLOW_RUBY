import { supabase } from './supabaseClient'
import { db } from './schema'
import type { DailyLog, Cycle, Setting, ContentBookmark, HealthProfile } from './schema'
import type { RegimenRecord, MissedDoseEvent } from './regimen'

/**
 * Supabase sync layer for Ruby.
 *
 * Dexie (IndexedDB) remains the local-first source of truth for reactive UI
 * via useLiveQuery. This module mirrors every write to Supabase so data is
 * backed up in the cloud. On startup, pullFromSupabase() hydrates the local
 * DB from the cloud if the local store is empty.
 */

// ─── Table name mapping ────────────────────────────────────────────────
// Dexie table name → Supabase table name (snake_case)
const TABLE_MAP = {
  dailyLogs: 'daily_logs',
  cycles: 'cycles',
  settings: 'settings',
  contentBookmarks: 'content_bookmarks',
  healthProfiles: 'health_profiles',
  regimenRecords: 'regimen_records',
  missedDoseEvents: 'missed_dose_events',
} as const

type DexieTableName = keyof typeof TABLE_MAP

// ─── Primary key field mapping ─────────────────────────────────────────
const PK_MAP: Record<DexieTableName, string> = {
  dailyLogs: 'date',
  cycles: 'start_date',
  settings: 'key',
  contentBookmarks: 'slug',
  healthProfiles: 'id',
  regimenRecords: 'id',
  missedDoseEvents: 'id',
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Convert camelCase keys to snake_case for Supabase columns. */
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
    // For JSON/complex objects, store as JSONB
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = value
    } else {
      result[snakeKey] = value
    }
  }
  return result
}

/** Convert snake_case keys back to camelCase for Dexie. */
function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    result[camelKey] = value
  }
  return result
}

// ─── Push (local → Supabase) ───────────────────────────────────────────

/** Upsert a single record to Supabase. Silently fails if offline. */
export async function pushRecord(
  table: DexieTableName,
  record: Record<string, unknown>,
): Promise<void> {
  if (!supabase) return
  const supabaseTable = TABLE_MAP[table]
  const snakeRecord = toSnakeCase(record)
  try {
    const { error } = await supabase
      .from(supabaseTable)
      .upsert(snakeRecord, { onConflict: PK_MAP[table] })
    if (error) {
      console.warn(`[Ruby sync] push to ${supabaseTable} failed:`, error.message)
    }
  } catch (err) {
    console.warn(`[Ruby sync] push to ${supabaseTable} error:`, err)
  }
}

/** Delete a record from Supabase by primary key. */
export async function deleteRecord(
  table: DexieTableName,
  pkValue: string,
): Promise<void> {
  if (!supabase) return
  const supabaseTable = TABLE_MAP[table]
  const pkField = PK_MAP[table]
  try {
    const { error } = await supabase
      .from(supabaseTable)
      .delete()
      .eq(pkField, pkValue)
    if (error) {
      console.warn(`[Ruby sync] delete from ${supabaseTable} failed:`, error.message)
    }
  } catch (err) {
    console.warn(`[Ruby sync] delete from ${supabaseTable} error:`, err)
  }
}

/** Push all records from a local Dexie table to Supabase. */
export async function pushTable(table: DexieTableName): Promise<void> {
  if (!supabase) return
  const dexieTable = db[table]
  const records = await dexieTable.toArray()
  if (records.length === 0) return

  const supabaseTable = TABLE_MAP[table]
  const snakeRecords = records.map((r) => toSnakeCase(r as Record<string, unknown>))

  try {
    // Upsert in batches of 100
    for (let i = 0; i < snakeRecords.length; i += 100) {
      const batch = snakeRecords.slice(i, i + 100)
      const { error } = await supabase
        .from(supabaseTable)
        .upsert(batch, { onConflict: PK_MAP[table] })
      if (error) {
        console.warn(`[Ruby sync] batch push to ${supabaseTable} failed:`, error.message)
      }
    }
  } catch (err) {
    console.warn(`[Ruby sync] pushTable ${supabaseTable} error:`, err)
  }
}

// ─── Pull (Supabase → local) ──────────────────────────────────────────

/** Pull all records from a Supabase table into Dexie. */
async function pullTable(table: DexieTableName): Promise<number> {
  if (!supabase) return 0
  const supabaseTable = TABLE_MAP[table]
  try {
    const { data, error } = await supabase.from(supabaseTable).select('*')
    if (error) {
      console.warn(`[Ruby sync] pull from ${supabaseTable} failed:`, error.message)
      return 0
    }
    if (!data || data.length === 0) return 0

    const camelRecords = data.map((r) => toCamelCase(r as Record<string, unknown>))
    const dexieTable = db[table]
    await dexieTable.bulkPut(camelRecords as never[])
    return data.length
  } catch (err) {
    console.warn(`[Ruby sync] pullTable ${supabaseTable} error:`, err)
    return 0
  }
}

/**
 * Pull all data from Supabase into local Dexie.
 * Called on app startup to hydrate local DB from cloud.
 * Only hydrates tables that are locally empty.
 */
export async function pullFromSupabase(): Promise<void> {
  if (!supabase) return
  console.log('[Ruby sync] Pulling data from Supabase...')

  const tables: DexieTableName[] = [
    'dailyLogs',
    'cycles',
    'settings',
    'contentBookmarks',
    'healthProfiles',
    'regimenRecords',
    'missedDoseEvents',
  ]

  for (const table of tables) {
    const localCount = await db[table].count()
    if (localCount === 0) {
      const pulled = await pullTable(table)
      if (pulled > 0) {
        console.log(`[Ruby sync] Hydrated ${table} with ${pulled} records from cloud`)
      }
    }
  }
  console.log('[Ruby sync] Pull complete')
}

/**
 * Push all local data to Supabase.
 * Called on app startup after hydration, or manually for full sync.
 */
export async function pushAllToSupabase(): Promise<void> {
  if (!supabase) return
  console.log('[Ruby sync] Pushing all data to Supabase...')

  const tables: DexieTableName[] = [
    'dailyLogs',
    'cycles',
    'settings',
    'contentBookmarks',
    'healthProfiles',
    'regimenRecords',
    'missedDoseEvents',
  ]

  for (const table of tables) {
    await pushTable(table)
  }
  console.log('[Ruby sync] Push complete')
}

// ─── Dexie hooks (auto-sync on write) ─────────────────────────────────

/**
 * Install Dexie CRUD hooks so every local write also propagates to Supabase.
 * Call once during app initialization.
 */
export function installSyncHooks(): void {
  if (!supabase) return

  // Hook into each table's creating/updating/deleting
  const hookTable = (tableName: DexieTableName) => {
    const table = db[tableName]

    table.hook('creating', function (_pkValue, obj) {
      // Fire-and-forget push to Supabase
      pushRecord(tableName, obj as Record<string, unknown>).catch(() => {})
    })

    table.hook('updating', function (modifications, _pkValue, obj) {
      // Merge modifications with existing object and push
      const merged = { ...obj, ...modifications }
      pushRecord(tableName, merged as Record<string, unknown>).catch(() => {})
    })

    table.hook('deleting', function (pkValue) {
      if (pkValue != null) {
        deleteRecord(tableName, String(pkValue)).catch(() => {})
      }
    })
  }

  hookTable('dailyLogs')
  hookTable('cycles')
  hookTable('settings')
  hookTable('contentBookmarks')
  hookTable('healthProfiles')
  hookTable('regimenRecords')
  hookTable('missedDoseEvents')

  console.log('[Ruby sync] Dexie sync hooks installed')
}
