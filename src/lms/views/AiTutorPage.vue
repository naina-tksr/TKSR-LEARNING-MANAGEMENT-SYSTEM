<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api, formatApiError } from '../api'
import type { AiMessage, Conversation, Paginated } from '../types'
import { formatRelative } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'

const conversations = ref<Conversation[]>([])
const activeId = ref<number | null>(null)
const messages = ref<AiMessage[]>([])
const input = ref('')
const sending = ref(false)
const loadingList = ref(true)
const loadingMessages = ref(false)
const error = ref<unknown>(null)
const sendError = ref('')

const messagesEl = ref<HTMLElement | null>(null)

const activeConversation = computed(
  () => conversations.value.find((item) => item.id === activeId.value) ?? null,
)

const suggestions = [
  'Explain the bias-variance tradeoff simply.',
  'Give me a hint (not the answer) for gradient descent tuning.',
  'Quiz me on Python list comprehensions.',
  'What should I review before my next lesson?',
]

async function loadConversations(): Promise<void> {
  loadingList.value = true
  try {
    const result = await api.get<Paginated<Conversation>>('/ai/conversations?limit=50')
    conversations.value = result.data
  } catch (cause) {
    error.value = cause
  } finally {
    loadingList.value = false
  }
}

async function openConversation(id: number): Promise<void> {
  if (sending.value) return
  activeId.value = id
  sendError.value = ''
  loadingMessages.value = true
  try {
    const result = await api.get<{ conversation: Conversation; messages: AiMessage[] }>(`/ai/conversations/${id}`)
    messages.value = result.messages
    await scrollToBottom()
  } catch (cause) {
    error.value = cause
  } finally {
    loadingMessages.value = false
  }
}

async function newConversation(): Promise<void> {
  if (sending.value) return
  try {
    const result = await api.post<{ conversation: Conversation }>('/ai/conversations', {})
    conversations.value.unshift(result.conversation)
    activeId.value = result.conversation.id
    messages.value = []
    sendError.value = ''
    input.value = ''
  } catch (cause) {
    sendError.value = formatApiError(cause)
  }
}

async function removeConversation(conversation: Conversation): Promise<void> {
  if (!window.confirm(`Delete “${conversation.title}”?`)) return
  try {
    await api.del(`/ai/conversations/${conversation.id}`)
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
    if (activeId.value === conversation.id) {
      if (conversations.value.length > 0) await openConversation(conversations.value[0].id)
      else await newConversation()
    }
  } catch (cause) {
    sendError.value = formatApiError(cause)
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

watch(messages, () => void scrollToBottom(), { deep: true })

async function send(preset?: string): Promise<void> {
  const content = (preset ?? input.value).trim()
  if (!content || sending.value) return
  sendError.value = ''
  sending.value = true
  const pendingUser: AiMessage = {
    id: -Date.now(),
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
  messages.value.push(pendingUser)
  input.value = ''
  await scrollToBottom()

  try {
    // Ensure there is a conversation, titled after the first message.
    if (activeId.value === null) {
      const created = await api.post<{ conversation: Conversation }>('/ai/conversations', {
        title: content.length > 60 ? `${content.slice(0, 60)}…` : content,
      })
      conversations.value.unshift(created.conversation)
      activeId.value = created.conversation.id
    }
    const result = await api.post<{ message: AiMessage; conversation: Conversation }>(
      `/ai/conversations/${activeId.value}/messages`,
      { content },
    )
    // Replace the optimistic entry with the persisted one and add the reply.
    messages.value = messages.value.filter((message) => message.id !== pendingUser.id)
    messages.value.push(pendingUser, result.message)

    const index = conversations.value.findIndex((item) => item.id === activeId.value)
    if (index >= 0) {
      const [updated] = conversations.value.splice(index, 1)
      conversations.value.unshift({ ...updated, ...result.conversation })
    }
  } catch (cause) {
    sendError.value = formatApiError(cause)
    messages.value = messages.value.filter((message) => message.id !== pendingUser.id)
    input.value = content
  } finally {
    sending.value = false
    await scrollToBottom()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

onMounted(async () => {
  await loadConversations()
  if (conversations.value.length > 0) await openConversation(conversations.value[0].id)
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>AI Learning Tutor</h1>
        <p class="subtitle">
          Hints, explanations and practice — the tutor deliberately refuses to complete graded assignments for you.
        </p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button" @click="newConversation()">+ New chat</button>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Something went wrong" @retry="loadConversations()" />

    <div class="chat-shell">
      <aside class="chat-list" aria-label="Conversations">
        <div class="list-head">
          <strong class="small">Conversations</strong>
          <span class="small muted">{{ conversations.length }}</span>
        </div>
        <LoadingBlock v-if="loadingList" label="" />
        <div v-else-if="conversations.length === 0" class="small muted" style="padding: 14px">
          No chats yet — start one with the button above.
        </div>
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          class="chat-item"
          :class="{ active: conversation.id === activeId }"
          type="button"
          @click="openConversation(conversation.id)"
        >
          {{ conversation.title }}
          <span class="small muted" style="display: block">{{ formatRelative(conversation.updatedAt) }}</span>
        </button>
      </aside>

      <section class="chat-panel">
        <div ref="messagesEl" class="chat-messages" aria-live="polite">
          <div v-if="loadingMessages" style="margin: auto"><div class="spinner" /></div>

          <template v-else>
            <div v-if="messages.length === 0" class="chat-empty">
              <div style="font-size: 1.8rem">✦</div>
              <h3>Ask the Learning Tutor</h3>
              <p>
                Stuck on a concept? Ask for an explanation, a hint, or a practice question. For graded assignments the
                tutor will guide you instead of writing your answer.
              </p>
              <div class="suggestions">
                <button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="send(suggestion)">
                  {{ suggestion }}
                </button>
              </div>
            </div>

            <div
              v-for="message in messages"
              :key="message.id"
              class="bubble"
              :class="message.role === 'user' ? 'user' : 'assistant'"
            >
              {{ message.content }}
              <span class="bubble-time">{{ formatRelative(message.createdAt) }}</span>
            </div>

            <div v-if="sending" class="bubble assistant">
              <span class="spinner spinner-sm" /> Thinking…
            </div>
          </template>
        </div>

        <div v-if="sendError" class="error-banner" style="margin: 0 14px 10px">
          <span>{{ sendError }}</span>
          <button class="close" type="button" @click="sendError = ''">✕</button>
        </div>

        <div class="chat-composer">
          <textarea
            v-model="input"
            rows="2"
            maxlength="4000"
            placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)"
            aria-label="Message the tutor"
            @keydown="onKeydown"
          />
          <button class="btn btn-primary" type="button" :disabled="sending || !input.trim()" @click="send()">
            <span v-if="sending" class="spinner spinner-sm" />
            Send
          </button>
        </div>
      </section>
    </div>

    <div v-if="activeConversation" class="text-right" style="margin-top: 10px">
      <button class="btn btn-sm btn-ghost" type="button" @click="removeConversation(activeConversation)">
        Delete this conversation
      </button>
    </div>
  </div>
</template>
