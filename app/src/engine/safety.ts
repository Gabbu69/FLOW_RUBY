export type SafetyUrgency = 'none' | 'routine' | 'same-day' | 'emergency'

export type PregnancySafetyStatus = 'none' | 'possible' | 'confirmed'

export interface SafetyTriageInput {
  mentalHealth?: {
    thoughtsOfSelfHarm?: boolean
  }
  bleeding?: {
    /**
     * Number of pads or tampons fully soaked in one hour. Ruby only applies
     * the emergency bleeding rule when this is at least 1 and the duration is
     * explicitly at least 2 consecutive hours.
     */
    soakedProductsPerHour?: number
    consecutiveHours?: number
    dizziness?: boolean
    lightheadedness?: boolean
    chestPain?: boolean
    shortnessOfBreath?: boolean
    betweenPeriods?: boolean
    afterMenopause?: boolean
    durationDays?: number
  }
  pregnancy?: {
    status?: PregnancySafetyStatus
    vaginalBleeding?: boolean
    pelvicPain?: boolean
    fainting?: boolean
    shoulderPain?: boolean
    suddenSeverePelvicPain?: boolean
  }
  pelvicPain?: {
    suddenSevere?: boolean
    persistentOrRecurring?: boolean
  }
}

export type SafetyReasonId =
  | 'self-harm-thoughts'
  | 'very-heavy-bleeding-with-systemic-symptoms'
  | 'possible-pregnancy-emergency-signs'
  | 'possible-pregnancy-bleeding-or-pain'
  | 'very-heavy-bleeding'
  | 'sudden-severe-pelvic-pain'
  | 'bleeding-after-menopause'
  | 'bleeding-between-periods'
  | 'bleeding-longer-than-seven-days'
  | 'persistent-or-recurring-pelvic-pain'

export interface SafetyReason {
  id: SafetyReasonId
  label: string
  detail: string
  sourceIds: SafetySourceId[]
}

export type SafetySourceId =
  | 'ACOG_ABNORMAL_UTERINE_BLEEDING'
  | 'ACOG_BLEEDING_DURING_PREGNANCY'
  | 'ACOG_ECTOPIC_PREGNANCY'
  | 'ACOG_POSTMENOPAUSAL_BLEEDING'
  | 'NIMH_SELF_HARM_CRISIS'

export interface SafetyTriageResult {
  urgency: SafetyUrgency
  headline: string
  action: string
  reasons: SafetyReason[]
  sourceIds: SafetySourceId[]
  caveat: string
}

interface MatchedRule {
  urgency: Exclude<SafetyUrgency, 'none'>
  reason: SafetyReason
}

const URGENCY_RANK: Record<SafetyUrgency, number> = {
  none: 0,
  routine: 1,
  'same-day': 2,
  emergency: 3,
}

const HEADLINES: Record<SafetyUrgency, string> = {
  none: 'No safety rule matched',
  routine: 'Arrange a clinician appointment',
  'same-day': 'Contact a clinician today',
  emergency: 'Seek emergency care now',
}

const ACTIONS: Record<SafetyUrgency, string> = {
  none:
    'Continue monitoring how you feel. If you are worried, symptoms are worsening, or something feels wrong, contact a qualified clinician.',
  routine:
    'Arrange an appointment with a qualified clinician to discuss these symptoms. Seek care sooner if they become severe or you feel unsafe.',
  'same-day':
    'Contact your clinician or an urgent-care service today. Use emergency services if symptoms become severe, you faint, have chest pain, or have trouble breathing.',
  emergency:
    'Contact local emergency services or go to the nearest emergency department now. Do not wait for an app response.',
}

const CAVEAT =
  'This is a limited, non-diagnostic safety screen based only on the answers provided. A lower care level or no match does not mean a symptom is safe, and Ruby cannot rule out an emergency.'

function reason(
  id: SafetyReasonId,
  label: string,
  detail: string,
  sourceIds: SafetySourceId[],
): SafetyReason {
  return { id, label, detail, sourceIds }
}

function hasPossiblePregnancy(input: SafetyTriageInput): boolean {
  return (
    input.pregnancy?.status === 'possible' ||
    input.pregnancy?.status === 'confirmed'
  )
}

function hasHeavyBleedingThreshold(input: SafetyTriageInput): boolean {
  const productsPerHour = input.bleeding?.soakedProductsPerHour
  const consecutiveHours = input.bleeding?.consecutiveHours
  return (
    Number.isFinite(productsPerHour) &&
    Number.isFinite(consecutiveHours) &&
    (productsPerHour ?? 0) >= 1 &&
    (consecutiveHours ?? 0) >= 2
  )
}

function hasBleedingSystemicSymptom(input: SafetyTriageInput): boolean {
  return Boolean(
    input.bleeding?.dizziness ||
      input.bleeding?.lightheadedness ||
      input.bleeding?.chestPain ||
      input.bleeding?.shortnessOfBreath,
  )
}

