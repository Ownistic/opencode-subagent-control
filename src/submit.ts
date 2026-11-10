import type { Context } from "@opencode/plugin/tui/context"

/** Submit exactly to the visible child. Never reinterpret unknown slash commands as prompts. */
export async function submitInput(context: Context, sessionID: string, raw: string, selectModel: () => Promise<void>) {
  const text = raw.trim()
  if (!text) return false
  if (text === "/model") {
    await selectModel()
    return true
  }
  if (text === "/subagent-panel") {
    if (!context.ui.panel.open("subagents-control.details")) throw new Error("Open a session first")
    return true
  }
  if (text.startsWith("/")) {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text)
    if (!match) return false
    await context.client.session.command({ sessionID, name: match[1], text: match[2] ?? "", delivery: "steer" })
    return true
  }
  await context.client.session.prompt({ sessionID, text, delivery: "steer" })
  return true
}
