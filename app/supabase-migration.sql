-- ============================================================
-- Ruby (formerly Lunara) — Supabase table migration
-- Run this in the Supabase SQL Editor to create all tables.
-- ============================================================

-- 1. daily_logs — one row per day of tracked health data
CREATE TABLE IF NOT EXISTS daily_logs (
  date TEXT PRIMARY KEY,                            -- 'YYYY-MM-DD'
  check_in_complete BOOLEAN,
  flow TEXT,                                        -- 'light' | 'medium' | 'heavy' | 'clots'
  period_start BOOLEAN,
  symptoms JSONB,                                   -- string[]
  symptom_ratings JSONB,                            -- Record<string, {severity, impairment}>
  moods JSONB,                                      -- string[]
  events JSONB,                                     -- string[]
  discharge TEXT,
  sex TEXT,                                         -- legacy single-select
  intimacy_events JSONB,                            -- IntimacyEvent[]
  pregnancy_test TEXT,                              -- 'not-taken' | 'positive' | 'negative' | 'faint'
  digestion JSONB,                                  -- DigestionEvent[]
  activities JSONB,                                 -- ActivityEvent[]
  lifestyle JSONB,                                  -- LifestyleEvent[]
  bbt INTEGER,                                      -- °C × 100 (integer)
  opk TEXT,                                         -- 'positive' | 'negative'
  weight_kg NUMERIC,
  water_ml NUMERIC,
  sleep_minutes INTEGER,
  steps INTEGER,
  notes TEXT,
  health_imports JSONB,                             -- field-level provenance
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. cycles — materialized period ranges
CREATE TABLE IF NOT EXISTS cycles (
  start_date TEXT PRIMARY KEY,                      -- 'YYYY-MM-DD'
  end_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. settings — key-value app settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. content_bookmarks — saved articles
CREATE TABLE IF NOT EXISTS content_bookmarks (
  slug TEXT PRIMARY KEY,
  saved_at TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. health_profiles — user health profile
CREATE TABLE IF NOT EXISTS health_profiles (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  schema_version INTEGER DEFAULT 2,
  created_at TEXT,
  updated_at TEXT,
  display_name TEXT,
  birth_year INTEGER,
  goals JSONB,                                      -- Goal[]
  primary_goal TEXT,                                -- Goal
  cycle JSONB,                                      -- HealthProfileCycle
  reproductive JSONB,                               -- HealthProfileReproductive
  conditions JSONB,                                 -- HealthCondition[]
  wellbeing JSONB,                                  -- HealthProfileWellbeing
  biometrics JSONB,                                 -- HealthProfileBiometrics
  permissions JSONB,                                -- HealthProfilePermissions
  privacy JSONB                                     -- HealthProfilePrivacy
);

-- 6. regimen_records — contraception & medication periods
CREATE TABLE IF NOT EXISTS regimen_records (
  id TEXT PRIMARY KEY,                              -- '{method}:{startDate}'
  method TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  product TEXT,
  dose TEXT,
  stop_reason TEXT,
  config JSONB,                                     -- MethodConfig
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regimen_method_start ON regimen_records (method, start_date);

-- 7. missed_dose_events — adherence tracking
CREATE TABLE IF NOT EXISTS missed_dose_events (
  id TEXT PRIMARY KEY,                              -- '{regimenId}:{date}'
  regimen_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,                               -- 'late' | 'skipped'
  hours_late NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_missed_dose_regimen_date ON missed_dose_events (regimen_id, date);

-- ============================================================
-- Enable Row Level Security (optional — uncomment if needed)
-- For now, public access via the publishable key is allowed.
-- ============================================================
-- ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE content_bookmarks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE health_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE regimen_records ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE missed_dose_events ENABLE ROW LEVEL SECURITY;