function matchingRules(input: SafetyTriageInput): MatchedRule[] {
  const matches: MatchedRule[] = []
  const pregnancy = input.pregnancy
  const possiblePregnancy = hasPossiblePregnancy(input)
  const pregnancyBleedingOrPain = Boolean(
    pregnancy?.vaginalBleeding ||
      pregnancy?.pelvicPain ||
      pregnancy?.suddenSeverePelvicPain,
  )
  const pregnancyEmergencySign = Boolean(
    pregnancy?.fainting ||
      pregnancy?.shoulderPain ||
      pregnancy?.suddenSeverePelvicPain,
  )
  const heavyBleeding = hasHeavyBleedingThreshold(input)

  if (input.mentalHealth?.thoughtsOfSelfHarm === true) {
    matches.push({
      urgency: 'emergency',
      reason: reason(
        'self-harm-thoughts',
        'Thoughts of self-harm need immediate human support',
        'Stay with someone you trust if possible, move away from anything you could use to hurt yourself, and seek emergency help now.',
        ['NIMH_SELF_HARM_CRISIS'],
      ),
    })
  }

  if (heavyBleeding && hasBleedingSystemicSymptom(input)) {
    matches.push({
      urgency: 'emergency',
      reason: reason(
        'very-heavy-bleeding-with-systemic-symptoms',
        'Very heavy bleeding with dizziness, chest pain, or breathing symptoms',
        'Soaking at least one pad or tampon an hour for at least two hours together with dizziness, lightheadedness, chest pain, or shortness of breath can require emergency care.',
        ['ACOG_ABNORMAL_UTERINE_BLEEDING'],
      ),
    })
  }

  if (possiblePregnancy && pregnancyBleedingOrPain && pregnancyEmergencySign) {
    matches.push({
      urgency: 'emergency',
      reason: reason(
        'possible-pregnancy-emergency-signs',
        'Possible pregnancy with bleeding or pelvic pain and an emergency warning sign',
        'Fainting, shoulder pain, or sudden severe pelvic pain alongside bleeding or pelvic pain in a possible pregnancy needs emergency assessment.',
        ['ACOG_BLEEDING_DURING_PREGNANCY', 'ACOG_ECTOPIC_PREGNANCY'],
      ),
    })
  }

  if (possiblePregnancy && pregnancyBleedingOrPain) {
    matches.push({
      urgency: 'same-day',
      reason: reason(
        'possible-pregnancy-bleeding-or-pain',
        'Bleeding or pelvic pain during a possible pregnancy',
        'Contact an obstetric clinician or urgent-care service today for individualized assessment.',
        ['ACOG_BLEEDING_DURING_PREGNANCY', 'ACOG_ECTOPIC_PREGNANCY'],
      ),
    })
  }

  if (heavyBleeding) {
    matches.push({
      urgency: 'same-day',
      reason: reason(
        'very-heavy-bleeding',
        'Very heavy bleeding',
        'Soaking at least one pad or tampon an hour for at least two hours warrants prompt clinician guidance even when no systemic warning symptom was selected.',
        ['ACOG_ABNORMAL_UTERINE_BLEEDING'],
      ),
    })
  }

  if (input.pelvicPain?.suddenSevere === true) {
    matches.push({
      urgency: 'same-day',
      reason: reason(
        'sudden-severe-pelvic-pain',
        'Sudden severe pelvic pain',
        'Sudden severe pelvic pain needs prompt in-person assessment. Use emergency services if you faint, have chest pain, have trouble breathing, or symptoms are rapidly worsening.',
        ['ACOG_ECTOPIC_PREGNANCY'],
      ),
    })
  }

  if (input.bleeding?.afterMenopause === true) {
    matches.push({
      urgency: 'same-day',
      reason: reason(
        'bleeding-after-menopause',
        'Bleeding after menopause',
        'Contact a gynecologic clinician today to arrange evaluation of any bleeding after menopause.',
        ['ACOG_POSTMENOPAUSAL_BLEEDING'],
      ),
    })
  }

  if (input.bleeding?.betweenPeriods === true) {
    matches.push({
      urgency: 'routine',
      reason: reason(
        'bleeding-between-periods',
        'Bleeding between periods',
        'Arrange a clinician appointment to discuss bleeding between periods, especially if it repeats or changes.',
        ['ACOG_ABNORMAL_UTERINE_BLEEDING'],
      ),
    })
  }

  if (
    Number.isFinite(input.bleeding?.durationDays) &&
    (input.bleeding?.durationDays ?? 0) > 7
  ) {
    matches.push({
      urgency: 'routine',
      reason: reason(
        'bleeding-longer-than-seven-days',
        'Bleeding lasting longer than seven days',
        'Arrange a clinician appointment to discuss bleeding that lasts longer than seven days.',
        ['ACOG_ABNORMAL_UTERINE_BLEEDING'],
      ),
    })
  }

  if (input.pelvicPain?.persistentOrRecurring === true) {
    matches.push({
      urgency: 'routine',
      reason: reason(
        'persistent-or-recurring-pelvic-pain',
        'Persistent or recurring pelvic pain',
        'Arrange a clinician appointment to discuss pelvic pain that persists or keeps returning.',
        ['ACOG_ABNORMAL_UTERINE_BLEEDING'],
      ),
    })
  }

  return matches
}

/**
 * Applies a deliberately small set of deterministic care-routing rules.
 *
 * It does not parse free text, estimate probabilities, diagnose a condition,
 * or infer missing answers. Rules only fire when their complete structured
 * input combination is explicitly present.
 */
export function evaluateSafetyTriage(input: SafetyTriageInput): SafetyTriageResult {
  const matches = matchingRules(input)
  if (matches.length === 0) {
    return {
      urgency: 'none',
      headline: HEADLINES.none,
      action: ACTIONS.none,
      reasons: [],
      sourceIds: [],
      caveat: CAVEAT,
    }
  }

  const urgency = matches.reduce<Exclude<SafetyUrgency, 'none'>>(
    (highest, match) =>
      URGENCY_RANK[match.urgency] > URGENCY_RANK[highest]
        ? match.urgency
        : highest,
    'routine',
  )
  const reasons = matches
    .filter((match) => match.urgency === urgency)
    .map((match) => match.reason)
  const sourceIds = [...new Set(reasons.flatMap((item) => item.sourceIds))]

  return {
    urgency,
    headline: HEADLINES[urgency],
    action: ACTIONS[urgency],
    reasons,
    sourceIds,
    caveat: CAVEAT,
  }
}
