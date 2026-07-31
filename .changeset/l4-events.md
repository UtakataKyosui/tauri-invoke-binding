---
"tauri-invoke-binding": minor
---

Add L4 event support (`tauri-invoke-binding/events`): `createEventClient` with typed `emitTo` and the 6-way `EventTarget` union (#19), `AbortSignal`-based `listen`/`once` plus `createEventScope` for bulk unlisten (#20), and `BuiltinEventMap` with typed payloads for all 16 built-in `TauriEvent`s (#21).
