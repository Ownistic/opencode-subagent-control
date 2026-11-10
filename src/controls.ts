import type { Context } from "@opencode/plugin/tui/context"

type Client = Context["client"]

/** Find descendants through the server, including children not in the TUI cache. */
export async function descendants(client: Client, parentID: string) {
  const result: Awaited<ReturnType<Client["session"]["get"]>>[] = []
  const pending = [parentID]
  const seen = new Set(pending)
  while (pending.length) {
    const parent = pending.shift()!
    let cursor: string | undefined
    do {
      const page = await client.session.list(cursor ? { cursor } : { parentID: parent, limit: 100 })
      for (const child of page.data) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        result.push(child)
        pending.push(child.id)
      }
      cursor = page.cursor.next ?? undefined
    } while (cursor)
  }
  return result
}

export async function pickTarget(context: Context): Promise<string | undefined> {
  const route = context.ui.router.current()
  if (route.type !== "session") {
    context.ui.toast.show({ message: "Open a session first", variant: "warning" })
    return
  }
  const current = await context.client.session.get({ sessionID: route.sessionID })
  if (current.parentID) return current.id
  const children = await descendants(context.client, current.id)
  if (!children.length) {
    context.ui.toast.show({ message: "No subagents found in this session", variant: "warning" })
    return
  }
  return context.ui.dialog.select({
    title: "Select a subagent",
    options: children.map((child) => ({
      title: child.title || child.agent || child.id,
      description: `${child.agent ?? "subagent"} · ${child.id}`,
      value: child.id,
    })),
  })
}

export function controls(context: Context) {
  const notify = (message: string) => context.ui.toast.show({ message, variant: "success" })
  const guarded = (action: (target?: string) => Promise<void>) => async (target?: string) => {
    try { await action(target) } catch (error) {
      context.ui.toast.show({ title: "Subagent control failed", message: error instanceof Error ? error.message : String(error), variant: "error" })
    }
  }
  return {
    steer: guarded(async () => {
      const sessionID = await pickTarget(context)
      if (!sessionID) return
      const text = await context.ui.dialog.prompt({ title: "Steer subagent", placeholder: "Enter an instruction" })
      if (!text?.trim()) return
      await context.client.session.prompt({ sessionID, text, delivery: "steer" })
      notify("Steering message submitted")
    }),
    model: guarded(async (target?: string) => {
      const sessionID = target ?? await pickTarget(context)
      if (!sessionID) return
      const session = await context.client.session.get({ sessionID })
      const models = (await context.client.model.list({ location: { directory: session.location.directory }, types: ["chat"] })).data
        .filter((model) => model.enabled && (!model.type || model.type === "chat"))
      const selected = await context.ui.dialog.select({
        title: "Select subagent model",
        options: models.map((model) => ({ title: model.name, description: `${model.providerID}/${model.id}`, value: model })),
      })
      if (!selected) return
      const variant = selected.variants.length ? await context.ui.dialog.select({
        title: "Select model variant",
        options: [
          { title: "Default", value: "" },
          ...selected.variants.map((item) => ({ title: item.id, value: item.id })),
        ],
      }) : ""
      if (variant === undefined) return
      await context.client.session.switchModel({ sessionID, model: { providerID: selected.providerID, id: selected.id, ...(variant ? { variant } : {}) } })
      notify("Model selected for subsequent requests")
    }),
    command: guarded(async () => {
      const sessionID = await pickTarget(context)
      if (!sessionID) return
      const session = await context.client.session.get({ sessionID })
      const commands = (await context.client.command.list({ location: { directory: session.location.directory } })).data
      if (!commands.length) {
        context.ui.toast.show({ message: "No server commands available", variant: "warning" })
        return
      }
      const name = await context.ui.dialog.select({ title: "Run a subagent command", options: commands.map((item) => ({ title: `/${item.name}`, description: item.description, value: item.name })) })
      if (!name) return
      const text = await context.ui.dialog.prompt({ title: `Arguments for /${name}`, placeholder: "Optional arguments" })
      if (text === undefined) return
      await context.client.session.command({ sessionID, name, text, delivery: "steer" })
      notify(`Command /${name} submitted`)
    }),
    open: guarded(async () => {
      const sessionID = await pickTarget(context)
      if (sessionID) context.ui.router.navigate({ type: "session", sessionID })
    }),
  }
}
