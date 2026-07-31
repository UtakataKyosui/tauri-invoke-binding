---
"tauri-invoke-binding": minor
---

Add L5 channel support (`invokeChannel`/`createChannel` consume `Channel<T>` as a backpressure-bounded `for await`-able stream tied to the owning command's promise, issue #22) and a `serde` tagged-enum narrowing helper covering all three representations (`matchExternallyTagged`/`matchInternallyTagged`/`matchAdjacentlyTagged`, issue #23). Add L6 raw IPC support: `createRawClient`/`RawCommand` for typed `tauri::ipc::Request` calls with headers (issue #24), and `BinaryCommand` for commands returning `tauri::ipc::Response` (`ArrayBuffer`), plus `toUint8Array`/`toBlob` conversion helpers (issue #25).
