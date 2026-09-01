import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  adherenceStreak,
  createDoseLog,
  localDateTime,
  pillDoseDeadline,
  pillDoseTiming,
  reconcileDoseLogs,
  type PillDoseLog,
  type PillSchedule,
} from '../db/pillTracker'
import { db } from '../db/schema'
import { addDays } from '../engine/cycle'
import { localToday } from '../lib/dates'
import {
  requestPillReminderPermission,
  syncPillReminders,
} from '../native/notifications'

interface PillTrackerCardProps {
  selectedDate: string
}

interface ScheduleDraft {
  product: string
  dose: string
  scheduledTime: string
  graceMinutes: string
  startDate: string
  reminderEnabled: boolean
}

function draftFrom(schedule?: PillSchedule): ScheduleDraft {
  return {
    product: schedule?.product ?? 'Birth-control pill',
    dose: schedule?.dose ?? '',
    scheduledTime: schedule?.scheduledTime ?? '21:00',
    graceMinutes: String(schedule?.graceMinutes ?? 60),
    startDate: schedule?.startDate ?? localToday(),
    reminderEnabled: schedule?.reminderEnabled ?? true,
  }
}

function shortTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dayLabel(date: string): string {
  return localDateTime(date, '12:00').toLocaleDateString(undefined, { weekday: 'narrow' })
}

function trackerStatus(
  schedule: PillSchedule,
  log: PillDoseLog | undefined,
  date: string,
  now: Date,
): { label: string; detail: string; tone: 'pending' | 'taken' | 'missed' } {
  if (log?.status === 'taken' && log.takenAt) {
    const timing = pillDoseTiming(schedule, date, log.takenAt)
    return {
      label: timing === 'on-time' ? 'Taken on time' : 'Taken late',
      detail: `Recorded at ${new Date(log.takenAt).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })}`,
      tone: 'taken',
    }
  }
  if (log?.status === 'missed' || log?.status === 'skipped') {
    return {
      label: log.status === 'skipped' ? 'Marked as missed' : 'Dose check-in missed',
      detail: 'Use the instructions supplied with your pill if you miss a dose.',
      tone: 'missed',
    }
  }
  const due = localDateTime(date, schedule.scheduledTime)
  const deadline = pillDoseDeadline(schedule, date)
  if (now < due) {
    return {
      label: `Due at ${shortTime(schedule.scheduledTime)}`,
      detail: 'Ruby will remind you privately.',
      tone: 'pending',
    }
  }
  return {
    label: now <= deadline ? 'Due now' : 'Dose check-in missed',
    detail:
      now <= deadline
        ? `Your ${schedule.graceMinutes}-minute check-in window is open.`
        : 'Use the instructions supplied with your pill if you miss a dose.',
    tone: now <= deadline ? 'pending' : 'missed',
  }
}

