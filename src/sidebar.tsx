import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { contextUsage, sessionTodos, todoMarker } from "./session-data"
import { magicSnapshot, type MagicSnapshot } from "./magic-context"

export const PANEL = "subagents-control.details"

export function Sidebar(props: { panel: PanelInput }) {
  const context = usePlugin()
  const id = () => props.panel.sessionID
  const session = () => context.data.session.get(id())
  const messages = () => context.data.session.message.list(id())
  const todos = createMemo(() => sessionTodos(messages(), session()?.revert?.messageID))
  const [todoView, updateTodoView] = context.storage.store("todo-view", { initial: { open: true } })
  const remainingTodos = createMemo(() => todos().filter((todo) => todo.status === "pending" || todo.status === "in_progress").length)
  const usage = createMemo(() => contextUsage(messages(), context.data.location.model.list(session()?.location), session()?.revert?.messageID))
  const [magic, setMagic] = createSignal<MagicSnapshot>()
  createEffect(() => {
    const sessionID = id()
    const directory = session()?.location.directory
    setMagic(undefined)
    if (!directory) return
    let disposed = false
    let request = 0
    const refresh = () => {
      const sequence = ++request
      void magicSnapshot(directory, sessionID).then((snapshot) => { if (!disposed && sequence === request) setMagic(snapshot) })
    }
    refresh()
    const timer = setInterval(refresh, 15000)
    onCleanup(() => { disposed = true; clearInterval(timer) })
  })
  onMount(() => {
    void context.data.session.message.sync(id()).catch(() => {})
    void context.data.location.model.sync(session()?.location).catch(() => {})
  })
  return (
    <box backgroundColor={context.theme.background.raised.base} height="100%" padding={1} flexDirection="column">
      <text fg={context.theme.text.base}><b>{session()?.title ?? "Subagent"}</b></text>
      <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <box gap={1} flexDirection="column" paddingTop={1}>
          <box>
            <text fg={context.theme.text.base}><b>Context</b></text>
            <Show when={usage()} fallback={<text fg={context.theme.text.muted}>No usage available yet</text>}>
              {(value) => <><text fg={context.theme.text.muted}>{value().tokens.toLocaleString()} tokens</text><Show when={value().percent !== undefined}><text fg={context.theme.text.muted}>{value().percent}% used</text></Show></>}
            </Show>
            <text fg={context.theme.text.muted}>${context.data.session.cost(id()).toFixed(4)} spent</text>
          </box>
          <Show when={todos().length > 0}>
            <box flexDirection="column">
              <box flexDirection="row" gap={1} onMouseDown={() => {
                if (todos().length <= 2) return
                void updateTodoView((view) => { view.open = !view.open }).catch(() => {
                  context.ui.toast.show({ message: "Could not save Todo view", variant: "error" })
                })
              }}>
                <Show when={todos().length > 2}><text fg={context.theme.text.base}>{todoView.open ? "▼" : "▶"}</text></Show>
                <text fg={context.theme.text.base}><b>Todo</b><Show when={todos().length > 2 && !todoView.open}><span style={{ fg: context.theme.text.muted }}> ({remainingTodos()} remaining)</span></Show></text>
              </box>
              <Show when={todos().length <= 2 || todoView.open}>
                <For each={todos()}>{(todo) => {
                  const color = () => todo.status === "in_progress" ? context.theme.text.feedback.warning.base : todo.status === "cancelled" ? context.theme.text.faint : context.theme.text.muted
                  return <box flexDirection="row"><text flexShrink={0} fg={color()}>{todoMarker(todo.status)} </text><text flexGrow={1} minWidth={0} wrapMode="word" fg={color()} attributes={todo.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined}>{todo.content}</text></box>
                }}</For>
              </Show>
            </box>
          </Show>
          <box>
            <text fg={context.theme.text.base}><b>Magic Context</b></text>
            <Show when={magic()} fallback={<text fg={context.theme.text.muted}>Session data unavailable</text>}>
              {(snapshot) => <>
                <text fg={context.theme.text.muted}>{snapshot().inputTokens.toLocaleString()} / {snapshot().contextLimit.toLocaleString()} tokens</text>
                <text fg={context.theme.text.muted}>{snapshot().compartmentCount} compartments · {snapshot().memoryCount} memories</text>
                <text fg={context.theme.text.muted}>Historian: {snapshot().historianRunning ? "running" : "idle"}</text>
              </>}
            </Show>
          </box>
          <box>
            <text fg={context.theme.text.base}><b>Session</b></text>
            <text fg={context.theme.text.muted}>{session()?.agent ?? "Subagent"} · {context.data.session.status(id())}</text>
            <Show when={session()?.model}>{(model) => <text fg={context.theme.text.muted}>{model().providerID}/{model().id}{model().variant ? ` · ${model().variant}` : ""}</text>}</Show>
            <Show when={session()?.location.directory}>{(directory) => <text fg={context.theme.text.muted}>{context.ui.format.path(directory())}</text>}</Show>
          </box>
        </box>
      </scrollbox>
    </box>
  )
}
