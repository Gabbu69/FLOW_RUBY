import { useEffect, useRef, useState } from 'react'
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import {
  anthropicCredentialKind,
  ANTHROPIC_MODELS,
  askAssistant,
  CLI_TOKEN_PREFIX,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  GEMINI_MODELS,
  type AssistantConfig,
  type AssistantProvider,
  type ChatMessage,
} from '../lib/assistant'
import {
  collectApprovedAssistantContext,
  NO_ASSISTANT_CONSENT,
  parseAssistantConsent,
  type AssistantConsent,
} from '../lib/assistantContext'
import { screenAssistantUrgency } from '../lib/assistantSafety'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
  setSecureSecret,
} from '../native/secureVault'
import { useApp } from '../state/appStore'
import { RubyMark } from './RubyMark'
import '../styles/assistant.css'

const CONSENT_OPTIONS: Array<{
  key: keyof AssistantConsent
  title: string
  detail: string
  sensitive?: boolean
}> = [
  { key: 'cycle', title: 'Cycle summary', detail: 'Period starts and current prediction' },
  { key: 'symptoms', title: 'Symptoms & mood', detail: 'Up to 30 recent logged days' },
  {
    key: 'fertility',
    title: 'Fertility & intimacy',
    detail: 'BBT, tests, discharge, sex, and pregnancy timing',
    sensitive: true,
  },
  { key: 'notes', title: 'Private notes', detail: 'Up to 12 recent notes', sensitive: true },
]

const STARTERS = [
  'What can change cycle length?',
  'Help me prepare questions for my doctor.',
  'Explain my fertile-window estimate.',
]

function defaultModel(provider: AssistantProvider): string {
  if (provider === 'gemini') return DEFAULT_GEMINI_MODEL
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
}

function vaultKeyFor(provider: AssistantProvider) {
  if (provider === 'gemini') return SECURE_SECRET_KEYS.geminiApiKey
  return provider === 'anthropic'
    ? SECURE_SECRET_KEYS.anthropicApiKey
    : SECURE_SECRET_KEYS.openAiApiKey
}

