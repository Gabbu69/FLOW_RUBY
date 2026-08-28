import { addDays, daysBetween, type ISODate } from './cycle'

export type PregnancyDatingMethod =
  | 'clinician-edd'
  | 'lmp'
  | 'conception'
  | 'ivf-day-3'
  | 'ivf-day-5'

export interface PregnancyDatingInput {
  method: PregnancyDatingMethod
  /**
   * LMP, conception, or embryo-transfer date for calculated methods; the
   * clinician-assigned estimated due date for `clinician-edd`.
   */
  date: ISODate
  clinicianConfirmed?: boolean
}

export interface PregnancyDatingResult {
  method: PregnancyDatingMethod
  inputDate: ISODate
  estimatedDueDate: ISODate
  /** A synthetic gestational day zero used for a consistent week/day display. */
  gestationalStart: ISODate
  authority: 'clinician-assigned' | 'art-derived' | 'user-estimated'
  provisional: boolean
  explanation: string
}

export interface PregnancyTimeline {
  week: number
  dayOfWeek: number
  trimester: 1 | 2 | 3
  daysRemaining: number
  estimatedDueDate: ISODate
  dating: PregnancyDatingResult
}

const DAYS_FROM_LMP_TO_EDD = 280
const DAYS_FROM_CONCEPTION_TO_EDD = 266
const DAYS_FROM_DAY_3_TRANSFER_TO_EDD = 263
const DAYS_FROM_DAY_5_TRANSFER_TO_EDD = 261

/**
 * Resolve a single dating input without silently replacing it with another
 * source. A clinician-assigned EDD is accepted directly; calculated dates stay
 * visibly provisional so users know to update them after clinical dating.
 *
 * ART constants follow the standard embryo-age adjustment: day-3 transfer
 * date +263 days, day-5 transfer date +261 days.
 */
export function resolvePregnancyDating(
  input: PregnancyDatingInput,
): PregnancyDatingResult {
  const clinicianAssigned =
    input.method === 'clinician-edd' || input.clinicianConfirmed === true

  let estimatedDueDate: ISODate
  let authority: PregnancyDatingResult['authority']
  let explanation: string

  switch (input.method) {
    case 'clinician-edd':
      estimatedDueDate = input.date
      authority = 'clinician-assigned'
      explanation =
        'This is the due date assigned by your clinician. Ruby uses it as the current timeline anchor.'
      break
    case 'conception':
      estimatedDueDate = addDays(input.date, DAYS_FROM_CONCEPTION_TO_EDD)
      authority = clinicianAssigned ? 'clinician-assigned' : 'user-estimated'
      explanation =
        'This estimate adds 266 days to the conception date. A clinician may revise it using ultrasound or other records.'
      break
    case 'ivf-day-3':
      estimatedDueDate = addDays(input.date, DAYS_FROM_DAY_3_TRANSFER_TO_EDD)
      authority = clinicianAssigned ? 'clinician-assigned' : 'art-derived'
      explanation =
        'This estimate uses the embryo transfer date and a day-3 embryo age. Your fertility clinic’s assigned due date takes precedence.'
      break
    case 'ivf-day-5':
      estimatedDueDate = addDays(input.date, DAYS_FROM_DAY_5_TRANSFER_TO_EDD)
      authority = clinicianAssigned ? 'clinician-assigned' : 'art-derived'
      explanation =
        'This estimate uses the embryo transfer date and a day-5 embryo age. Your fertility clinic’s assigned due date takes precedence.'
      break
    case 'lmp':
    default:
      estimatedDueDate = addDays(input.date, DAYS_FROM_LMP_TO_EDD)
      authority = clinicianAssigned ? 'clinician-assigned' : 'user-estimated'
      explanation =
        'This provisional estimate adds 280 days to the first day of the last menstrual period. It assumes conventional cycle timing and may be revised clinically.'
      break
  }

  return {
    method: input.method,
    inputDate: input.date,
    estimatedDueDate,
    gestationalStart: addDays(estimatedDueDate, -DAYS_FROM_LMP_TO_EDD),
    authority,
    provisional: authority !== 'clinician-assigned',
    explanation,
  }
}

/**
 * Pick the strongest explicitly supplied source. The order is intentional:
 * clinician-assigned EDD, clinic-confirmed ART dating, other ART dating,
 * conception, then LMP. Nothing is inferred from symptoms or cycle logs.
 */
export function selectPregnancyDating(
  inputs: PregnancyDatingInput[],
): PregnancyDatingResult | null {
  if (inputs.length === 0) return null

  const priority = (input: PregnancyDatingInput): number => {
    if (input.method === 'clinician-edd') return 5
    if (
      input.clinicianConfirmed &&
      (input.method === 'ivf-day-3' || input.method === 'ivf-day-5')
    ) {
      return 4
    }
    if (input.method === 'ivf-day-3' || input.method === 'ivf-day-5') return 3
    if (input.method === 'conception') return 2
    return 1
  }

  const selected = [...inputs].sort((left, right) => priority(right) - priority(left))[0]
  return resolvePregnancyDating(selected)
}

export function pregnancyTimeline(
  datingInput: PregnancyDatingInput | PregnancyDatingResult,
  today: ISODate,
): PregnancyTimeline | null {
  const dating =
    'estimatedDueDate' in datingInput
      ? datingInput
      : resolvePregnancyDating(datingInput)
  const elapsed = daysBetween(dating.gestationalStart, today)
  if (elapsed < 0 || elapsed > DAYS_FROM_LMP_TO_EDD + 21) return null

  const week = Math.floor(elapsed / 7)
  return {
    week,
    dayOfWeek: elapsed % 7,
    trimester: week < 14 ? 1 : week < 28 ? 2 : 3,
    daysRemaining: Math.max(daysBetween(today, dating.estimatedDueDate), 0),
    estimatedDueDate: dating.estimatedDueDate,
    dating,
  }
}

