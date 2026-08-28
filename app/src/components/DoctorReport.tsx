import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  db,
  getHealthProfile,
  getOvulations,
  getPeriodStarts,
  getSetting,
  SK,
} from '../db/schema'
import { predict } from '../engine/cycle'
import { buildCycleReport } from '../engine/patterns'
import { applyPredictionContext } from '../engine/predictionContext'
import {
  completedCycles,
  irregularity,
  symptomFrequency,
  trackingCompleteness,
} from '../engine/stats'
import {
  DEFAULT_RANGE_PRESET,
  describeRange,
  filterByRange,
  filterDatesByRange,
  isISODate,
  RANGE_PRESETS,
  rangeLengthDays,
  resolveRange,
  type RangePresetId,
} from '../lib/dateRange'
import { formatShort, localToday } from '../lib/dates'
import { exportCurrentReport } from '../native/reportExport'
import { useApp } from '../state/appStore'
import '../styles/reports.css'

function countItems(values: string[][]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of values) {
    for (const value of [...new Set(row)]) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function DoctorReport() {
  const setReportOpen = useApp((s) => s.setReportOpen)
  const [includeMentalHealth, setIncludeMentalHealth] = useState(false)
  const [includeSexualHealth, setIncludeSexualHealth] = useState(false)
  const [includeFertilityTests, setIncludeFertilityTests] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const today = localToday()
  const [preset, setPreset] = useState<RangePresetId>(DEFAULT_RANGE_PRESET)
  const [customStart, setCustomStart] = useState(today)
  const [customEnd, setCustomEnd] = useState(today)

  const data = useLiveQuery(async () => {
    const [allPeriodStarts, allOvulations, allLogs, legacyBirthYear, cycleLength, profile] =
      await Promise.all([
        getPeriodStarts(),
        getOvulations(),
        db.dailyLogs.toArray(),
        getSetting(SK.birthYear),
        getSetting(SK.cycleLength),
        getHealthProfile(),
      ])

    const earliestEntry =
      [...allLogs.map((log) => log.date)].sort()[0] ?? null
    const range = resolveRange({
      preset,
      today,
      custom: { start: customStart, end: customEnd },
      earliestEntry,
    })

    // Everything below describes the selected window only, so the exported
    // document and the numbers in it always refer to the same span.
    const logs = filterByRange(allLogs, range)
    const periodStarts = filterDatesByRange(allPeriodStarts, range)
    // The forecast is about what comes next, so it deliberately keeps the full
    // history: narrowing the report window must not degrade the estimate.
    const rawPrediction = predict(
      { periodStarts: allPeriodStarts, ovulations: allOvulations, today },
      { baselineCycleLength: Number(cycleLength) || profile.cycle.typicalCycleLength || undefined },
    )
    const contextualPrediction = applyPredictionContext(rawPrediction, profile, {
      completedCycles: completedCycles(allPeriodStarts).length,
      bbtShiftEstimateCount: allOvulations.length,
      positiveOpkThisCycle: allLogs.some((log) => log.date === today && log.opk === 'positive'),
    })
    // Statistics are anchored to the end of the selected window, not to today,
    // so a historical range is not reported as mostly-unlogged.
    const report = buildCycleReport(logs, periodStarts, range.end)
    const dates = logs.map((log) => log.date).sort()
    const fertilityTests = countItems(
      logs.map((log) => [
        ...(log.opk ? [`OPK: ${log.opk}`] : []),
        ...(log.pregnancyTest ? [`Pregnancy test: ${log.pregnancyTest}`] : []),
      ]),
    )
    return {
      birthYear: profile.birthYear ? String(profile.birthYear) : legacyBirthYear,
      prediction: contextualPrediction,
      profile,
      report,
      irregular: irregularity(periodStarts),
      symptoms: symptomFrequency(
        logs.map((log) => ({ symptoms: log.symptoms })),
      ).slice(0, 8),
      moods: countItems(logs.map((log) => log.moods ?? [])).slice(0, 8),
      intimacy: countItems(
        logs.map((log) => log.intimacyEvents ?? (log.sex ? [log.sex] : [])),
      ).slice(0, 8),
      fertilityTests: fertilityTests.slice(0, 8),
      periodCount: periodStarts.length,
      firstLogDate: dates[0] ?? null,
      lastLogDate: dates.at(-1) ?? null,
      range,
      // Coverage is measured over the window the report claims to cover, so a
      // 30-day report is not scored against a fixed 90-day denominator.
      rangeCompleteness: trackingCompleteness(logs, range.end, rangeLengthDays(range)),
      loggedDaysInRange: new Set(dates).size,
      totalLoggedDays: new Set(allLogs.map((log) => log.date)).size,
      excludedLogCount: allLogs.length - logs.length,
      earliestEntry,
    }
  }, [today, preset, customStart, customEnd])

  if (!data) return null
  const age = data.birthYear ? new Date().getFullYear() - Number(data.birthYear) : null

  async function exportReport() {
    setExportError(null)
    try {
      await exportCurrentReport('Ruby doctor report')
    } catch {
      setExportError('The report export sheet could not open. Please try again.')
    }
  }

  return (
    <div className="overlay">
      <div className="overlay-head no-print">
        <button className="back-btn" onClick={() => setReportOpen(false)} aria-label="Back">
          ‹
        </button>
        <h2>Doctor’s report</h2>
        <button className="back-btn" onClick={() => void exportReport()} aria-label="Export report">
          ⎙
        </button>
      </div>
      <div className="overlay-body">
        {exportError && (
          <p className="report-export-error no-print" role="alert">
            {exportError}
          </p>
        )}
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Cycle summary</h1>
        <p className="muted" style={{ marginBottom: 6 }}>
          Generated {formatShort(today)} {age ? `· age ${age}` : ''} · from self-reported data
        </p>
        <p className="report-range-caption">
          Covering {describeRange(data.range)}
        </p>

        <div className="doctor-controls no-print">
          <strong>Date range</strong>
          <div className="range-preset-row" role="group" aria-label="Report date range">
            {RANGE_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`range-chip ${preset === option.id ? 'selected' : ''}`}
                aria-pressed={preset === option.id}
                onClick={() => {
                  // Seed the custom fields from the window already on screen so
                  // switching to Custom starts from what the reader just saw.
                  if (option.id === 'custom') {
                    setCustomStart(data.range.start)
                    setCustomEnd(data.range.end)
                  }
                  setPreset(option.id)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="range-custom-row">
              <label className="range-date-field">
                <span>From</span>
                <input
                  type="date"
                  value={customStart}
                  max={today}
                  onChange={(event) => {
                    if (isISODate(event.target.value)) setCustomStart(event.target.value)
                  }}
                />
              </label>
              <label className="range-date-field">
                <span>To</span>
                <input
                  type="date"
                  value={customEnd}
                  max={today}
                  onChange={(event) => {
                    if (isISODate(event.target.value)) setCustomEnd(event.target.value)
                  }}
                />
              </label>
            </div>
          )}
          <p className="range-summary">
            {data.loggedDaysInRange} logged {data.loggedDaysInRange === 1 ? 'day' : 'days'} in this
            window of {rangeLengthDays(data.range)}
            {data.excludedLogCount > 0 && (
              <> · {data.excludedLogCount} entries outside it are not included</>
            )}
            {data.earliestEntry && (
              <> · tracking began {formatShort(data.earliestEntry)}</>
            )}
          </p>
        </div>

        <div className="doctor-controls no-print">
          <strong>Sensitive sections to include</strong>
          <label className="doctor-control">
            <span>Mood and mental-health entries</span>
            <input
              type="checkbox"
              checked={includeMentalHealth}
              onChange={(event) => setIncludeMentalHealth(event.target.checked)}
            />
          </label>
          <label className="doctor-control">
            <span>Sexual and intimacy entries</span>
            <input
              type="checkbox"
              checked={includeSexualHealth}
              onChange={(event) => setIncludeSexualHealth(event.target.checked)}
            />
          </label>
          <label className="doctor-control">
            <span>Pregnancy and ovulation test entries</span>
            <input
              type="checkbox"
              checked={includeFertilityTests}
              onChange={(event) => setIncludeFertilityTests(event.target.checked)}
            />
          </label>
        </div>

        <div className="section-label" style={{ margin: '18px 0 10px' }}>
          Report metadata
        </div>
        <ReportRow label="Selected range" value={describeRange(data.range)} />
        <ReportRow
          label="Entries within range"
          value={
            data.firstLogDate && data.lastLogDate
              ? `${formatShort(data.firstLogDate)}–${formatShort(data.lastLogDate)} · ${data.loggedDaysInRange} days`
              : 'No dated entries'
          }
        />
        <ReportRow
          label="Complete check-ins · selected range"
          value={`${data.rangeCompleteness.completeCheckInDays} of ${data.rangeCompleteness.windowDays} days (${data.rangeCompleteness.completeCoveragePercent}%)`}
        />
        <ReportRow
          label="Any-entry days · selected range"
          value={`${data.rangeCompleteness.daysWithAnyEntry} of ${data.rangeCompleteness.windowDays} days (${data.rangeCompleteness.entryCoveragePercent}%)`}
        />
        <ReportRow
          label="Current contraception context"
          value={data.profile.reproductive.contraception.replaceAll('-', ' ')}
        />

        <div className="section-label" style={{ margin: '24px 0 10px' }}>
          Cycle history
        </div>
        <ReportRow label="Periods logged" value={String(data.periodCount)} />
        <ReportRow
          label="Six-cycle average"
          value={
            data.report.cycleWindows.six.averageDays != null
              ? `${data.report.cycleWindows.six.averageDays} days (${data.report.cycleWindows.six.sampleSize} available)`
              : '—'
          }
        />
        <ReportRow
          label="Twelve-cycle average"
          value={
            data.report.cycleWindows.twelve.averageDays != null
              ? `${data.report.cycleWindows.twelve.averageDays} days (${data.report.cycleWindows.twelve.sampleSize} available)`
              : '—'
          }
        />
        <ReportRow
          label="Average bleeding"
          value={
            data.report.bleedingTrend.averageDays != null
              ? `${data.report.bleedingTrend.averageDays} logged days`
              : '—'
          }
        />
        <ReportRow
          label="Cycle regularity"
          value={
            data.irregular.classification === 'insufficient-data'
              ? 'Not enough data'
              : `${data.irregular.classification} (range ${data.irregular.rangeDays}d)`
          }
        />
        <ReportRow
          label="Next period (estimate)"
          value={
            !data.prediction.eligibility.periodForecast
              ? 'Paused for current context'
              : data.prediction.prediction.nextPeriodStart
                ? `${formatShort(data.prediction.prediction.nextPeriodStart)} ±${data.prediction.prediction.uncertaintyDays}d`
                : '—'
          }
        />

        <div className="section-label" style={{ margin: '24px 0 10px' }}>
          Most-reported physical symptoms
        </div>
        {data.symptoms.length ? (
          data.symptoms.map((s) => <ReportRow key={s.name} label={s.name} value={`${s.count}×`} />)
        ) : (
          <p className="muted">None logged.</p>
        )}

        <div className="section-label" style={{ margin: '24px 0 10px' }}>
          Symptom-phase summary
        </div>
        {data.report.symptomPhaseSummaries.length ? (
          data.report.symptomPhaseSummaries.slice(0, 8).map((summary) => (
            <ReportRow
              key={`${summary.signal}-${summary.phase}`}
              label={`${summary.signal} · ${summary.phase}`}
              value={`${summary.occurrences}/${summary.completedCheckInsInPhase} complete check-ins`}
            />
          ))
        ) : (
          <p className="muted">Not enough complete check-ins for a phase comparison.</p>
        )}

        {includeMentalHealth && (
          <>
            <div className="section-label" style={{ margin: '24px 0 10px' }}>
              Mood and mental-health entries
            </div>
            {data.moods.length
              ? data.moods.map((item) => (
                  <ReportRow key={item.name} label={item.name} value={`${item.count} days`} />
                ))
              : <p className="muted">None logged.</p>}
          </>
        )}

        {includeSexualHealth && (
          <>
            <div className="section-label" style={{ margin: '24px 0 10px' }}>
              Sexual and intimacy entries
            </div>
            {data.intimacy.length
              ? data.intimacy.map((item) => (
                  <ReportRow
                    key={item.name}
                    label={item.name.replaceAll('-', ' ')}
                    value={`${item.count} days`}
                  />
                ))
              : <p className="muted">None logged.</p>}
          </>
        )}

        {includeFertilityTests && (
          <>
            <div className="section-label" style={{ margin: '24px 0 10px' }}>
              Fertility-test observations
            </div>
            {data.fertilityTests.length
              ? data.fertilityTests.map((item) => (
                  <ReportRow key={item.name} label={item.name} value={`${item.count} days`} />
                ))
              : <p className="muted">None logged.</p>}
          </>
        )}

        <div className="doctor-methodology">
          <strong>Methodology and limits</strong>
          <br />
          Every figure above except the next-period estimate describes only{' '}
          {describeRange(data.range)}; the estimate uses the full logged history. A shorter window
          means fewer completed cycles, not a change in the underlying data.{' '}
          {data.report.methodology} The six- and twelve-cycle values include only completed
          start-to-start cycles. Consecutive dates with a selected flow level are treated as one
          bleeding episode. BBT and OPK are observations and do not confirm an exact ovulation
          time. The current contraception context is not applied backward because no start date
          was recorded.
        </div>

        <p className="muted" style={{ marginTop: 18, lineHeight: 1.5 }}>
          This summary is for discussion with a healthcare provider. Ruby is not a medical
          device, does not diagnose a condition, and does not establish why a pattern occurred.
          Bring original dates and details when they matter clinically.
        </p>
      </div>
    </div>
  )
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <span className="muted" style={{ fontWeight: 700 }}>
        {value}
      </span>
    </div>
  )
}
