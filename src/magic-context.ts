import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/** Best-effort adapter for Magic Context 0.37's local, authenticated sidebar RPC.
 * This is not a public OpenCode API. Never fall back to another session's data. */
export type MagicSnapshot = { sessionId: string; inputTokens: number; contextLimit: number; compartmentCount: number; memoryCount: number; historianRunning: boolean }

export async function magicSnapshot(directory: string, sessionId: string): Promise<MagicSnapshot | undefined> {
  if (!directory || !sessionId) return
  const hash = createHash("sha256").update(directory.replace(/\/+$/, "")).digest("hex").slice(0, 16)
  const root = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "cortexkit", "magic-context", "rpc", hash)
  let files: string[]
  try { files = (await readdir(root)).filter((file) => /^port-.*\.json$/.test(file)) } catch { return }
  const records = await Promise.all(files.map(async (file) => {
    try {
      const record = JSON.parse(await readFile(join(root, file), "utf8"))
      if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !Number.isInteger(record.pid) || typeof record.token !== "string" || typeof record.instance_id !== "string") return
      return record as { port: number; pid: number; token: string; instance_id: string; started_at?: number }
    } catch { return }
  }))
  for (const record of records.filter((item) => item !== undefined).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))) {
    try {
      const origin = `http://127.0.0.1:${record.port}`
      const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1500) })
      if (!health.ok) continue
      const info = await health.json() as { pid?: number; instance_id?: string }
      if (info.pid !== record.pid || info.instance_id !== record.instance_id) continue
      const response = await fetch(`${origin}/rpc/sidebar-snapshot`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${record.token}` },
        body: JSON.stringify({ sessionId, directory }), signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) continue
      const result = await response.json() as Partial<MagicSnapshot>
      if (result.sessionId !== sessionId || typeof result.inputTokens !== "number" || typeof result.contextLimit !== "number" || typeof result.compartmentCount !== "number" || typeof result.memoryCount !== "number" || typeof result.historianRunning !== "boolean") continue
      return result as MagicSnapshot
    } catch { /* Optional integration: stale endpoints and missing servers are normal. */ }
  }
}