export function PillTrackerCard({ selectedDate }: PillTrackerCardProps) {
  const today = localToday()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFrom())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [clock, setClock] = useState(() => new Date())

  const data = useLiveQuery(async () => {
    const [schedule, logs] = await Promise.all([
      db.pillSchedules.get('primary'),
      db.pillDoseLogs.orderBy('date').toArray(),
    ])
    return { schedule, logs }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!data?.schedule) return
    const reconciled = reconcileDoseLogs(data.schedule, data.logs, today)
    if (reconciled.length) void db.pillDoseLogs.bulkPut(reconciled)
  }, [data, today])

  const schedule = data?.schedule
  const selectedLog = data?.logs.find((log) => log.date === selectedDate)
  const historyDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)),
    [today],
  )

  function openSetup() {
    setDraft(draftFrom(schedule))
    setMessage('')
    setEditing(true)
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const product = draft.product.trim()
    const graceMinutes = Number(draft.graceMinutes)
    if (!product || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.scheduledTime)) {
      setMessage('Add a pill name and a valid reminder time.')
      return
    }
    if (!Number.isInteger(graceMinutes) || graceMinutes < 5 || graceMinutes > 720) {
      setMessage('Choose a reminder window from 5 minutes to 12 hours.')
      return
    }

    setBusy(true)
    setMessage('')
    try {
      let reminderEnabled = draft.reminderEnabled
      if (reminderEnabled && (await requestPillReminderPermission()) !== 'granted') {
        reminderEnabled = false
        setMessage('Schedule saved. Notifications are off because permission was not granted.')
      }
      const timestamp = new Date().toISOString()
      const next: PillSchedule = {
        id: 'primary',
        product,
        dose: draft.dose.trim() || undefined,
        scheduledTime: draft.scheduledTime,
        graceMinutes,
        reminderEnabled,
        startDate: draft.startDate,
        createdAt: schedule?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await db.pillSchedules.put(next)
      const reconciled = reconcileDoseLogs(next, data?.logs ?? [], today)
      if (reconciled.length) await db.pillDoseLogs.bulkPut(reconciled)
      await syncPillReminders(next, await db.pillDoseLogs.toArray())
      setEditing(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the pill schedule.')
    } finally {
      setBusy(false)
    }
  }

  async function recordDose(status: 'taken' | 'skipped') {
    if (!schedule || selectedDate > today || selectedDate < schedule.startDate) return
    setBusy(true)
    setMessage('')
    try {
      const now = new Date()
      const base = selectedLog ?? createDoseLog(schedule, selectedDate, status, now)
      const takenAt =
        status === 'taken'
          ? selectedDate === today
            ? now.toISOString()
            : localDateTime(selectedDate, schedule.scheduledTime).toISOString()
          : undefined
      await db.pillDoseLogs.put({
        ...base,
        status,
        takenAt,
        updatedAt: now.toISOString(),
      })
      await syncPillReminders(schedule, await db.pillDoseLogs.toArray())
      setMessage(status === 'taken' ? 'Dose saved.' : 'Missed dose saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record this dose.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return <section className="pill-tracker-card is-loading" aria-label="Loading pill tracker" />
  }

  if (!schedule) {
    return (
      <section className="pill-tracker-card pill-tracker-empty" aria-labelledby="pill-tracker-title">
        <div className="pill-bow" aria-hidden="true"><i /><b /><span /></div>
        <div className="pill-tracker-copy">
          <span className="pill-kicker">DAILY PILL CARE</span>
          <h2 id="pill-tracker-title">Never lose track of your pill</h2>
          <p>Choose a time, get a private reminder, and save every daily check-in.</p>
        </div>
        <button type="button" className="pill-setup-button" onClick={openSetup}>Set up my pill</button>
        {editing ? (
          <PillSetupDialog draft={draft} setDraft={setDraft} busy={busy} message={message} onClose={() => setEditing(false)} onSubmit={saveSchedule} />
        ) : null}
      </section>
    )
  }

  const status = trackerStatus(schedule, selectedLog, selectedDate, clock)
  const canRecord = selectedDate <= today && selectedDate >= schedule.startDate
  const streak = adherenceStreak(data.logs, today)

  return (
    <section className={`pill-tracker-card status-${status.tone}`} aria-labelledby="pill-tracker-title">
      <div className="pill-tracker-topline">
        <div>
          <span className="pill-kicker">MY DAILY PILL</span>
          <h2 id="pill-tracker-title">{schedule.product}</h2>
          <p>{schedule.dose ? `${schedule.dose} · ` : ''}{shortTime(schedule.scheduledTime)} every day</p>
        </div>
        <button type="button" className="pill-settings-button" onClick={openSetup} aria-label="Edit pill schedule">Edit</button>
      </div>

      <div className="pill-today-status">
        <span className="pill-capsule" aria-hidden="true"><i /></span>
        <div><strong>{status.label}</strong><small>{status.detail}</small></div>
        <span className="pill-status-mark" aria-hidden="true">{status.tone === 'taken' ? '✓' : status.tone === 'missed' ? '!' : '♡'}</span>
      </div>

      <div className="pill-actions">
        <button type="button" className="pill-taken-button" disabled={busy || !canRecord} onClick={() => void recordDose('taken')}>
          {selectedLog?.status === 'taken' ? 'Taken ✓' : 'I took it'}
        </button>
        <button type="button" className="pill-missed-button" disabled={busy || !canRecord} onClick={() => void recordDose('skipped')}>I missed it</button>
      </div>

      <div className="pill-week" aria-label={`Seven day adherence. ${streak} day streak.`}>
        {historyDates.map((date) => {
          const log = data.logs.find((item) => item.date === date)
          const historyStatus = log?.status === 'taken' ? 'taken' : log?.status === 'missed' || log?.status === 'skipped' ? 'missed' : 'pending'
          return (
            <span key={date} className={`pill-day is-${historyStatus}`} title={`${date}: ${historyStatus}`}>
              <i>{historyStatus === 'taken' ? '✓' : historyStatus === 'missed' ? '×' : '·'}</i>
              <small>{dayLabel(date)}</small>
            </span>
          )
        })}
        <strong>{streak} day streak</strong>
      </div>
      {message ? <p className="pill-save-message" role="status">{message}</p> : null}
      {selectedDate > today ? (
        <p className="pill-save-message">Future doses can be reviewed but not recorded yet.</p>
      ) : selectedDate < schedule.startDate ? (
        <p className="pill-save-message">Your pill schedule had not started on this date.</p>
      ) : null}
      {editing ? (
        <PillSetupDialog draft={draft} setDraft={setDraft} busy={busy} message={message} onClose={() => setEditing(false)} onSubmit={saveSchedule} />
      ) : null}
    </section>
  )
}

function PillSetupDialog({
  draft,
  setDraft,
  busy,
  message,
  onClose,
  onSubmit,
}: {
  draft: ScheduleDraft
  setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>
  busy: boolean
  message: string
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const dialogRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const firstField = dialogRef.current?.querySelector<HTMLElement>('input:not([type="checkbox"])')
    firstField?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="pill-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form ref={dialogRef} className="pill-dialog" role="dialog" aria-modal="true" aria-labelledby="pill-dialog-title" onSubmit={onSubmit}>
        <div className="pill-dialog-heading">
          <div><span className="pill-kicker">A GENTLE DAILY ROUTINE</span><h2 id="pill-dialog-title">Set up your pill</h2></div>
          <button type="button" onClick={onClose} aria-label="Close pill setup">×</button>
        </div>
        <label><span>Pill name</span><input required value={draft.product} onChange={(event) => setDraft((current) => ({ ...current, product: event.target.value }))} placeholder="e.g. My birth-control pill" /></label>
        <label><span>Dose or note <small>optional</small></span><input value={draft.dose} onChange={(event) => setDraft((current) => ({ ...current, dose: event.target.value }))} placeholder="e.g. one tablet" /></label>
        <div className="pill-dialog-grid">
          <label><span>Take it at</span><input type="time" required value={draft.scheduledTime} onChange={(event) => setDraft((current) => ({ ...current, scheduledTime: event.target.value }))} /></label>
          <label><span>Follow up after</span><select value={draft.graceMinutes} onChange={(event) => setDraft((current) => ({ ...current, graceMinutes: event.target.value }))}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="720">12 hours</option></select></label>
        </div>
        <label><span>Start date</span><input type="date" required max={localToday()} value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label className="pill-reminder-toggle">
          <span><strong>Private reminders</strong><small>Includes a second alert if no dose is recorded.</small></span>
          <input type="checkbox" checked={draft.reminderEnabled} onChange={(event) => setDraft((current) => ({ ...current, reminderEnabled: event.target.checked }))} />
        </label>
        <p className="pill-privacy-note">Notification previews never include your pill name. Your check-ins save on this device first.</p>
        {message ? <p className="pill-dialog-message" role="alert">{message}</p> : null}
        <button type="submit" className="pill-dialog-save" disabled={busy}>{busy ? 'Saving…' : 'Save pill tracker'}</button>
      </form>
    </div>,
    document.body,
  )
}
