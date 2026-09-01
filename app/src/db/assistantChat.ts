import { generateId } from 'ai'
import {
  db,
  SK,
  type AssistantConversationRecord,
  type AssistantMessageRecord,
} from './schema'
import type { AssistantProvider } from '../lib/assistant'

export type PersistableAssistantMessage = Omit<AssistantMessageRecord, 'conversationId'>

export interface DurableAssistantChat {
  conversationId: string | null
  messages: PersistableAssistantMessage[]
}

async function setCurrentConversation(id: string): Promise<void> {
  await db.settings.put({ key: SK.aiConversationId, value: id })
}

export async function createAssistantConversation(
  provider: AssistantProvider,
  model: string,
  now = new Date().toISOString(),
): Promise<string> {
  const id = generateId()
  await db.transaction('rw', db.assistantConversations, db.settings, async () => {
    await db.assistantConversations.put({
      id,
      provider,
      model,
      createdAt: now,
      updatedAt: now,
    })
    await setCurrentConversation(id)
  })
  return id
}

export async function loadAssistantChat(
  provider: AssistantProvider,
  model: string,
  legacyMessages: PersistableAssistantMessage[] = [],
): Promise<DurableAssistantChat> {
  const savedId = (await db.settings.get(SK.aiConversationId))?.value
  let conversation = savedId ? await db.assistantConversations.get(savedId) : undefined

  if (!conversation) {
    conversation = await db.assistantConversations.orderBy('updatedAt').last()
    if (conversation) await setCurrentConversation(conversation.id)
  }

  if (!conversation && legacyMessages.length) {
    const conversationId = await createAssistantConversation(provider, model)
    await db.assistantMessages.bulkPut(
      legacyMessages.map((message) => ({ ...message, conversationId })),
    )
    return { conversationId, messages: legacyMessages }
  }

  if (!conversation) return { conversationId: null, messages: [] }

  const stored = await db.assistantMessages
    .where('conversationId')
    .equals(conversation.id)
    .sortBy('createdAt')
  const recovered = stored.map(({ conversationId: _conversationId, ...message }) => ({
    ...message,
    status: message.status === 'streaming' ? ('stopped' as const) : message.status,
  }))

  const interrupted = stored
    .filter((message) => message.status === 'streaming')
    .map((message) => ({ ...message, status: 'stopped' as const }))
  if (interrupted.length) await db.assistantMessages.bulkPut(interrupted)

  return { conversationId: conversation.id, messages: recovered }
}

export async function saveAssistantMessage(
  conversationId: string,
  message: PersistableAssistantMessage,
  provider: AssistantProvider,
  model: string,
): Promise<void> {
  await db.transaction(
    'rw',
    db.assistantConversations,
    db.assistantMessages,
    async () => {
      const existing = await db.assistantConversations.get(conversationId)
      const conversation: AssistantConversationRecord = {
        id: conversationId,
        provider,
        model,
        createdAt: existing?.createdAt ?? message.createdAt,
        updatedAt: new Date().toISOString(),
      }
      await db.assistantConversations.put(conversation)
      await db.assistantMessages.put({ ...message, conversationId })
    },
  )
}

export async function deleteAssistantMessages(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.assistantMessages.bulkDelete(ids)
}
