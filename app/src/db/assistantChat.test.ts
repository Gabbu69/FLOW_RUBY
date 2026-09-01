import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAssistantChat, saveAssistantMessage } from './assistantChat'
import { db, SK, type AssistantConversationRecord } from './schema'

afterEach(() => {
  vi.restoreAllMocks()
})

const conversation: AssistantConversationRecord = {
  id: 'chat-1',
  provider: 'gemini',
  model: 'gemini-3.6-flash',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:01:00.000Z',
}

describe('offline assistant persistence', () => {
  it('migrates the old tab-only cache into a durable local conversation', async () => {
    vi.spyOn(db.settings, 'get').mockResolvedValue(undefined)
    vi.spyOn(db.assistantConversations, 'orderBy').mockReturnValue({
      last: vi.fn().mockResolvedValue(undefined),
    } as never)
    vi.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>
      await callback()
    }) as never)
    vi.spyOn(db.assistantConversations, 'put').mockResolvedValue('new-chat')
    vi.spyOn(db.settings, 'put').mockResolvedValue(SK.aiConversationId)
    const bulkPut = vi.spyOn(db.assistantMessages, 'bulkPut').mockResolvedValue('legacy-message')
    const legacy = [
      {
        id: 'legacy-message',
        role: 'user' as const,
        content: 'My saved question',
        createdAt: '2026-09-01T09:00:00.000Z',
        status: 'complete' as const,
      },
    ]

    const result = await loadAssistantChat('gemini', 'gemini-3.6-flash', legacy)

    expect(result.messages).toEqual(legacy)
    expect(result.conversationId).toEqual(expect.any(String))
    expect(bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'legacy-message',
        conversationId: result.conversationId,
        content: 'My saved question',
      }),
    ])
  })

  it('loads saved messages and recovers an interrupted stream as stopped', async () => {
    vi.spyOn(db.settings, 'get').mockResolvedValue({ key: SK.aiConversationId, value: 'chat-1' })
    vi.spyOn(db.assistantConversations, 'get').mockResolvedValue(conversation)
    const sortBy = vi.fn().mockResolvedValue([
      {
        id: 'message-1',
        conversationId: 'chat-1',
        role: 'assistant',
        content: 'A partial reply',
        createdAt: '2026-09-01T10:01:00.000Z',
        status: 'streaming',
      },
    ])
    const equals = vi.fn().mockReturnValue({ sortBy })
    vi.spyOn(db.assistantMessages, 'where').mockReturnValue({ equals } as never)
    const bulkPut = vi.spyOn(db.assistantMessages, 'bulkPut').mockResolvedValue('message-1')

    const result = await loadAssistantChat('gemini', 'gemini-3.6-flash')

    expect(result).toEqual({
      conversationId: 'chat-1',
      messages: [
        expect.objectContaining({
          id: 'message-1',
          content: 'A partial reply',
          status: 'stopped',
        }),
      ],
    })
    expect(bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ conversationId: 'chat-1', status: 'stopped' }),
    ])
  })

  it('saves message text and updates conversation metadata in one local transaction', async () => {
    vi.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>
      await callback()
    }) as never)
    vi.spyOn(db.assistantConversations, 'get').mockResolvedValue(conversation)
    const putConversation = vi.spyOn(db.assistantConversations, 'put').mockResolvedValue('chat-1')
    const putMessage = vi.spyOn(db.assistantMessages, 'put').mockResolvedValue('message-2')

    await saveAssistantMessage(
      'chat-1',
      {
        id: 'message-2',
        role: 'assistant',
        content: 'Saved while streaming.',
        createdAt: '2026-09-01T10:02:00.000Z',
        status: 'streaming',
      },
      'openai',
      'gpt-5.6-terra',
    )

    expect(putMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'message-2',
        conversationId: 'chat-1',
        content: 'Saved while streaming.',
        status: 'streaming',
      }),
    )
    expect(putConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'chat-1', provider: 'openai', model: 'gpt-5.6-terra' }),
    )
  })
})
