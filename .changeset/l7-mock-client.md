---
"tauri-invoke-binding": minor
---

Add L7 mocking support (`tauri-invoke-binding/testing`): `createMockClient` builds a fully-typed mock client from a handler map keyed off your `CommandMap`, with a never-throws `.safe.*` call site, `mockTransportError` to inject any `TransportError` kind on demand, recorded call history (`__mock.calls`/`callsFor`/`reset`), runtime handler overrides (`__mock.setHandlers`), and a configurable policy for unregistered commands (`unknownCommand: 'throw' | 'command-not-found'`) — issue #26. Independent of `@tauri-apps/api/mocks`' `mockIPC`; the whole surface runs in plain vitest with no Tauri webview.
