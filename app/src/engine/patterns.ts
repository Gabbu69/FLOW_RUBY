import { dailyLogHasEntry, type DailyLog } from '../db/schema'
import {
  addDays,
  averageCycleLength,
  daysBetween,
  toEpochDay,
  type ISODate,
} from './cycle'
import {
  bleedingTrend,
  completedCycles,
  cycleWindowStatistics,
  fertilitySignalSeries,
  periodEpisodes,
  symptomFrequency,
  trackingCompleteness,
  type BleedingTrendSummary,
  type CycleWindowStatistics,
  type FertilitySignalPoint,
  type TrackingCompleteness,
} from './stats'

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal'
export type PatternConfidence = 'early' | 'developing' | 'established'
export type PatternKind = 'phase-association' | 'cycle-day-cluster' | 'co-occurrence'

export interface PatternEvidence {
  occurrences: number
  cyclesObserved: number
  loggedDaysCompared: number
  phase?: CyclePhase
  phaseRate?: number
  baselineRate?: number
  cycleDayRange?: { start: number; end: number }
  pairedSignal?: string
}

export interface PatternInsight {
  id: string
  kind: PatternKind
  signal: string
  title: string
  summary: string
  confidence: PatternConfidence
  evidence: PatternEvidence
  /**
   * Plain-language account of the exact rule that produced the card. This is
   * intentionally suitable for showing behind a “Why am I seeing this?” link.
   */
  explanation: string
}

export interface PatternOptions {
  minOccurrences?: number
  minCycles?: number
  maxInsights?: number
}

export interface CycleReport {
  generatedOn: ISODate
  completedCycleCount: number
  averageCycleDays: number | null
  shortestCycleDays: number | null
  longestCycleDays: number | null
  averageBleedingDays: number | null
  loggedDaysLast90: number
  trackingCoverageLast90: number
  topSignals: { name: string; count: number }[]
  cycleWindows: {
    six: CycleWindowStatistics
    twelve: CycleWindowStatistics
  }
  bleedingTrend: BleedingTrendSummary
  completeness: TrackingCompleteness
  symptomPhaseSummaries: SymptomPhaseSummary[]
  fertilitySignals: FertilitySignalPoint[]
  patterns: PatternInsight[]
  methodology: string
}

export interface SymptomPhaseSummary {
  signal: string
  phase: CyclePhase
  occurrences: number
  completedCheckInsInPhase: number
  rate: number
  cyclesObserved: number
  summary: string
  methodology: string
}

interface CycleContext {
  key: ISODate
  day: number
  length: number
  phase: CyclePhase
}

interface SignalObservation {
  date: ISODate
  signal: string
  context: CycleContext
}

const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'during bleeding days',
  follicular: 'in the follicular phase',
  ovulatory: 'around the estimated ovulation window',
  luteal: 'in the late-cycle phase',
}

function uniqueSorted(dates: ISODate[]): ISODate[] {
  return [...new Set(dates)].sort()
}

function signalsFor(log: DailyLog): string[] {
  return [
    ...(log.symptoms ?? []),
    ...(log.moods ?? []),
    ...(log.events ?? []),
  ].filter((signal, index, all) => all.indexOf(signal) === index)
}

function hasAnyEntry(log: DailyLog): boolean {
  return dailyLogHasEntry(log)
}

/**
 * Assign a date to a phase only when both bounds of that historical cycle are
 * known. The ovulatory window is an estimate (cycle length −14, ±2 days);
 * confirmed OPK/BBT dates belong in the fertility engine, not this descriptive
 * pattern detector.
 */
export function cycleContext(periodStarts: ISODate[], date: ISODate): CycleContext | null {
  const starts = uniqueSorted(periodStarts)
  const epoch = toEpochDay(date)
  for (let index = 0; index < starts.length - 1; index++) {
    const start = starts[index]
    const next = starts[index + 1]
    if (epoch < toEpochDay(start) || epoch >= toEpochDay(next)) continue

    const length = daysBetween(start, next)
    const day = daysBetween(start, date) + 1
    const estimatedOvulationDay = Math.max(6, length - 14)
    let phase: CyclePhase
    if (day <= 5) phase = 'menstrual'
    else if (day < estimatedOvulationDay - 2) phase = 'follicular'
    else if (day <= estimatedOvulationDay + 1) phase = 'ovulatory'
    else phase = 'luteal'
    return { key: start, day, length, phase }
  }
  return null
}

