import { describe, expect, it } from 'vitest'
import {
  activeRegimenOn,
  missedDoseId,
  regimenCoversDate,
  regimenId,
  type MissedDoseEvent,
  type RegimenRecord,
} from './regimen'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pillRecord(overrides: Partial<RegimenRecord> = {}): RegimenRecord {
  return {
    id: regimenId('combined-pill-patch-ring', '2026-01-01'),
    method: 'combined-pill-patch-ring',
    product: 'Yasmin',
    startDate: '2026-01-01',
    config: {
      kind: 'pill',
      activePillsPerPack: 21,
      placeboPillsPerPack: 7,
      schedule: 'standard',
      currentPackStart: '2026-07-07',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function ringRecord(overrides: Partial<RegimenRecord> = {}): RegimenRecord {
  return {
    id: regimenId('combined-pill-patch-ring', '2026-04-01'),
    method: 'combined-pill-patch-ring',
    product: 'NuvaRing',
    startDate: '2026-04-01',
    config: {
      kind: 'ring',
      cycle: { wearDays: 21, ringFreeDays: 7 },
      currentRingStart: '2026-07-07',
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// regimenId / missedDoseId
// ---------------------------------------------------------------------------

describe('deterministic IDs', () => {
  it('builds a stable compound regimen ID from method and start date', () => {
    expect(regimenId('combined-pill-patch-ring', '2026-01-01')).toBe(
      'combined-pill-patch-ring:2026-01-01',
    )
  })

  it('builds a stable missed-dose ID from regimen ID and date', () => {
    const rid = regimenId('progestin-only-pill', '2026-03-15')
    expect(missedDoseId(rid, '2026-07-10')).toBe('progestin-only-pill:2026-03-15:2026-07-10')
  })
})

// ---------------------------------------------------------------------------
// regimenCoversDate
// ---------------------------------------------------------------------------

describe('regimenCoversDate', () => {
  it('covers dates on and after startDate when there is no endDate', () => {
    const record = pillRecord()
    expect(regimenCoversDate(record, '2026-01-01')).toBe(true)
    expect(regimenCoversDate(record, '2026-07-28')).toBe(true)
    expect(regimenCoversDate(record, '2099-12-31')).toBe(true)
  })

  it('does not cover dates before startDate', () => {
    const record = pillRecord()
    expect(regimenCoversDate(record, '2025-12-31')).toBe(false)
  })

  it('covers startDate and endDate themselves (inclusive on both ends)', () => {
    const record = pillRecord({ endDate: '2026-03-31' })
    expect(regimenCoversDate(record, '2026-01-01')).toBe(true)
    expect(regimenCoversDate(record, '2026-03-31')).toBe(true)
  })

  it('does not cover dates after endDate', () => {
    const record = pillRecord({ endDate: '2026-03-31' })
    expect(regimenCoversDate(record, '2026-04-01')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// activeRegimenOn
// ---------------------------------------------------------------------------

describe('activeRegimenOn', () => {
  it('returns undefined when no records exist', () => {
    expect(activeRegimenOn([], '2026-07-28')).toBeUndefined()
  })

  it('returns the single covering record when only one exists', () => {
    const record = pillRecord()
    expect(activeRegimenOn([record], '2026-07-28')).toStrictEqual(record)
  })

  it('returns undefined when the date falls outside all records', () => {
    const record = pillRecord({ endDate: '2026-03-31' })
    expect(activeRegimenOn([record], '2026-07-28')).toBeUndefined()
  })

  it('returns the record with the later startDate when two records overlap (defensive tie-break)', () => {
    // Overlap should not happen by convention, but the function should be
    // deterministic rather than undefined behavior if it does.
    const older = pillRecord({ startDate: '2026-01-01' })
    const newer = ringRecord({ startDate: '2026-04-01' })
    expect(activeRegimenOn([older, newer], '2026-07-28')?.product).toBe('NuvaRing')
  })

  it('correctly picks from a realistic method-switch history', () => {
    // Pill Jan–Mar, ring from Apr onward.
    const pill = pillRecord({ endDate: '2026-03-31' })
    const ring = ringRecord()

    expect(activeRegimenOn([pill, ring], '2026-02-15')?.product).toBe('Yasmin')
    expect(activeRegimenOn([pill, ring], '2026-04-01')?.product).toBe('NuvaRing')
    expect(activeRegimenOn([pill, ring], '2026-07-28')?.product).toBe('NuvaRing')

    // The day between stop and start belongs to neither.
    // (endDate = Mar 31, startDate = Apr 1 — no gap in this case, but test the
    //  boundary explicitly.)
    expect(activeRegimenOn([pill, ring], '2026-03-31')?.product).toBe('Yasmin')
  })
})

// ---------------------------------------------------------------------------
// MissedDoseEvent shape sanity
// ---------------------------------------------------------------------------

describe('MissedDoseEvent shape', () => {
  it('accepts a late-dose event with optional hoursLate', () => {
    const event: MissedDoseEvent = {
      id: missedDoseId(regimenId('progestin-only-pill', '2026-03-01'), '2026-07-10'),
      regimenId: regimenId('progestin-only-pill', '2026-03-01'),
      date: '2026-07-10',
      kind: 'late',
      hoursLate: 4,
      recordedAt: '2026-07-10T14:00:00.000Z',
    }
    expect(event.kind).toBe('late')
    expect(event.hoursLate).toBe(4)
  })

  it('accepts a skipped-dose event without hoursLate', () => {
    const event: MissedDoseEvent = {
      id: missedDoseId(regimenId('combined-pill-patch-ring', '2026-01-01'), '2026-07-15'),
      regimenId: regimenId('combined-pill-patch-ring', '2026-01-01'),
      date: '2026-07-15',
      kind: 'skipped',
      recordedAt: '2026-07-15T23:59:00.000Z',
    }
    expect(event.kind).toBe('skipped')
    expect(event.hoursLate).toBeUndefined()
  })
})
