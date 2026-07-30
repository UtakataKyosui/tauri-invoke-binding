# tauri-invoke-binding

> **Status: pre-alpha — nothing is implemented yet.**
> This repository currently contains the design, the scope boundary and the issue
> backlog. The API sketches below are proposals, not shipped code. Feedback on the
> design is exactly what is wanted right now.

**日本語版: [README.ja.md](./README.ja.md)**

A type-safe **runtime layer** for Tauri v2 IPC.

`tauri-invoke-binding` does **not** generate TypeScript types from Rust. That problem
is already solved well by [`specta`/`tauri-specta`][tauri-specta] and [`ts-rs`][ts-rs].
What is still missing is everything *around* those generated bindings — typed
transport errors, middleware, mocking, `emitTo`, async-iterable channels, raw IPC.
That is the layer this package builds.

---

## Why

Tauri v2's front-end IPC surface is essentially untyped:

```ts
// @tauri-apps/api/core
function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T>
type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array
```

`cmd` is a bare `string`, `args` is an open record, and `T` is a generic the caller
asserts by hand. A typo in the command name, a missing argument, or a changed return
shape all fail at runtime rather than at compile time. On top of that:

- `#[tauri::command]` renames arguments to **camelCase** by default (`user_name` →
  `userName`), unless `rename_all` says otherwise — a convention invisible from TypeScript.
- Rust's `Result<T, E>` collapses into a **rejected promise**; the value in `catch` is
  `unknown`, and `E` is gone.
- Event names and channel payloads have no compile-time association with their types.

### But type generation already solves most of this

`tauri-specta` takes Rust as the source of truth and emits a `bindings.ts`:

```ts
export const commands = {
  helloWorld: (myName: string) => __TAURI_INVOKE<string>('hello_world', { myName }),
  hasError:   () => typedError<string, number>(__TAURI_INVOKE('has_error')),
}
export const events = { myDemoEvent: makeEvent<DemoEvent, DemoEvent>('myDemoEvent') }
type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }
```

Command names, argument names and types, return types, `Result<T, E>` as a discriminated
union, event payload types — all handled. **Rebuilding that would be reinventing the wheel,
and this project does not do it.**

### What is still missing

These gaps live *outside* codegen, in the runtime and DX layer. Most are tracked as open
issues upstream:

