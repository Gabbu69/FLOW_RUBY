/**
 * First-class dated contraception and medication regimen model.
 *
 * The existing ContraceptionMethod on HealthProfile tells us *what* someone
 * uses today. That is enough for the prediction engine to suppress or widen
 * forecasts. But it tells us nothing about *when* they started, whether they
 * are mid-pack, when the next ring change is due, or whether last Tuesday's
 * pill was taken on time.
 *
 * This module closes that gap with a typed, time-ranged RegimenRecord that
 * lives in its own Dexie table. A few design choices worth calling out:
 *
 *   - Records are append-only by convention: stopping a method means writing
 *     an endDate, not mutating the old record. The engine can then interpret
 *     any date in history correctly without guessing.
 *
 *   - dose and product are free-text rather than enums. Exact formulations
 *     change constantly and the user knows better than we do.
 *
 *   - MissedDoseEvent is a separate lightweight record, not a field on the
 *     daily log. That keeps DailyLog as the source of truth for symptoms and
 *     keeps adherence queries cheap (one index scan, no log filtering).
 *
 * Nothing here produces a recommendation or a safety claim. Missed-dose
 * guidance is outside the scope of this data layer.
 */

import type { ContraceptionMethod } from './schema'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Hormonal and non-hormonal methods that benefit from dated regimen tracking.
 * This is deliberately narrower than ContraceptionMethod: 'none', 'unknown',
 * and 'prefer-not-to-say' are profile-level privacy answers, not something you
 * schedule or log adherence for.
 */
export type TrackableMethod = Exclude<
  ContraceptionMethod,
  'none' | 'unknown' | 'prefer-not-to-say' | 'sterilization'
>

/**
 * How strict the pack schedule is for pill-based methods.
 *
 * 'standard'   — 21 active + 7 placebo (classic 28-day pack).
 * 'continuous' — active pills only; no scheduled bleed.
 * 'extended'   — e.g. 84 active + 7 placebo (Seasonique-style).
 * 'flexible'   — user-defined; no schedule generated.
 */
export type PillScheduleKind = 'standard' | 'continuous' | 'extended' | 'flexible'

/**
 * How often a wearable device (patch or ring) needs to be changed or removed.
 * The engine uses this to calculate the next action date and populate reminders.
 */
export interface WearableCycle {
  /** Days the device is worn before the first change/removal. */
  wearDays: number
  /**
   * Days the device is removed before the next one goes in.
   * Zero means continuous wear (some rings are worn for 3 weeks, removed for 1;
   * others stay in for the full 28 days).
   */
  ringFreeDays: number
}

/**
 * Method-specific configuration. Only one variant is present at a time;
 * which variant depends on RegimenRecord.method.
 *
 * This is a discriminated union so callers can exhaustively switch on `kind`
 * and get the right fields without any optional gymnastics.
 */
export type MethodConfig =
  | {
      kind: 'pill'
      /** Active pills per pack (21 or 24 are the common values). */
      activePillsPerPack: number
      /** Placebo or pill-free days per pack (7 or 4). */
      placeboPillsPerPack: number
      schedule: PillScheduleKind
      /** ISO date the current pack started. Engine uses this to compute day-in-pack. */
      currentPackStart?: string
    }
  | {
      kind: 'patch'
      /** Typically a 7-day wear cycle with a patch-free week, but some brands differ. */
      cycle: WearableCycle
      /** ISO date the current patch was applied. */
      currentPatchStart?: string
    }
  | {
      kind: 'ring'
      cycle: WearableCycle
      /** ISO date the current ring was inserted. */
      currentRingStart?: string
    }
  | {
      kind: 'injection'
      /** How many days between injections (depot medroxyprogesterone is typically 84–91). */
      intervalDays: number
      /** ISO date of the most recent injection. */
      lastInjectionDate?: string
    }
  | {
      kind: 'implant'
      /** ISO date the implant was inserted. Duration is typically 3 years. */
      insertedDate?: string
      /** ISO date for planned or recommended removal/replacement. */
      plannedRemovalDate?: string
    }
  | {
      kind: 'iud'
      /** Whether this is a hormonal or copper device; copper has no hormone suppression. */
      hormonal: boolean
      /** ISO date of insertion. */
      insertedDate?: string
      /** ISO date for planned or recommended replacement (hormonal IUDs expire after 3–8 years). */
      plannedReplacementDate?: string
    }
  | {
      kind: 'barrier'
      // No schedule to track; this variant is a record-keeping placeholder.
    }
  | {
      kind: 'other'
      description?: string
    }

