import { describe, expect, mock, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { submitInput } from "../src/submit"

function setup() {
  const prompt = mock(async (_input: any) => ({}))
  const command = mock(async (_input: any) => {})
  const model = mock(async () => {})
  const context = { client: { session: { prompt, command } } } as unknown as Context
  return { prompt, command, model, context }
}

describe("in-view input", () => {
  test("steers the visible child", async () => {
    const f = setup()
    expect(await submitInput(f.context, "child", "  Focus on tests  ", f.model)).toBe(true)
    expect(f.prompt).toHaveBeenCalledWith({ sessionID: "child", text: "Focus on tests", delivery: "steer" })
  })

  test("passes server commands and arguments to the visible child", async () => {
    const f = setup()
    await submitInput(f.context, "child", "/review --staged", f.model)
    expect(f.command).toHaveBeenCalledWith({ sessionID: "child", name: "review", text: "--staged", delivery: "steer" })
    expect(f.prompt).not.toHaveBeenCalled()
  })

  test("opens the model selector without sending a prompt", async () => {
    const f = setup()
    await submitInput(f.context, "child", "/model", f.model)
    expect(f.model).toHaveBeenCalledTimes(1)
    expect(f.command).not.toHaveBeenCalled()
  })

  test("opens the child panel locally", async () => {
    const f = setup()
    const open = mock(() => true)
    const context = { ...f.context, ui: { panel: { open } } } as unknown as Context
    expect(await submitInput(context, "child", "/subagent-panel", f.model)).toBe(true)
    expect(open).toHaveBeenCalledWith("subagents-control.details")
    expect(f.command).not.toHaveBeenCalled()
  })

  test("leaves empty input untouched and propagates failures", async () => {
    const f = setup()
    expect(await submitInput(f.context, "child", "   ", f.model)).toBe(false)
    f.command.mockRejectedValueOnce(new Error("Command not found"))
    await expect(submitInput(f.context, "child", "/missing", f.model)).rejects.toThrow("Command not found")
  })
})