function confidenceFor(occurrences: number, cycles: number): PatternConfidence {
  if (occurrences >= 10 && cycles >= 4) return 'established'
  if (occurrences >= 6 && cycles >= 3) return 'developing'
  return 'early'
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * p)]
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/**
 * Finds descriptive, local-only patterns. It never infers a condition and
 * never treats an unlogged day as a symptom-free day. Every comparison is
 * explicitly among days on which the user entered something.
 */
export function analyzePatterns(
  logs: DailyLog[],
  periodStarts: ISODate[],
  options: PatternOptions = {},
): PatternInsight[] {
  const { minOccurrences = 3, minCycles = 2, maxInsights = 12 } = options
  const eligibleDays = logs
    .filter((log) => log.checkInComplete === true)
    .map((log) => ({ log, context: cycleContext(periodStarts, log.date) }))
    .filter(
      (item): item is { log: DailyLog; context: CycleContext } => item.context !== null,
    )

  const observations: SignalObservation[] = eligibleDays.flatMap(({ log, context }) =>
    signalsFor(log).map((signal) => ({ date: log.date, signal, context })),
  )
  const bySignal = new Map<string, SignalObservation[]>()
  for (const observation of observations) {
    const list = bySignal.get(observation.signal) ?? []
    list.push(observation)
    bySignal.set(observation.signal, list)
  }

  const phaseDayCounts = new Map<CyclePhase, number>()
  for (const { context } of eligibleDays) {
    phaseDayCounts.set(context.phase, (phaseDayCounts.get(context.phase) ?? 0) + 1)
  }

  const insights: PatternInsight[] = []
  for (const [signal, signalObservations] of bySignal) {
    const cycles = new Set(signalObservations.map((item) => item.context.key))
    if (signalObservations.length < minOccurrences || cycles.size < minCycles) continue

    const phaseCounts = new Map<CyclePhase, number>()
    for (const observation of signalObservations) {
      phaseCounts.set(
        observation.context.phase,
        (phaseCounts.get(observation.context.phase) ?? 0) + 1,
      )
    }

    const phases: CyclePhase[] = ['menstrual', 'follicular', 'ovulatory', 'luteal']
    const phaseRates = phases.map((phase) => ({
      phase,
      count: phaseCounts.get(phase) ?? 0,
      days: phaseDayCounts.get(phase) ?? 0,
      rate: (phaseCounts.get(phase) ?? 0) / Math.max(phaseDayCounts.get(phase) ?? 0, 1),
    }))
    phaseRates.sort((a, b) => b.rate - a.rate || b.count - a.count)
    const peak = phaseRates[0]
    const baselineRate = signalObservations.length / Math.max(eligibleDays.length, 1)

    if (
      peak.count >= 2 &&
      peak.days >= 3 &&
      peak.rate >= baselineRate * 1.35 &&
      peak.rate - baselineRate >= 0.08
    ) {
      const percent = Math.round(peak.rate * 100)
      const baselinePercent = Math.round(baselineRate * 100)
      insights.push({
        id: `phase-${safeId(signal)}-${peak.phase}`,
        kind: 'phase-association',
        signal,
        title: `${signal} shows up ${PHASE_LABEL[peak.phase]}`,
        summary: `It appeared on ${percent}% of your logged ${peak.phase} days, compared with ${baselinePercent}% of logged days overall.`,
        confidence: confidenceFor(signalObservations.length, cycles.size),
        evidence: {
          occurrences: signalObservations.length,
          cyclesObserved: cycles.size,
          loggedDaysCompared: eligibleDays.length,
          phase: peak.phase,
          phaseRate: peak.rate,
          baselineRate,
        },
        explanation: `Ruby compared ${signalObservations.length} ${signal.toLowerCase()} entries across ${cycles.size} completed cycles, using only check-ins you marked complete. The card appears because the complete-check-in rate in one phase was at least 35% higher than its overall rate.`,
      })
    }

    const days = signalObservations.map((observation) => observation.context.day)
    const q1 = percentile(days, 0.25)
    const q3 = percentile(days, 0.75)
    if (cycles.size >= Math.max(3, minCycles) && q3 - q1 <= 4) {
      insights.push({
        id: `cluster-${safeId(signal)}`,
        kind: 'cycle-day-cluster',
        signal,
        title: `${signal} tends to cluster around cycle days ${q1}–${q3}`,
        summary: `The middle half of your ${signal.toLowerCase()} entries fell in this ${q3 - q1 + 1}-day window.`,
        confidence: confidenceFor(signalObservations.length, cycles.size),
        evidence: {
          occurrences: signalObservations.length,
          cyclesObserved: cycles.size,
          loggedDaysCompared: eligibleDays.length,
          cycleDayRange: { start: q1, end: q3 },
        },
        explanation: `This uses the interquartile range, which ignores the earliest and latest quarter of entries so one unusual day does not move the pattern much.`,
      })
    }
  }

  const pairCounts = new Map<string, { left: string; right: string; count: number; cycles: Set<string> }>()
  for (const { log, context } of eligibleDays) {
    const signals = signalsFor(log).sort()
    for (let leftIndex = 0; leftIndex < signals.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < signals.length; rightIndex++) {
        const left = signals[leftIndex]
        const right = signals[rightIndex]
        const key = `${left}\u0000${right}`
        const pair = pairCounts.get(key) ?? { left, right, count: 0, cycles: new Set<string>() }
        pair.count += 1
        pair.cycles.add(context.key)
        pairCounts.set(key, pair)
      }
    }
  }
  for (const pair of pairCounts.values()) {
    const leftCount = bySignal.get(pair.left)?.length ?? 0
    const rightCount = bySignal.get(pair.right)?.length ?? 0
    const support = pair.count / Math.max(Math.min(leftCount, rightCount), 1)
    if (pair.count < minOccurrences || pair.cycles.size < minCycles || support < 0.5) continue
    insights.push({
      id: `pair-${safeId(pair.left)}-${safeId(pair.right)}`,
      kind: 'co-occurrence',
      signal: pair.left,
      title: `${pair.left} and ${pair.right} often share a day`,
      summary: `They were logged together ${pair.count} times across ${pair.cycles.size} cycles.`,
      confidence: confidenceFor(pair.count, pair.cycles.size),
      evidence: {
        occurrences: pair.count,
        cyclesObserved: pair.cycles.size,
        loggedDaysCompared: eligibleDays.length,
        pairedSignal: pair.right,
      },
      explanation: `The pair appeared together on at least half of the logged days containing the less-frequent signal. This is an association in your entries, not evidence that one causes the other.`,
    })
  }

  const confidenceRank: Record<PatternConfidence, number> = {
    established: 3,
    developing: 2,
    early: 1,
  }
  return insights
    .sort(
      (a, b) =>
        confidenceRank[b.confidence] - confidenceRank[a.confidence] ||
        b.evidence.occurrences - a.evidence.occurrences ||
        a.title.localeCompare(b.title),
    )
    .slice(0, maxInsights)
}

