import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin],
  external: ["@opencode/plugin", "@opencode/plugin/*", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/*"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exitCode = 1
}
