import { describe, expect, mock, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { controls, descendants, pickTarget } from "../src/controls"

function fixture() {
  const child = { id: "child", parentID: "root", title: "Research", agent: "explore", location: { directory: "/project" } }
  const root = { id: "root", location: { directory: "/project" } }
  const sessions: Record<string, typeof root | typeof child> = { root, child }
  const toast = mock(() => {})
  const select = mock(async (_options: any): Promise<any> => undefined)
  const prompt = mock(async (_options: any): Promise<string | undefined> => undefined)
  const get = mock(async ({ sessionID }: { sessionID: string }) => sessions[sessionID])
  const list = mock(async ({ parentID }: { parentID?: string, cursor?: string }) => ({ data: parentID === "root" ? [child] : [], cursor: {} }))
  const send = mock(async (_input: any) => ({}))
  const switchModel = mock(async (_input: any) => {})
  const command = mock(async (_input: any) => {})
  const navigate = mock((_route: any) => {})
  const route = { type: "session", sessionID: "child" }
  const ctx = {
    client: { session: { get, list, prompt: send, switchModel, command }, model: { list: async () => ({ data: [{ id: "m", providerID: "p", name: "Model", enabled: true, type: "chat", variants: [{ id: "high" }] }] }) }, command: { list: async () => ({ data: [{ name: "review" }] }) } },
    ui: { router: { current: () => route, navigate }, dialog: { select, prompt }, toast: { show: toast } },
  } as unknown as Context
  return { ctx, route, toast, select, prompt, send, switchModel, command, list, navigate }
}

describe("subagent controls", () => {
  test("finds descendants across paginated session results", async () => {
    const f = fixture()
    f.list.mockImplementation(async ({ parentID, cursor }) => {
      if (parentID === "root") return { data: [{ id: "child", parentID: "root", title: "one", agent: "explore", location: { directory: "/project" } }], cursor: { next: "next" } }
      if (cursor === "next") return { data: [{ id: "child2", parentID: "root", title: "two", agent: "explore", location: { directory: "/project" } }], cursor: {} }
      return { data: [], cursor: {} }
    })
    expect((await descendants(f.ctx.client, "root")).map((item) => item.id)).toEqual(["child", "child2"])
  })

  test("selects current child or prompts for a descendant from the root", async () => {
    const f = fixture()
    expect(await pickTarget(f.ctx)).toBe("child")
    f.route.sessionID = "root"
    f.select.mockResolvedValueOnce("child")
    expect(await pickTarget(f.ctx)).toBe("child")
  })

  test("submits a steering message to the child", async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce("Please focus on tests")
    await controls(f.ctx).steer()
    expect(f.send).toHaveBeenCalledWith({ sessionID: "child", text: "Please focus on tests", delivery: "steer" })
  })

  test("changes the model and selected variant", async () => {
    const f = fixture()
    f.select.mockResolvedValueOnce({ id: "m", providerID: "p", variants: [{ id: "high" }] }).mockResolvedValueOnce("high")
    await controls(f.ctx).model()
    expect(f.switchModel).toHaveBeenCalledWith({ sessionID: "child", model: { providerID: "p", id: "m", variant: "high" } })
  })

  test("does not change the model when variant selection is cancelled", async () => {
    const f = fixture()
    f.select.mockResolvedValueOnce({ id: "m", providerID: "p", variants: [{ id: "high" }] }).mockResolvedValueOnce(undefined)
    await controls(f.ctx).model()
    expect(f.switchModel).not.toHaveBeenCalled()
  })

  test("runs a server command with arguments and steer delivery", async () => {
    const f = fixture()
    f.select.mockResolvedValueOnce("review")
    f.prompt.mockResolvedValueOnce("--staged")
    await controls(f.ctx).command()
    expect(f.command).toHaveBeenCalledWith({ sessionID: "child", name: "review", text: "--staged", delivery: "steer" })
  })

  test("reports request failures", async () => {
    const f = fixture()
    f.prompt.mockResolvedValueOnce("test")
    f.send.mockRejectedValueOnce(new Error("Unavailable"))
    await controls(f.ctx).steer()
    expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message: "Unavailable" }))
  })
})
