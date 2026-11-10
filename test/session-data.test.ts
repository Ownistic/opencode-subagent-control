import { describe, expect, test } from "bun:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { contextUsage, sessionTodos, todoMarker } from "../src/session-data"

const message = (id: string, content: unknown[], tokens?: unknown): SessionMessageInfo => ({
  id, type: "assistant", content, tokens, model: { providerID: "p", id: "m" },
} as SessionMessageInfo)
const todo = (todos: unknown, status = "completed") => ({ type: "tool", name: "todowrite", state: { status, input: { todos } } })

describe("child sidebar data", () => {
  test("uses the main TUI's markers for every todo status", () => {
    expect([todoMarker("pending"), todoMarker("in_progress"), todoMarker("completed"), todoMarker("cancelled")]).toEqual(["[ ]", "[•]", "[✓]", "[-]"])
  })
  test("uses the latest completed todo list before the revert boundary", () => {
    const messages = [message("a", [todo([{ content: "first", status: "pending" }])]), message("b", [todo([{ content: "second", status: "completed" }])])]
    expect(sessionTodos(messages)).toEqual([{ content: "second", status: "completed" }])
    expect(sessionTodos(messages, "b")).toEqual([{ content: "first", status: "pending" }])
  })
  test("ignores incomplete calls and handles malformed todos", () => {
    expect(sessionTodos([message("a", [todo([{ content: "valid", status: "unknown" }, null, []])]), message("b", [todo([], "running")])])).toEqual([{ content: "valid", status: "pending" }])
  })
  test("uses the latest child usage and model's context limit", () => {
    const tokens = { input: 40, output: 5, reasoning: 5, cache: { read: 30, write: 20 } }
    const models = [{ providerID: "p", id: "m", limit: { context: 200 } }] as ModelInfo[]
    expect(contextUsage([message("a", [], tokens)], models)).toEqual({ tokens: 100, percent: 50 })
    expect(contextUsage([message("a", [], tokens)], models, "a")).toBeUndefined()
  })
})