// ---------------------------------------------------------------------------
// Regimen records
// ---------------------------------------------------------------------------

/**
 * A single period of using one contraception or medication method.
 *
 * Records are immutable by convention once written. Changing a method means
 * ending the current record (setting endDate) and writing a new one. This
 * keeps the historical interpretation of past cycles intact.
 */
export interface RegimenRecord {
  /**
   * Primary key. Use `${method}-${startDate}` as a stable deterministic ID so
   * that re-imports from a backup do not create duplicates.
   */
  id: string

  method: TrackableMethod

  /**
   * Brand name or product name, e.g. "Yasmin", "Mirena", "Depo-Provera".
   * Free text; we make no attempt to maintain a drug database.
   */
  product?: string

  /**
   * Dose or strength, e.g. "30 mcg EE / 150 mcg LNG". Free text for the
   * same reason as product.
   */
  dose?: string

  /**
   * ISO date when the method was started. Required; this is the epoch for all
   * schedule calculations.
   */
  startDate: string

  /**
   * ISO date when the method was stopped. Absent means the record is active.
   * Setting this field does not delete the record; it closes the time range.
   */
  endDate?: string

  /**
   * Why the method was stopped or switched, if the user chose to record it.
   * Optional and free text.
   */
  stopReason?: string

  /**
   * Method-specific schedule and device configuration. Absent for records
   * where no schedule is relevant (e.g. past barrier use logged retroactively).
   */
  config?: MethodConfig

  /** Notes the user wrote about this regimen period. */
  notes?: string

  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Missed / late dose events
// ---------------------------------------------------------------------------

/**
 * How late a dose was taken, or whether it was skipped entirely.
 * These thresholds follow typical pill-instruction language.
 *
 * 'late'    — taken, but outside the usual window (≤12h or ≤24h late
 *             depending on the pill type).
 * 'skipped' — not taken at all that day.
 */
export type MissedDoseKind = 'late' | 'skipped'

/**
 * A single missed or late adherence event for a tracked regimen.
 *
 * Separated from DailyLog so that:
 *   1. Adherence queries are a fast indexed scan on this table only.
 *   2. The engine can calculate "was the user mid-miss when this cycle started?"
 *      without loading every daily log.
 *   3. Missed-dose history survives a daily-log delete/edit without data loss.
 */
export interface MissedDoseEvent {
  /** `${regimenId}-${date}` — one record per day per regimen. */
  id: string
  regimenId: string
  date: string
  kind: MissedDoseKind
  /** How many hours late the dose was taken, when kind is 'late'. */
  hoursLate?: number
  notes?: string
  recordedAt: string
}

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

/**
 * Build a deterministic regimen record ID from its two immutable fields.
 * Using a compound key prevents accidental duplicates on re-import.
 */
export function regimenId(method: TrackableMethod, startDate: string): string {
  return `${method}:${startDate}`
}

/**
 * Build a deterministic missed-dose event ID.
 * One event per regimen per calendar day is the intended invariant.
 */
export function missedDoseId(regimenId: string, date: string): string {
  return `${regimenId}:${date}`
}

/**
 * Return true when a regimen record covers the given ISO date.
 * An open record (no endDate) covers every date from startDate onward.
 */
export function regimenCoversDate(record: RegimenRecord, date: string): boolean {
  if (date < record.startDate) return false
  if (record.endDate && date > record.endDate) return false
  return true
}

/**
 * Return the single regimen record that was active on a given date, or
 * undefined when none was. If two records somehow overlap (shouldn't happen
 * by convention), the one with the later startDate wins.
 */
export function activeRegimenOn(
  records: RegimenRecord[],
  date: string,
): RegimenRecord | undefined {
  return [...records]
    .filter((r) => regimenCoversDate(r, date))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
}
