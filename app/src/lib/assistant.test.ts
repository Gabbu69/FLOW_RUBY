import { describe, expect, it, vi } from 'vitest'
import {
  anthropicCredentialKind,
  ANTHROPIC_OAUTH_BETA,
  askAssistant,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  streamAssistant,
  type ChatMessage,
} from './assistant'

const history: ChatMessage[] = [{ role: 'user', content: 'Why might cycle length vary?' }]

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

function anthropicReply(text: string, stopReason = 'end_turn'): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_ANTHROPIC_MODEL,
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('assistant transport', () => {
  it('classifies Anthropic credentials so each goes on the right header', () => {
    expect(anthropicCredentialKind('sk-ant-api03-abc')).toBe('api-key')
    expect(anthropicCredentialKind('sk-ant-oat01-abc')).toBe('cli-token')
    expect(anthropicCredentialKind('sk-proj-abc')).toBeNull()
    expect(anthropicCredentialKind('')).toBeNull()
  })

  it('sends a console API key as x-api-key', async () => {
    let captured: RequestInit | undefined
    let capturedUrl: RequestInfo | URL | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      captured = init
      return anthropicReply('Cycles can vary for several reasons.')
    })

    const result = await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(result).toBe('Cycles can vary for several reasons.')
    expect(String(capturedUrl)).toContain('/v1/messages')
    expect(headerOf(captured, 'x-api-key')).toBe('sk-ant-api03-key')
    expect(headerOf(captured, 'authorization')).toBeNull()
    expect(headerOf(captured, 'anthropic-version')).toBe('2023-06-01')
    const body = JSON.parse(String(captured?.body))
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(body.system).toContain('"cycle":{"cycleDay":12}')
    expect(body.messages).toEqual(history)
  })

  it('sends a `claude setup-token` CLI token as a bearer token with the OAuth beta', async () => {
    // The CLI token is an OAuth credential — on x-api-key it would 401, so the
    // header choice is the whole point of the cli-token path.
    let captured: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init
      return anthropicReply('A subscription-billed answer.')
    })

    const result = await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-oat01-token', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      {},
      fetchMock,
    )

    expect(result).toBe('A subscription-billed answer.')
    expect(headerOf(captured, 'authorization')).toBe('Bearer sk-ant-oat01-token')
    expect(headerOf(captured, 'x-api-key')).toBeNull()
    expect(headerOf(captured, 'anthropic-beta')).toContain(ANTHROPIC_OAUTH_BETA)
  })

  it('does not imply access to tracker data when no categories are approved', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.system).toContain('has not shared tracker data')
      expect(body.system).not.toContain('cycleDay')
      expect(body.system).not.toContain('periodStarts')
      return anthropicReply('A general answer.')
    })

    await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      {},
      fetchMock,
    )
  })

  it('surfaces a safety refusal instead of reading an empty content array', async () => {
    // A declined request is a 200 with stop_reason "refusal"; indexing content
    // unconditionally would throw instead of explaining what happened.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: DEFAULT_ANTHROPIC_MODEL,
          content: [],
          stop_reason: 'refusal',
          usage: { input_tokens: 4, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/safety system declined/)
  })

  it('explains that a CLI token expires when Anthropic rejects the credential', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-ant-oat01-token', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/claude setup-token/)
  })

  it('rejects a credential that is not an Anthropic one before any request', async () => {
    const fetchMock = vi.fn(async () => anthropicReply('should not be reached'))

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-proj-openai', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/does not look like an Anthropic credential/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the OpenAI Responses API without server-side storage', async () => {
    let capturedUrl: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Cycles can vary for several reasons.' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const result = await askAssistant(
      { provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(result).toBe('Cycles can vary for several reasons.')
    expect(capturedUrl).toBe('https://api.openai.com/v1/responses')
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.store).toBe(false)
    expect(body.input).toEqual(history)
    expect(body.instructions).toContain('"cycle":{"cycleDay":12}')
  })

  it('sends a request to Google Gemini with approved context and key', async () => {
    let capturedUrl: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Gemini health explanation.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const result = await askAssistant(
      { provider: 'gemini', apiKey: 'AIzaSyTestKey123', model: DEFAULT_GEMINI_MODEL },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(result).toBe('Gemini health explanation.')
    expect(String(capturedUrl)).toContain('generativelanguage.googleapis.com')
    expect(String(capturedUrl)).toContain(DEFAULT_GEMINI_MODEL)
    expect(String(capturedUrl)).toContain('key=AIzaSyTestKey123')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.systemInstruction.parts[0].text).toContain('"cycle":{"cycleDay":12}')
    expect(body.contents[0].parts[0].text).toBe(history[0].content)
  })

  it('never includes provider error bodies in user-facing errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('server echoed test-key and sensitive tracker text', { status: 500 }),
    )

    await expect(
      askAssistant(
        { provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL },
        history,
        undefined,
        fetchMock,
      ),
    ).rejects.toThrow('Assistant request failed (500). Check the provider and model settings.')
  })

  it('streams OpenAI Responses API text deltas without storing the conversation', async () => {
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(
        [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Cycles "}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"can vary."}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    })
    const deltas: string[] = []

    const result = await streamAssistant(
      { provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL },
      history,
      {},
      { onDelta: (delta) => deltas.push(delta) },
      fetchMock,
    )

    expect(result).toBe('Cycles can vary.')
    expect(deltas).toEqual(['Cycles ', 'can vary.'])
    expect(headerOf(capturedInit, 'accept')).toBe('text/event-stream')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
  })

  it('streams Gemini text while excluding hidden thought parts', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain(':streamGenerateContent?alt=sse')
      return new Response(
        [
          'data: {"candidates":[{"content":{"parts":[{"text":"internal","thought":true},{"text":"A helpful "}]}}]}',
          '',
          'data: {"candidates":[{"content":{"parts":[{"text":"answer."}]},"finishReason":"STOP"}]}',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    })
    const deltas: string[] = []

    const result = await streamAssistant(
      { provider: 'gemini', apiKey: 'AIzaSyTestKey123', model: DEFAULT_GEMINI_MODEL },
      history,
      {},
      { onDelta: (delta) => deltas.push(delta) },
      fetchMock,
    )

    expect(result).toBe('A helpful answer.')
    expect(deltas).toEqual(['A helpful ', 'answer.'])
  })

  it('streams Anthropic text with the correct browser-safe headers', async () => {
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(
        [
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Cycle "}}',
          '',
          'event: content_block_delta',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"guidance."}}',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    })
    const deltas: string[] = []

    const result = await streamAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      {},
      { onDelta: (delta) => deltas.push(delta) },
      fetchMock,
    )

    expect(result).toBe('Cycle guidance.')
    expect(deltas).toEqual(['Cycle ', 'guidance.'])
    expect(headerOf(capturedInit, 'x-api-key')).toBe('sk-ant-api03-key')
    expect(headerOf(capturedInit, 'anthropic-dangerous-direct-browser-access')).toBe('true')
    expect(JSON.parse(String(capturedInit?.body)).stream).toBe(true)
  })
})
