import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { modelOptions, readModelPreferences } from "../src/model-options"

test("groups available models by favorites, recents, and provider without duplicates", () => {
  const models = [{ id: "a", providerID: "one", name: "Alpha" }, { id: "b", providerID: "two", name: "Beta" }, { id: "c", providerID: "one", name: "Gamma" }]
  const options = modelOptions(models, {
    favorite: [{ providerID: "two", modelID: "b" }, { providerID: "two", modelID: "b" }, { providerID: "none", modelID: "gone" }],
    recent: [{ providerID: "two", modelID: "b" }, { providerID: "one", modelID: "c" }],
  })
  expect(options.map((option) => [option.title, option.category])).toEqual([["Beta", "Favorites"], ["Gamma", "Recent"], ["Alpha", "one"]])
})

test("reads valid preferences and falls back when the file is missing or invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagent-model-test-"))
  const path = join(dir, "model.json")
  try {
    expect(await readModelPreferences(path)).toEqual({ favorite: [], recent: [] })
    await writeFile(path, JSON.stringify({ favorite: [{ providerID: "p", modelID: "m" }, { providerID: 5 }], recent: null }))
    expect(await readModelPreferences(path)).toEqual({ favorite: [{ providerID: "p", modelID: "m" }], recent: [] })
    await writeFile(path, "invalid")
    expect(await readModelPreferences(path)).toEqual({ favorite: [], recent: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
