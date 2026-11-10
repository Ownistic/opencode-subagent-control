import type { ModelInfo, SessionMessageInfo } from "@opencode/client"

export type Todo = { content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }

export function todoMarker(status: Todo["status"]) {
  switch (status) {
    case "completed": return "[✓]"
    case "in_progress": return "[•]"
    case "cancelled": return "[-]"
    default: return "[ ]"
  }
}

function visibleMessages(messages: readonly SessionMessageInfo[], boundary?: string) {
  const index = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  return index < 0 ? messages : messages.slice(0, index)
}

export function sessionTodos(messages: readonly SessionMessageInfo[], boundary?: string): Todo[] {
  const visible = visibleMessages(messages, boundary)
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i]
    if (message.type !== "assistant") continue
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j]
      if (part.type !== "tool" || part.name !== "todowrite" || part.state.status !== "completed") continue
      const items = part.state.input.todos
      if (!Array.isArray(items)) return []
      return items.flatMap((item): Todo[] => {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.content !== "string" || !item.content) return []
        const status = item.status === "in_progress" || item.status === "completed" || item.status === "cancelled" ? item.status : "pending"
        return [{ content: item.content, status }]
      })
    }
  }
  return []
}

export function contextUsage(messages: readonly SessionMessageInfo[], models: readonly ModelInfo[] | undefined, boundary?: string) {
  const visible = visibleMessages(messages, boundary)
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i]
    if (message.type === "compaction" && message.status === "completed") break
    if (message.type !== "assistant" || !message.tokens) continue
    const token = message.tokens
    const tokens = token.input + token.output + token.reasoning + token.cache.read + token.cache.write
    if (!tokens) continue
    const limit = models?.find((model) => model.providerID === message.model.providerID && model.id === message.model.id)?.limit.context
    return { tokens, percent: limit ? Math.round(tokens / limit * 100) : undefined }
  }
}
