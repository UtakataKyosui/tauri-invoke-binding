import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/specta.ts', 'src/events.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // @tauri-apps/api is a peer dependency — never bundle it.
  external: [/^@tauri-apps\//],
})