/**
 * Produces direct symptom-by-phase rates from explicit complete check-ins.
 * Unlike a pattern card, this table can show a low-sample summary and exposes
 * its denominator so the reader can judge how much evidence is present.
 */
export function symptomPhaseSummaries(
  logs: DailyLog[],
  periodStarts: ISODate[],
  maxSignals = 8,
): SymptomPhaseSummary[] {
  const completed = logs
    .filter((log) => log.checkInComplete === true)
    .map((log) => ({ log, context: cycleContext(periodStarts, log.date) }))
    .filter(
      (item): item is { log: DailyLog; context: CycleContext } => item.context !== null,
    )
  const denominators = new Map<CyclePhase, number>()
  for (const item of completed) {
    denominators.set(item.context.phase, (denominators.get(item.context.phase) ?? 0) + 1)
  }
  const bySignal = new Map<
    string,
    Map<CyclePhase, { count: number; cycles: Set<ISODate> }>
  >()
  for (const { log, context } of completed) {
    for (const signal of [...new Set(log.symptoms ?? [])]) {
      const phases = bySignal.get(signal) ?? new Map()
      const phase = phases.get(context.phase) ?? { count: 0, cycles: new Set<ISODate>() }
      phase.count += 1
      phase.cycles.add(context.key)
      phases.set(context.phase, phase)
      bySignal.set(signal, phases)
    }
  }

  const summaries: SymptomPhaseSummary[] = []
  for (const [signal, phases] of bySignal) {
    let best:
      | { phase: CyclePhase; count: number; cycles: Set<ISODate>; denominator: number; rate: number }
      | undefined
    for (const [phase, evidence] of phases) {
      const denominator = denominators.get(phase) ?? 0
      const candidate = {
        phase,
        count: evidence.count,
        cycles: evidence.cycles,
        denominator,
        rate: evidence.count / Math.max(denominator, 1),
      }
      if (
        !best ||
        candidate.rate > best.rate ||
        (candidate.rate === best.rate && candidate.count > best.count)
      ) {
        best = candidate
      }
    }
    if (!best) continue
    summaries.push({
      signal,
      phase: best.phase,
      occurrences: best.count,
      completedCheckInsInPhase: best.denominator,
      rate: best.rate,
      cyclesObserved: best.cycles.size,
      summary: `${signal} was selected on ${best.count} of ${best.denominator} complete ${best.phase} check-ins (${Math.round(best.rate * 100)}%).`,
      methodology:
        'Only check-ins explicitly marked complete are included. This is a description of your entries, not evidence that the cycle phase caused the symptom.',
    })
  }

  return summaries
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        b.cyclesObserved - a.cyclesObserved ||
        a.signal.localeCompare(b.signal),
    )
    .slice(0, maxSignals)
}

