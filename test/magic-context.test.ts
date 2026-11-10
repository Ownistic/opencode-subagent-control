import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { magicSnapshot } from "../src/magic-context"

test("Magic Context accepts only authenticated matching child snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-magic-test-"))
  const original = process.env.XDG_DATA_HOME
  let resultID = "child"
  let received = ""
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      if (new URL(request.url).pathname === "/health") return Response.json({ pid: 42, instance_id: "instance" })
      received = request.headers.get("authorization") ?? ""
      const body = await request.json() as { sessionId: string }
      expect(body.sessionId).toBe("child")
      return Response.json({ sessionId: resultID, inputTokens: 50, contextLimit: 100, compartmentCount: 2, memoryCount: 3, historianRunning: false })
    },
  })
  try {
    process.env.XDG_DATA_HOME = root
    const directory = "/test/project"
    const hash = createHash("sha256").update(directory).digest("hex").slice(0, 16)
    const path = join(root, "cortexkit", "magic-context", "rpc", hash)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, "port-42.json"), JSON.stringify({ port: server.port, pid: 42, token: "test-token", instance_id: "instance" }))
    expect((await magicSnapshot(directory, "child"))?.inputTokens).toBe(50)
    expect(received).toBe("Bearer test-token")
    resultID = "parent"
    expect(await magicSnapshot(directory, "child")).toBeUndefined()
  } finally {
    server.stop(true)
    if (original === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = original
    await rm(root, { recursive: true, force: true })
  }
})
