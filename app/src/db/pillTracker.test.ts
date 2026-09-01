import { describe, expect, it } from 'vitest'
import {
  adherenceStreak,
  createDoseLog,
  reconcileDoseLogs,
  pillDoseTiming,
  type PillSchedule,
} from './pillTracker'

const schedule: PillSchedule = {
  id: 'primary',
  product: 'My pill',
  scheduledTime: '09:00',
  graceMinutes: 60,
  reminderEnabled: true,
  startDate: '2026-08-29',
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
}

describe('pill tracker persistence model', () => {
  it('backfills past untouched doses as missed and keeps today pending before its deadline', () => {
    const rows = reconcileDoseLogs(schedule, [], '2026-09-01', new Date(2026, 8, 1, 9, 30))
    expect(rows.map(({ date, status }) => [date, status])).toEqual([
      ['2026-08-29', 'missed'],
      ['2026-08-30', 'missed'],
      ['2026-08-31', 'missed'],
      ['2026-09-01', 'pending'],
    ])
  })

  it('does not overwrite an existing daily decision', () => {
    const existing = createDoseLog(schedule, '2026-08-31', 'taken')
    const rows = reconcileDoseLogs(schedule, [existing], '2026-09-01', new Date(2026, 8, 1, 11))
    expect(rows.map(({ date }) => date)).not.toContain('2026-08-31')
    expect(rows.at(-1)?.status).toBe('missed')
  })

  it('classifies timing against the user-configured grace window', () => {
    expect(pillDoseTiming(schedule, '2026-09-01', new Date(2026, 8, 1, 9, 45).toISOString())).toBe('on-time')
    expect(pillDoseTiming(schedule, '2026-09-01', new Date(2026, 8, 1, 10, 1).toISOString())).toBe('late')
  })

  it('turns an existing pending row into a missed row after its deadline', () => {
    const pending = createDoseLog(schedule, '2026-09-01', 'pending')
    const [row] = reconcileDoseLogs(schedule, [pending], '2026-09-01', new Date(2026, 8, 1, 10, 1))
    expect(row.status).toBe('missed')
  })

  it('counts a consecutive taken streak ending today or yesterday', () => {
    const logs = [
      createDoseLog(schedule, '2026-08-29', 'missed'),
      createDoseLog(schedule, '2026-08-30', 'taken'),
      createDoseLog(schedule, '2026-08-31', 'taken'),
      createDoseLog(schedule, '2026-09-01', 'pending'),
    ]
    expect(adherenceStreak(logs, '2026-09-01')).toBe(2)
  })
})
