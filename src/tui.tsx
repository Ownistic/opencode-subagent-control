import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { TextareaRenderable } from "@opentui/core"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { controls } from "./controls"
import { submitInput } from "./submit"
import { PANEL, Sidebar } from "./sidebar"

function ChildInput(props: { sessionID: string }) {
  const context = usePlugin()
  const [busy, setBusy] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [focused, setFocused] = createSignal(false)
  const [lines, setLines] = createSignal(1)
  const session = () => context.data.session.get(props.sessionID)
  const modelLabel = createMemo(() => {
    const model = session()?.model
    if (!model) return "Default model"
    const match = context.data.location.model.list(session()?.location)?.find((item) => item.providerID === model.providerID && item.id === model.id)
    return `${match?.name ?? model.id}${model.variant ? ` · ${model.variant}` : ""}`
  })
  const suggestions = createMemo(() => {
    const value = draft()
    if (!/^\/[^\s]*$/.test(value)) return []
    const commands = context.data.location.command.list(context.data.session.get(props.sessionID)?.location) ?? []
    return [...new Set(["model", "subagent-panel", ...commands.map((command) => command.name)])].filter((name) => name.startsWith(value.slice(1))).slice(0, 5)
  })
  let input: TextareaRenderable | undefined
  let popMode: (() => void) | undefined
  const release = () => { popMode?.(); popMode = undefined; setFocused(false) }
  const focus = () => {
    if (!input) return
    if (!popMode) popMode = context.keymap.mode.push("subagent-input")
    input.focus()
    setFocused(true)
  }
  context.keymap.layer(() => ({
    mode: "global",
    commands: [{ id: "subagents.input.focus", title: "Focus subagent input", group: "Subagents", palette: true, bind: "ctrl+alt+i", run: focus }],
    bindings: ["subagents.input.focus"],
  }))
  context.keymap.layer(() => ({
    mode: "subagent-input",
    commands: [
      { bind: "escape", run: () => { input?.blur(); release() } },
      { bind: "tab", run: () => { const choice = suggestions()[0]; if (choice && input) { input.setText(`/${choice} `); input.gotoBufferEnd() } } },
    ],
  }))
  context.keymap.layer(() => ({
    mode: "composer",
    priority: 10,
    commands: [{
      bind: "return",
      run: () => {
        if (!context.keymap.commands().some((command) => command.id === "composer.subagent.select")) return false
        context.keymap.dispatch("composer.subagent.select")
        context.renderer.requestAnimationFrame(() => {
          const route = context.ui.router.current()
          if (route.type === "session" && route.sessionID === props.sessionID && input && !input.isDestroyed) focus()
        })
      },
    }],
  }))
  onMount(() => {
    void context.data.location.command.sync(context.data.session.get(props.sessionID)?.location).catch(() => {})
    void context.data.location.model.sync(session()?.location).catch(() => {})
    if (context.renderer.terminalWidth > 120) context.ui.panel.open(PANEL)
    context.renderer.requestAnimationFrame(() => {
      if (input && !input.isDestroyed) focus()
    })
  })
  onCleanup(() => { release(); context.ui.panel.close() })
  const submit = async (value: string) => {
    if (busy() || !value.trim()) return
    setBusy(true)
    try {
      const accepted = await submitInput(context, props.sessionID, value, () => controls(context).model(props.sessionID))
      if (accepted && input && input.plainText === value) input.clear()
    } catch (error) {
      context.ui.toast.show({ title: "Could not submit to subagent", message: error instanceof Error ? error.message : String(error), variant: "error" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box border={["left"]} borderStyle="heavy" borderColor={focused() ? context.theme.hue.accent[500] : context.theme.text.muted}>
        <box flexDirection="column" flexGrow={1} minWidth={0} paddingLeft={2} paddingRight={2} paddingTop={1} backgroundColor={context.theme.decrease(context.theme.background.raised.base)}>
          <textarea
            width="100%"
            minHeight={1}
            maxHeight={Math.max(3, Math.floor(context.renderer.terminalHeight / 3))}
            height={lines()}
            wrapMode="word"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={context.theme.text.base}
            focusedTextColor={context.theme.text.base}
            placeholderColor={context.theme.text.muted}
            cursorColor={context.theme.text.base}
            keyBindings={[{ name: "return", action: "submit" }, { name: "return", shift: true, action: "newline" }]}
            ref={(value: TextareaRenderable) => {
              input = value
              value.on("blurred", release)
            }}
            placeholder={busy() ? "Submitting…" : "Steer this subagent…"}
            onMouseDown={focus}
            onContentChange={() => { if (input) { setDraft(input.plainText); setLines(Math.max(1, input.virtualLineCount)) } }}
            onSubmit={() => { if (input) void submit(input.plainText) }}
          />
          <box flexDirection="row" paddingTop={1} gap={1} minWidth={0}>
            <text fg={context.theme.text.base} wrapMode="none" truncate><b>{session()?.agent ?? "Subagent"}</b></text>
            <text fg={context.theme.text.muted} flexShrink={1} wrapMode="none" truncate onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); void controls(context).model(props.sessionID) }}>{modelLabel()}</text>
          </box>
        </box>
      </box>
      <Show when={suggestions().length > 0}><text fg={context.theme.text.muted}>Tab: {suggestions().map((item) => `/${item}`).join("  ")}</text></Show>
      <text fg={context.theme.text.muted} wrapMode="none" truncate>enter send · shift+enter newline · /model · esc subagents</text>
    </box>
  )
}

export default Plugin.define({
  id: "subagents-control.tui",
  setup(context) {
    const actions = controls(context)
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "subagents.steer", title: "Steer subagent", group: "Subagents", palette: true, slash: { name: "subagent-steer" }, run: actions.steer },
        { id: "subagents.model", title: "Change subagent model", group: "Subagents", palette: true, slash: { name: "subagent-model" }, run: actions.model },
        { id: "subagents.command", title: "Run subagent command", group: "Subagents", palette: true, slash: { name: "subagent-command" }, run: actions.command },
        { id: "subagents.open", title: "Open subagent", group: "Subagents", palette: true, slash: { name: "subagent-open" }, run: actions.open },
        { id: "subagents.panel", title: "Open session details panel", group: "Subagents", palette: true, slash: { name: "subagent-panel" }, run: () => { if (!context.ui.panel.open(PANEL)) context.ui.toast.show({ message: "Open a session first", variant: "warning" }) } },
      ],
    }))
    const stopPanel = context.ui.slot({ append: "session.panel", render: (panel) => <Show when={panel.name === PANEL}><Sidebar panel={panel} /></Show> })
    const stopInput = context.ui.slot({ append: "session.composer.top", render: ({ sessionID }) => <Show when={context.data.session.get(sessionID)?.parentID}><ChildInput sessionID={sessionID} /></Show> })
    return () => { stopInput(); stopPanel() }
  },
})
