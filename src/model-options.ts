import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ModelInfo } from "@opencode/client"

type ModelKey = { providerID: string; modelID: string }
export type ModelPreferences = { favorite: ModelKey[]; recent: ModelKey[] }

/** Read OpenCode's local model preferences without modifying them. */
export async function readModelPreferences(path = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "model.json")): Promise<ModelPreferences> {
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid preferences")
    const value = data as Record<string, unknown>
    const parse = (items: unknown): ModelKey[] => Array.isArray(items) ? items.flatMap((item) =>
      item && typeof item === "object" && typeof item.providerID === "string" && typeof item.modelID === "string"
        ? [{ providerID: item.providerID, modelID: item.modelID }] : [],
    ) : []
    return { favorite: parse(value.favorite), recent: parse(value.recent) }
  } catch {
    return { favorite: [], recent: [] }
  }
}

/** Group only models available to the target session; never duplicate entries. */
export function modelOptions<T extends Pick<ModelInfo, "id" | "providerID" | "name">>(models: T[], preferences: ModelPreferences) {
  const seen = new Set<string>()
  const key = (providerID: string, modelID: string) => JSON.stringify([providerID, modelID])
  const group = (items: ModelKey[], category: string) => items.flatMap((item) => {
    const id = key(item.providerID, item.modelID)
    const model = models.find((candidate) => candidate.providerID === item.providerID && candidate.id === item.modelID)
    if (!model || seen.has(id)) return []
    seen.add(id)
    return [{ title: model.name, description: model.providerID, category, value: model }]
  })
  const favorites = group(preferences.favorite, "Favorites")
  const recent = group(preferences.recent, "Recent")
  const rest = models.flatMap((model) => {
    const id = key(model.providerID, model.id)
    if (seen.has(id)) return []
    seen.add(id)
    return [{ title: model.name, description: model.providerID, category: model.providerID, value: model }]
  })
  return [...favorites, ...recent, ...rest]
}