| Gap | Evidence |
| --- | --- |
| **Transport errors are absent from the types.** Generated code does `catch (e) { if (e instanceof Error) throw e; … }`, so argument-serialization failures, unregistered commands, denied permissions and panics **throw untyped**. Commands that don't return `Result` have no safe path at all. | [tauri-specta#169][up169] — *"The result was a transport error, which wasn't represented in the types at all"*, breaking exhaustive `ts-pattern` matching |
| **`emitTo` is unavailable.** The generated `makeEvent` exposes `listen` / `once` / `emit` only. | [tauri-specta#187][up187] |
| **`ipc::Request` / `ipc::Response` unsupported** — headers, raw bodies, `ArrayBuffer` responses. | [tauri-specta#170][up170] (labelled *blocked on other work*) |
| **No unit-testing story.** Generated commands are const arrow functions bound directly to `__TAURI_INVOKE`, awkward to stub. No fallback for non-Tauri contexts (browser, SSR, Storybook, vitest). | [tauri-specta#197][up197] |
| **Commands live in one flat namespace.** | [tauri-specta#172][up172] |
| **No middleware layer.** Retry, timeout, `AbortSignal` cancellation, logging and in-flight deduplication are hand-rolled per app — the generated code offers no seam to hook into. | structural |
| **Channels are callback-only.** `Channel<T>` drives `onmessage`; no `for await`, no completion or error convention. | `Channel<T>` API shape |
| **No runtime validation.** Generated types are compile-time only, so a forgotten regeneration silently drifts from reality. | by design |
| **No framework integration** (React hooks, Vue composables, TanStack Query). | out of scope upstream |

None of these require touching type generation. That is the space this package occupies.

## Positioning

```
Rust  #[tauri::command]
  │
  ├─ specta / tauri-specta / ts-rs   ← generates the types   (existing OSS; we depend on none of it)
  │
  └─ tauri-invoke-binding            ← consumes the types    (this package)
       ├─ typed transport errors
       ├─ middleware: retry / timeout / cancel / log / dedupe
       ├─ mocking + non-Tauri fallback
       ├─ emitTo, async-iterable channels, raw IPC
       └─ React / Vue integration
```

This is a **complement, not a replacement**. If you use `tauri-specta`, keep using it —
you hand its generated object straight to this package and redeclare nothing. If you
don't use it, a hand-written command map gets you the same call-site API, and migrating
to `tauri-specta` later leaves your calling code untouched.

## Non-goals

Stated up front, because they define the project as much as the features do:

- **No Rust-to-TypeScript type generation.** Delegated to `specta` / `tauri-specta` / `ts-rs`.
- **No proc-macro.** Your Rust code needs no changes to adopt this.
- **No Rust crate.** This is a TypeScript-only package.
- **No reimplementation of `@tauri-apps/api`.** It stays a thin peer dependency.

## Proposed API

> Design sketch. Names and shapes will change; that is what the [issue tracker](#roadmap)
> is for.

### Two entry points, one call-site API

```ts
// ── A. Using tauri-specta: hand over the generated object. Zero type redeclaration.
import { commands, events } from './bindings' // tauri-specta output
import { createClient } from 'tauri-invoke-binding/specta'

const api = createClient(commands, events, {
  middleware: [timeout(5_000), retry({ times: 3 }), logger()],
})

// ── B. Not using specta: declare by hand. Call sites are identical to A.
import { createClient, type Command } from 'tauri-invoke-binding'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
}
const api = createClient<AppCommands>()
```

### 1. A call that never throws

Both the Rust `Err(E)` **and** transport failures appear in the type:

```ts
const r = await api.safe.hasError()

if (r.status === 'ok') {
  r.data satisfies string
} else {
  switch (r.error.kind) {
    case 'command':            r.error.value satisfies number; break // Rust's Err(E)
    case 'deserialization':    break // ← thrown untyped today (upstream #169)
    case 'command-not-found':  break
    case 'permission-denied':  break
    case 'panic':              break
    case 'aborted':            break
    case 'not-in-tauri':       break
  }
  // exhaustiveness is enforced — no silent fall-through
}
```

### 2. Cancellation and middleware

```ts
await api.hasError({ signal: AbortSignal.timeout(1_000) })
```

### 3. `emitTo` (upstream gap [#187][up187])

```ts
await api.events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, payload)
```

### 4. Channels as async iterables

```ts
for await (const ev of api.channel<DownloadEvent>('download', { url })) {
  // ev: DownloadEvent
}
```

### 5. Testing (upstream gap [#197][up197])

```ts
import { createMockClient } from 'tauri-invoke-binding/testing'

const api = createMockClient<AppCommands>({
  hello_world: ({ myName }) => `hi ${myName}`,
})
```

## How it compares

| | [tauri-specta][tauri-specta] | [TauRPC][taurpc] | [ts-rs][ts-rs] | **tauri-invoke-binding** |
| --- | --- | --- | --- | --- |
| Generates TS types from Rust | ✅ | ✅ | ✅ (types only) | ❌ **by design** |
| Requires Rust-side changes | proc-macro | trait macros | derive | **none** |
| Typed transport errors | ❌ ([#169][up169]) | ❌ | n/a | ✅ planned |
| Middleware (retry/timeout/cancel) | ❌ | ❌ | n/a | ✅ planned |
| Mocking / non-Tauri fallback | ❌ ([#197][up197]) | ❌ | n/a | ✅ planned |
| `emitTo` | ❌ ([#187][up187]) | ✅ | n/a | ✅ planned |
| Async-iterable channels | ❌ | ❌ | n/a | ✅ planned |
| Raw `ipc::Request`/`Response` | ❌ ([#170][up170]) | ❌ | n/a | ✅ planned |
| Works *with* the others | — | — | — | ✅ that's the point |

`tauri-specta` and `TauRPC` are good at what they do, and this package is not trying to
displace them — the ✅/❌ above mark scope, not quality. The intended setup is
`tauri-specta` for the types and `tauri-invoke-binding` for the runtime around them.
Where a gap here is genuinely an upstream one (`emitTo` in particular), contributing the
fix upstream is preferred over keeping it here.

## Roadmap

Tracked in the [Epic issue][epic]. Broadly:

| Layer | Content |
| --- | --- |
| L0 | Project infrastructure |
| L1 | Binding abstraction — `tauri-specta` adapter + hand-written command map |
| L2 | Typed transport errors ← the headline feature |
| L3 | Middleware / interceptors |
| L4 | Events, incl. `emitTo` |
| L5 | Async-iterable channels |
| L6 | Raw IPC |
| L7 | Mocking and non-Tauri fallback |
| L8 | Opt-in runtime validation (Standard Schema) |
| L9 | React / Vue integration, examples |
| L10 | Upstream contributions |

## Installation

Not published yet. The intended package name is `tauri-invoke-binding` (availability on
npm still to be confirmed before the first release).

```sh
pnpm add tauri-invoke-binding   # once released
```

`@tauri-apps/api` v2 is a peer dependency.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). At this stage, design feedback on the issues is
worth more than code.

## License

[MIT](./LICENSE)

[tauri-specta]: https://github.com/specta-rs/tauri-specta
[taurpc]: https://github.com/MatsDK/TauRPC
[ts-rs]: https://github.com/Aleph-Alpha/ts-rs
[up169]: https://github.com/specta-rs/tauri-specta/issues/169
[up170]: https://github.com/specta-rs/tauri-specta/issues/170
[up172]: https://github.com/specta-rs/tauri-specta/issues/172
[up187]: https://github.com/specta-rs/tauri-specta/issues/187
[up197]: https://github.com/specta-rs/tauri-specta/issues/197
[epic]: https://github.com/UtakataKyosui/tauri-invoke-binding/issues/1