export function buildCycleReport(
  logs: DailyLog[],
  periodStarts: ISODate[],
  today: ISODate,
): CycleReport {
  const cycles = completedCycles(uniqueSorted(periodStarts))
  const lengths = cycles.map((cycle) => cycle.length)
  const episodes = periodEpisodes(logs.filter((log) => log.flow).map((log) => log.date))
  const windowStart = addDays(today, -89)
  const loggedDaysLast90 = new Set(
    logs
      .filter(
        (log) =>
          hasAnyEntry(log) &&
          toEpochDay(log.date) >= toEpochDay(windowStart) &&
          toEpochDay(log.date) <= toEpochDay(today),
      )
      .map((log) => log.date),
  ).size
  const completeness = trackingCompleteness(
    logs.filter(hasAnyEntry),
    today,
    90,
  )

  return {
    generatedOn: today,
    completedCycleCount: cycles.length,
    averageCycleDays: lengths.length ? Math.round(averageCycleLength(periodStarts)) : null,
    shortestCycleDays: lengths.length ? Math.min(...lengths) : null,
    longestCycleDays: lengths.length ? Math.max(...lengths) : null,
    averageBleedingDays: episodes.length
      ? Math.round((episodes.reduce((sum, episode) => sum + episode.days, 0) / episodes.length) * 10) /
        10
      : null,
    loggedDaysLast90,
    trackingCoverageLast90: Math.round((loggedDaysLast90 / 90) * 100),
    topSignals: symptomFrequency(logs).slice(0, 8),
    cycleWindows: {
      six: cycleWindowStatistics(periodStarts, 6),
      twelve: cycleWindowStatistics(periodStarts, 12),
    },
    bleedingTrend: bleedingTrend(logs, 12),
    completeness,
    symptomPhaseSummaries: symptomPhaseSummaries(logs, periodStarts),
    fertilitySignals: fertilitySignalSeries(logs, periodStarts),
    patterns: analyzePatterns(logs, periodStarts),
    methodology:
      'Cycle statistics use completed cycles. Symptom-phase comparisons use only check-ins explicitly marked complete. Missing days are never filled in or treated as symptom-free. Associations describe your logs; they do not establish a cause or diagnose a condition.',
  }
}