export function AssistantScreen({ isTab }: { isTab?: boolean } = {}) {
  const setAssistantOpen = useApp((state) => state.setAssistantOpen)
  const setTab = useApp((state) => state.setTab)
  const [provider, setProvider] = useState<AssistantProvider>('gemini')
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [consent, setConsent] = useState<AssistantConsent>(NO_ASSISTANT_CONSENT)
  const [vaultLabel, setVaultLabel] = useState('secure storage')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [setupOpen, setSetupOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)

  const credentialKind = apiKey ? anthropicCredentialKind(apiKey) : null

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [savedProvider, savedModel, savedBaseUrl, savedConsent, status, legacyKey, savedOpenAiKey, savedAnthropicKey, savedGeminiKey] =
        await Promise.all([
          getSetting(SK.aiProvider),
          getSetting(SK.aiModel),
          getSetting(SK.aiBaseUrl),
          getSetting(SK.aiConsent),
          secureVaultStatus(),
          getSetting(SK.aiKey),
          getSecureSecret(SECURE_SECRET_KEYS.openAiApiKey),
          getSecureSecret(SECURE_SECRET_KEYS.anthropicApiKey),
          getSecureSecret(SECURE_SECRET_KEYS.geminiApiKey),
        ])
      const nextProvider: AssistantProvider =
        savedProvider === 'anthropic'
          ? 'anthropic'
          : savedProvider === 'openai'
            ? 'openai'
            : 'gemini'

      // One-time migration from legacy key storage
      if (legacyKey) {
        await setSecureSecret(SECURE_SECRET_KEYS.openAiApiKey, legacyKey)
        await removeSetting(SK.aiKey)
      }
      const key =
        nextProvider === 'gemini'
          ? savedGeminiKey
          : nextProvider === 'anthropic'
            ? savedAnthropicKey
            : legacyKey || savedOpenAiKey
      if (!alive) return
      setProvider(nextProvider)
      setModel(savedModel || defaultModel(nextProvider))
      setBaseUrl(savedBaseUrl || '')
      setConsent(parseAssistantConsent(savedConsent))
      setApiKey(key)
      setVaultLabel(
        status.persistence === 'memory'
          ? 'memory only for this browser tab'
          : `${status.persistence}${status.hardwareBacked ? ' · hardware protected' : ''}`,
      )
      setSetupOpen(!key)
      setLoading(false)
    })().catch((reason: unknown) => {
      if (!alive) return
      setError(reason instanceof Error ? reason.message : 'Could not load AI settings.')
      setLoading(false)
      setSetupOpen(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    const textarea = composerInput.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 104)}px`
  }, [input])

  async function chooseProvider(next: AssistantProvider) {
    setProvider(next)
    setModel(defaultModel(next))
    setBaseUrl('')
    setKeyInput('')
    setError(null)
    setNotice(null)
    setApiKey(await getSecureSecret(vaultKeyFor(next)))
  }

  async function saveConfiguration() {
    const cleanModel = model.trim() || defaultModel(provider)
    setError(null)
    setNotice(null)
    try {
      const suppliedKey = keyInput.trim()
      if (suppliedKey) {
        if (provider === 'anthropic' && anthropicCredentialKind(suppliedKey) === null) {
          setError('Anthropic credentials start with sk-ant- (an API key or a `claude setup-token` token).')
          return
        }
        if (provider === 'openai' && !suppliedKey.startsWith('sk-')) {
          setError('That does not look like an OpenAI API key (expected sk-…).')
          return
        }
        if (provider === 'gemini' && suppliedKey.length < 8) {
          setError('Please enter a valid Google Gemini API key.')
          return
        }
        await setSecureSecret(vaultKeyFor(provider), suppliedKey)
        setApiKey(suppliedKey)
        setKeyInput('')
      }
      await Promise.all([
        setSetting(SK.aiProvider, provider),
        setSetting(SK.aiModel, cleanModel),
        setSetting(SK.aiBaseUrl, baseUrl.trim()),
      ])
      setModel(cleanModel)
      if (!apiKey && !suppliedKey) {
        setError(
          provider === 'gemini'
            ? 'Add a Google Gemini API key to continue.'
            : provider === 'anthropic'
              ? 'Add an Anthropic API key, or paste a token from `claude setup-token`.'
              : 'Add an OpenAI project key, or choose another provider.',
        )
        return
      }
      setSetupOpen(false)
      setNotice('AI connection settings saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save AI settings.')
    }
  }

  async function removeKey() {
    await deleteSecureSecret(vaultKeyFor(provider))
    setApiKey(null)
    setKeyInput('')
    setNotice(
      provider === 'gemini'
        ? 'Google Gemini API key removed from secure storage.'
        : provider === 'anthropic'
          ? 'Anthropic credential removed from this device.'
          : 'OpenAI key removed.',
    )
  }

  async function toggleConsent(key: keyof AssistantConsent) {
    const next = { ...consent, [key]: !consent[key] }
    setConsent(next)
    await setSetting(SK.aiConsent, JSON.stringify(next))
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return
    if (!apiKey) {
      setSetupOpen(true)
      setError(
        provider === 'gemini'
          ? 'Add a Google Gemini API key before sending a message.'
          : provider === 'anthropic'
            ? 'Add an Anthropic key or CLI token before sending a message.'
            : 'Add an OpenAI key before sending a message.',
      )
      return
    }

    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    const safetyIntercept = screenAssistantUrgency(text)
    if (safetyIntercept) {
      setMessages([...next, { role: 'assistant', content: safetyIntercept.response }])
      return
    }

    setBusy(true)
    setError(null)
    try {
      const approvedContext = await collectApprovedAssistantContext(consent)
      const config: AssistantConfig = {
        provider,
        apiKey,
        model,
        baseUrl: baseUrl.trim() || undefined,
      }
      const reply = await askAssistant(config, next, approvedContext)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The assistant could not reply.')
    } finally {
      setBusy(false)
    }
  }

  const sharedCount = Object.values(consent).filter(Boolean).length

  return (
    <div
      className={isTab ? 'page assistant-page' : 'overlay assistant-overlay'}
      role={isTab ? 'region' : 'dialog'}
      aria-modal={isTab ? undefined : true}
      aria-label="AI Health Companion"
      aria-busy={loading}
    >
      <header className="assistant-head">
        <button
          className="back-btn"
          onClick={() => (isTab ? setTab('today') : setAssistantOpen(false))}
          aria-label={isTab ? 'Back to Today' : 'Close assistant'}
        >
          ‹
        </button>
        <div className="assistant-head-copy">
          <div className="assistant-title-row">
            <h1>Ruby Companion ✨</h1>
            <span className="privacy-badge">
              <i aria-hidden="true" />
              {vaultLabel.includes('memory') ? 'In-memory' : 'On-device key'}
            </span>
          </div>
          <span className="assistant-subtitle">
            {provider === 'gemini' ? 'Google Gemini' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {model}
          </span>
        </div>
        <button
          className={`assistant-settings-button ${setupOpen ? 'is-active' : ''}`}
          onClick={() => setSetupOpen((open) => !open)}
          aria-label="AI connection settings"
          aria-expanded={setupOpen}
        >
          ⚙
        </button>
      </header>

      {setupOpen ? (
        <div className="assistant-setup-pane" role="region" aria-label="AI Connection Setup">
          <section className="card ai-setup-card">
            <h3>Choose where answers come from</h3>
            <p>Your API key stays encrypted on this device. Ruby never ships a shared key.</p>
            <div className="ai-provider-grid">
              <button
                className={`choice-card compact ${provider === 'gemini' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('gemini')}
              >
                <span className="choice-icon">✨</span>
                <span><strong>Google Gemini</strong><small>Gemini 2.5 Flash / Pro</small></span>
              </button>
              <button
                className={`choice-card compact ${provider === 'anthropic' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('anthropic')}
              >
                <span className="choice-icon">✳</span>
                <span><strong>Anthropic</strong><small>Claude Opus / Sonnet / CLI</small></span>
              </button>
              <button
                className={`choice-card compact ${provider === 'openai' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('openai')}
              >
                <span className="choice-icon">✦</span>
                <span><strong>OpenAI</strong><small>GPT-5 / Project Key</small></span>
              </button>
            </div>
          </section>

          <section className="card ai-setup-card">
            {provider === 'gemini' ? (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">Google Gemini API key</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'AIzaSy…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  <small className="field-hint">
                    Get a free API key at{' '}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--hk-red)', textDecoration: 'underline', fontWeight: 700 }}
                    >
                      Google AI Studio ↗
                    </a>
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <select
                    id="assistant-model"
                    value={GEMINI_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_GEMINI_MODEL}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {GEMINI_MODELS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : provider === 'anthropic' ? (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">Anthropic API key or CLI token</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'sk-ant-api… or sk-ant-oat…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  {apiKey && (
                    <small className="field-hint">
                      Currently using{' '}
                      {credentialKind === 'cli-token'
                        ? 'a Claude CLI subscription token'
                        : 'a console API key'}
                      .
                    </small>
                  )}
                </div>

                <details className="assistant-key-fallback">
                  <summary>Use your Claude subscription instead (CLI login)</summary>
                  <p className="microcopy">
                    Ruby runs in a mobile WebView, so it cannot shell out to the{' '}
                    <code>claude</code> CLI the way a server can. Run this once on a computer
                    where you are signed in:
                  </p>
                  <pre className="cli-snippet"><code>claude setup-token</code></pre>
                  <p className="microcopy">
                    Paste the <code>{CLI_TOKEN_PREFIX}…</code> token it prints into the field
                    above.
                  </p>
                </details>

                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <select
                    id="assistant-model"
                    value={ANTHROPIC_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_ANTHROPIC_MODEL}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {ANTHROPIC_MODELS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">OpenAI project API key</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'sk-proj-…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <input
                    id="assistant-model"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>
              </>
            )}
            <p className="microcopy">
              Storage: {vaultLabel}. Credentials never enter the cycle database or a backup.
            </p>
            {apiKey && (
              <button className="text-button danger" onClick={removeKey}>
                Remove saved credential
              </button>
            )}
          </section>

          {notice && <div className="assistant-notice" role="status">{notice}</div>}
          {error && <div className="assistant-error" role="alert">{error}</div>}
          <button className="cta btn-cta" onClick={saveConfiguration}>
            Save connection ✨
          </button>
        </div>
      ) : (
        <>
          <section className={`assistant-context-panel ${contextOpen ? 'is-open' : ''}`}>
            <button
              className="assistant-context-summary"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              aria-controls="assistant-consent-options"
            >
              <span className="assistant-context-mark" aria-hidden="true">
                <RubyMark decorative size={20} />
              </span>
              <span className="assistant-context-copy">
                <strong>Tracker context</strong>
                <small>
                  {sharedCount === 0
                    ? 'Nothing shared'
                    : `${sharedCount} categor${sharedCount === 1 ? 'y' : 'ies'} selected`}
                </small>
              </span>
              <span className="privacy-pill">
                <i aria-hidden="true" />
                {provider === 'gemini' ? 'Gemini' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
              </span>
              <svg className="assistant-context-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7 9.5 5 5 5-5" />
              </svg>
            </button>

            {contextOpen && (
              <div className="assistant-context-disclosure" id="assistant-consent-options">
                <div className="assistant-context-note">
                  <strong>Choose what travels with your next message.</strong>
                  <span>Nothing is attached unless you select it here.</span>
                </div>
                <div className="consent-grid">
                  {CONSENT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`consent-row ${consent[option.key] ? 'selected' : ''}`}
                      onClick={() => toggleConsent(option.key)}
                      aria-pressed={consent[option.key]}
                    >
                      <span>
                        <strong>{option.title}</strong>
                        <small>
                          {option.detail}
                          {option.sensitive ? ' · Sensitive' : ''}
                        </small>
                      </span>
                      <span className="toggle-dot" aria-hidden="true"><i /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div
            ref={scroller}
            className="assistant-thread"
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            {messages.length === 0 && (
              <div className="assistant-empty-state">
                <RubyMark decorative size={48} />
                <h2>Ask your Ruby companion</h2>
                <p>
                  Questions about cycles, fertility, symptoms, or what to ask your doctor.
                  Answers use your own configured {provider === 'gemini' ? 'Google Gemini' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} key.
                </p>
                <div className="starters-list">
                  {STARTERS.map((text) => (
                    <button
                      key={text}
                      className="starter-prompt-button"
                      onClick={() => void send(text)}
                    >
                      <span>✨</span>
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`message-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                {message.role === 'assistant' && (
                  <span className="assistant-bubble-mark" aria-hidden="true">
                    <RubyMark decorative size={18} />
                  </span>
                )}
                <div className="message-content">{message.content}</div>
              </div>
            ))}

            {busy && (
              <div className="message-bubble assistant thinking" aria-label="Thinking">
                <span className="assistant-bubble-mark" aria-hidden="true">
                  <RubyMark decorative size={18} />
                </span>
                <div className="thinking-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="assistant-error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setSetupOpen(true)}>AI Settings</button>
            </div>
          )}

          <div className="assistant-composer">
            <textarea
              ref={composerInput}
              rows={1}
              placeholder="Ask about cycles, fertility, symptoms…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button
              className="assistant-send-button"
              disabled={!input.trim() || busy}
              onClick={() => void send()}
              aria-label="Send message"
            >
              ➔
            </button>
          </div>
        </>
      )}
    </div>
  )
}
