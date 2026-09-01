import { addDays } from '../engine/cycle'

export type PillDoseStatus = 'pending' | 'taken' | 'missed' | 'skipped'

export interface PillSchedule {
  /** A single active schedule keeps setup simple while remaining extensible. */
  id: 'primary'
  product: string
  dose?: string
  scheduledTime: string
  graceMinutes: number
  reminderEnabled: boolean
  startDate: string
  createdAt: string
  updatedAt: string
}

export interface PillDoseLog {
  id: string
  scheduleId: PillSchedule['id']
  date: string
  scheduledFor: string
  status: PillDoseStatus
  takenAt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export function pillDoseId(scheduleId: string, date: string): string {
  return `${scheduleId}:${date}`
}

export function localDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

export function pillDoseDeadline(schedule: PillSchedule, date: string): Date {
  return new Date(
    localDateTime(date, schedule.scheduledTime).getTime() + schedule.graceMinutes * 60_000,
  )
}

export function pillDoseTiming(
  schedule: PillSchedule,
  date: string,
  takenAt: string,
): 'on-time' | 'late' {
  return new Date(takenAt).getTime() <= pillDoseDeadline(schedule, date).getTime()
    ? 'on-time'
    : 'late'
}

export function createDoseLog(
  schedule: PillSchedule,
  date: string,
  status: PillDoseStatus,
  now = new Date(),
): PillDoseLog {
  const timestamp = now.toISOString()
  return {
    id: pillDoseId(schedule.id, date),
    scheduleId: schedule.id,
    date,
    scheduledFor: localDateTime(date, schedule.scheduledTime).toISOString(),
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * Create the daily rows that make an untouched dose auditable. Browsers cannot
 * write while closed, so this is run at startup and whenever the tracker opens.
 */
export function reconcileDoseLogs(
  schedule: PillSchedule,
  existing: readonly PillDoseLog[],
  today: string,
  now = new Date(),
  historyDays = 90,
): PillDoseLog[] {
  const existingDates = new Set(existing.map((log) => log.date))
  const firstDate = schedule.startDate > addDays(today, -historyDays)
    ? schedule.startDate
    : addDays(today, -historyDays)
  const rows: PillDoseLog[] = []

  for (const log of existing) {
    if (
      log.status === 'pending' &&
      (log.date < today || now.getTime() > pillDoseDeadline(schedule, log.date).getTime())
    ) {
      rows.push({ ...log, status: 'missed', updatedAt: now.toISOString() })
    }
  }

  for (let date = firstDate; date <= today; date = addDays(date, 1)) {
    if (existingDates.has(date)) continue
    const status: PillDoseStatus =
      date < today || now.getTime() > pillDoseDeadline(schedule, date).getTime()
        ? 'missed'
        : 'pending'
    rows.push(createDoseLog(schedule, date, status, now))
  }
  return rows
}

export function adherenceStreak(logs: readonly PillDoseLog[], today: string): number {
  const statuses = new Map(logs.map((log) => [log.date, log.status]))
  let cursor = statuses.get(today) === 'taken' ? today : addDays(today, -1)
  let streak = 0
  while (statuses.get(cursor) === 'taken') {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}
