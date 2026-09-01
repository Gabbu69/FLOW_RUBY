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
  notes TEXT,
  updated_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Repair older Ruby databases whose first regimen migration omitted fields
-- already present in the app's RegimenRecord type.
ALTER TABLE regimen_records ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE regimen_records ADD COLUMN IF NOT EXISTS updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_regimen_method_start ON regimen_records (method, start_date);

-- 7. missed_dose_events — adherence tracking
CREATE TABLE IF NOT EXISTS missed_dose_events (
  id TEXT PRIMARY KEY,                              -- '{regimenId}:{date}'
  regimen_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,                               -- 'late' | 'skipped'
  hours_late NUMERIC,
  notes TEXT,
  recorded_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The client writes recordedAt; keep created_at for older rows and add the
-- matching column so upserts no longer fail with a missing-column error.
ALTER TABLE missed_dose_events ADD COLUMN IF NOT EXISTS recorded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_missed_dose_regimen_date ON missed_dose_events (regimen_id, date);

-- 8. pill_schedules — the user's active daily birth-control pill routine
CREATE TABLE IF NOT EXISTS pill_schedules (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  dose TEXT,
  scheduled_time TEXT NOT NULL,                    -- local HH:MM
  grace_minutes INTEGER NOT NULL DEFAULT 60 CHECK (grace_minutes BETWEEN 5 AND 720),
  reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 9. pill_dose_logs — one durable adherence row per calendar day
CREATE TABLE IF NOT EXISTS pill_dose_logs (
  id TEXT PRIMARY KEY,                              -- '{scheduleId}:{date}'
  schedule_id TEXT NOT NULL,
  date TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'taken', 'missed', 'skipped')),
  taken_at TIMESTAMPTZ,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT pill_dose_logs_schedule_date_unique UNIQUE (schedule_id, date)
);

CREATE INDEX IF NOT EXISTS idx_pill_dose_schedule_date
  ON pill_dose_logs (schedule_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_pill_dose_status_date
  ON pill_dose_logs (status, date DESC);

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
-- ALTER TABLE pill_schedules ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pill_dose_logs ENABLE ROW LEVEL SECURITY;
