import Anthropic from '@anthropic-ai/sdk'
import { providerFetch } from './providerFetch'

/**
 * Consent-scoped, bring-your-own-provider assistant transport.
 *
 * No health data is loaded here. Callers must build `approvedContext`
 * explicitly from the toggles the user selected for the current request.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are Ruby's health companion inside a privacy-first menstrual-health app. Explain cycles, fertility, pregnancy, symptoms, and perimenopause clearly and warmly.

Safety rules:
- You provide general education, not a diagnosis, prescription, or substitute for a clinician.
- Use calibrated language such as "may", "often", and "can"; never claim clinical certainty from tracker data.
- Never present calendar, temperature, or symptom tracking as reliable contraception.
- Do not tell someone to start, stop, or change prescription medicine.
- When symptoms could be urgent (including severe or one-sided pain, fainting, chest pain, trouble breathing, very heavy bleeding, pregnancy bleeding with pain, or thoughts of self-harm), clearly recommend prompt professional or emergency help.
- State when the available information is insufficient.
- Keep answers focused and readable.`

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantProvider = 'anthropic' | 'openai' | 'gemini'

/**
 * How an Anthropic credential authenticates.
 *
 * 'api-key'  — a console key (sk-ant-api…), sent as `x-api-key`.
 * 'cli-token' — the subscription token printed by `claude setup-token`
 *   (sk-ant-oat…). It authenticates against the same Messages API but must go
 *   on `Authorization: Bearer` together with the OAuth beta header; sending it
 *   as `x-api-key` fails with a 401. This is the mobile equivalent of shelling
 *   out to `claude -p`, which a WebView cannot do.
 */
export type AnthropicCredentialKind = 'api-key' | 'cli-token'

export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'
export const CLI_TOKEN_PREFIX = 'sk-ant-oat'
export const ANTHROPIC_API_KEY_PREFIX = 'sk-ant-api'

export interface AssistantConfig {
  provider: AssistantProvider
  /** Kept in the native secure vault by the UI; never written to the cycle database. */
  apiKey?: string
  model: string
  /** OpenAI-compatible base URL. */
  baseUrl?: string
}

export type ApprovedAssistantContext = Record<string, unknown>

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 · most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fastest' },
] as const

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · fast & smart (Recommended)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · deep reasoning' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash · responsive' },
] as const

type FetchLike = typeof fetch

/** Classify a pasted Anthropic credential so it is sent on the right header. */
export function anthropicCredentialKind(key: string): AnthropicCredentialKind | null {
  const trimmed = key.trim()
  if (trimmed.startsWith(CLI_TOKEN_PREFIX)) return 'cli-token'
  if (trimmed.startsWith('sk-ant-')) return 'api-key'
  return null
}

function cleanBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function contextInstructions(approvedContext?: ApprovedAssistantContext): string {
  if (!approvedContext || Object.keys(approvedContext).length === 0) {
    return `${ASSISTANT_SYSTEM_PROMPT}\n\nThe user has not shared tracker data for this request. Do not imply that you can see it.`
  }

  return `${ASSISTANT_SYSTEM_PROMPT}

The following JSON contains only tracker categories the user explicitly approved for this request. Treat it as self-reported, potentially incomplete data. Do not infer or request hidden categories:
${JSON.stringify(approvedContext)}`
}

function apiError(provider: AssistantProvider, status: number): Error {
  if (status === 401 || status === 403) {
    if (provider === 'gemini') {
      return new Error('Google Gemini rejected that API key. Please check your key in AI settings.')
    }
    return new Error(
      provider === 'openai'
        ? 'OpenAI rejected that key. Add a fresh project key in AI settings.'
        : 'Anthropic rejected that credential. A CLI token from `claude setup-token` expires — generate a new one, or paste a console API key.',
    )
  }
  if (status === 402) return new Error('That account has no available credits.')
  if (status === 429) return new Error('The provider is rate-limiting requests. Try again shortly.')
  return new Error(`Assistant request failed (${status}). Check the provider and model settings.`)
}

function boundedHistory(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-16).map((message) => ({
    role: message.role,
    content:
      message.content.length > 6_000
        ? `${message.content.slice(0, 6_000)}\n[message truncated]`
        : message.content,
  }))
}

