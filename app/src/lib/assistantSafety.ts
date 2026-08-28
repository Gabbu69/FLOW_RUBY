export interface AssistantSafetyIntercept {
  category: 'immediate-danger' | 'urgent-physical' | 'urgent-pregnancy'
  response: string
}

/**
 * Small deterministic guardrail before any model or network request. It is
 * deliberately narrow: matching sends a conservative care message; not
 * matching never means a symptom is safe.
 */
export function screenAssistantUrgency(message: string): AssistantSafetyIntercept | null {
  const text = message.toLowerCase()

  if (
    /\b(kill myself|end my life|want to die|hurt myself|harm myself|suicidal)\b/.test(text)
  ) {
    return {
      category: 'immediate-danger',
      response:
        'I’m really sorry you’re dealing with this. Ruby is not an emergency service. If you might act on these thoughts or are in immediate danger, contact your local emergency services now or go to the nearest emergency department. If you can, stay with someone you trust and tell them directly what is happening.',
    }
  }

  const pregnant = /\b(pregnan|positive pregnancy|missed period)\w*/.test(text)
  const bleeding = /\b(bleed|bleeding|spotting)\b/.test(text)
  const severeOrOneSidedPain =
    /\b(severe|unbearable|worst|one[- ]sided|sharp)\b.{0,35}\b(pain|cramp)/.test(text) ||
    /\b(pain|cramp)\b.{0,35}\b(severe|unbearable|worst|one[- ]sided|sharp)\b/.test(text)

  if (pregnant && (bleeding || severeOrOneSidedPain)) {
    return {
      category: 'urgent-pregnancy',
      response:
        'Bleeding or significant pain during a possible pregnancy needs prompt professional assessment, especially with one-sided pain, shoulder pain, dizziness, or fainting. Contact your obstetric clinician or urgent care now; use local emergency services if symptoms are severe or you feel faint. Do not wait for an app response.',
    }
  }

  if (
    /\b(chest pain|cannot breathe|can'?t breathe|trouble breathing|passed out|fainted)\b/.test(text) ||
    /\bsoak(?:ing|ed)?\b.{0,30}\b(pad|tampon)\b.{0,30}\b(hour|60 minutes)\b/.test(text)
  ) {
    return {
      category: 'urgent-physical',
      response:
        'Those symptoms can require urgent in-person care. Contact local emergency services or go to the nearest emergency department now, especially if symptoms are ongoing, worsening, or accompanied by faintness. Do not rely on Ruby to assess an emergency.',
    }
  }

  return null
}
