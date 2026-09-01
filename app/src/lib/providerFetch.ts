import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * Fetch a provider from either the browser or a native Capacitor shell.
 *
 * Native requests use CapacitorHttp so provider calls are not blocked by a
 * WebView's CORS policy. Error messages deliberately exclude response bodies,
 * which can contain echoed credentials or health context.
 */
export async function providerFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(input, init)
  if (init?.signal?.aborted) throw new DOMException('The request was stopped.', 'AbortError')

  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const headers: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value
  })

  let data: unknown = init?.body
  if (typeof init?.body === 'string') {
    try {
      data = JSON.parse(init.body)
    } catch {
      data = init.body
    }
  }

  try {
    const response = await CapacitorHttp.request({
      url,
      method: init?.method ?? 'GET',
      headers,
      data,
      connectTimeout: 20_000,
      readTimeout: 90_000,
      responseType: headers.accept?.includes('text/event-stream') ? 'text' : 'json',
    })
    if (init?.signal?.aborted) throw new DOMException('The request was stopped.', 'AbortError')
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    })
  } catch (reason) {
    if (init?.signal?.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) {
      throw new DOMException('The request was stopped.', 'AbortError')
    }
    throw new Error('Could not reach the AI provider. Check your network connection.')
  }
}