async function askAnthropic(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext: ApprovedAssistantContext | undefined,
  fetchImpl: FetchLike,
): Promise<string> {
  const credential = config.apiKey?.trim()
  if (!credential) {
    throw new Error('Add an Anthropic key or a `claude setup-token` CLI token before sending a message.')
  }
  const kind = anthropicCredentialKind(credential)
  if (kind === null) {
    throw new Error('That does not look like an Anthropic credential (expected sk-ant-…).')
  }

  const client = new Anthropic({
    ...(kind === 'cli-token'
      ? { authToken: credential, defaultHeaders: { 'anthropic-beta': ANTHROPIC_OAUTH_BETA } }
      : { apiKey: credential }),
    fetch: fetchImpl,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  })

  let response
  try {
    response = await client.messages.create({
      model: config.model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1200,
      system: contextInstructions(approvedContext),
      messages: boundedHistory(history),
    })
  } catch (reason) {
    if (reason instanceof Anthropic.APIError && typeof reason.status === 'number') {
      throw apiError('anthropic', reason.status)
    }
    throw new Error('Could not reach Anthropic. Check your network connection.')
  }

  if (response.stop_reason === 'refusal') {
    throw new Error(
      'Anthropic’s safety system declined this request. Rephrasing it usually helps; for urgent symptoms, contact a clinician.',
    )
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('Anthropic returned no readable text.')
  return text
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as {
    output_text?: unknown
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>
  }
  if (typeof data.output_text === 'string') return data.output_text.trim()

  return (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('')
    .trim()
}

async function askOpenAI(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext: ApprovedAssistantContext | undefined,
  fetchImpl: FetchLike,
): Promise<string> {
  if (!config.apiKey?.trim()) throw new Error('Add an OpenAI API key before sending a message.')
  const baseUrl = cleanBaseUrl(config.baseUrl || 'https://api.openai.com')
  const response = await fetchImpl(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_OPENAI_MODEL,
      instructions: contextInstructions(approvedContext),
      input: boundedHistory(history).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 1200,
      store: false,
    }),
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw apiError('openai', response.status)
  }
  const text = extractOpenAIText(await response.json())
  if (!text) throw new Error('OpenAI returned no readable text.')
  return text
}

async function askGemini(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext: ApprovedAssistantContext | undefined,
  fetchImpl: FetchLike,
): Promise<string> {
  const apiKey = config.apiKey?.trim()
  if (!apiKey) throw new Error('Add a Google Gemini API key before sending a message.')
  const model = config.model || DEFAULT_GEMINI_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

  const contents = boundedHistory(history).map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }))

  const systemText = contextInstructions(approvedContext)

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.7,
      },
    }),
  })

  if (!response.ok) {
    let errorDetail = ''
    try {
      const errJson = (await response.json()) as { error?: { message?: string } }
      errorDetail = errJson.error?.message || ''
    } catch {
      // ignore parsing error
    }
    if (response.status === 400 && errorDetail.includes('API_KEY_INVALID')) {
      throw new Error('Google Gemini rejected that API key. Check your key in AI settings.')
    }
    if (response.status === 403 || response.status === 401) {
      throw new Error('Google Gemini access denied. Verify your API key in AI settings.')
    }
    if (response.status === 429) {
      throw new Error('Google Gemini rate limit reached. Try again in a few moments.')
    }
    throw new Error(`Google Gemini request failed (${response.status}): ${errorDetail || 'Check provider and key settings'}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      finishReason?: string
      content?: { parts?: Array<{ text?: string }> }
    }>
  }
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'SAFETY') {
    throw new Error('Google Gemini safety filters declined this request. Rephrasing may help.')
  }
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('').trim()
  if (!text) throw new Error('Google Gemini returned no readable text.')
  return text
}

export async function askAssistant(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext?: ApprovedAssistantContext,
  fetchImpl: FetchLike = providerFetch,
): Promise<string> {
  if (history.length === 0) throw new Error('Write a message first.')
  if (config.provider === 'anthropic') {
    return askAnthropic(config, history, approvedContext, fetchImpl)
  }
  if (config.provider === 'gemini') {
    return askGemini(config, history, approvedContext, fetchImpl)
  }
  return askOpenAI(config, history, approvedContext, fetchImpl)
}
