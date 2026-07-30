# tauri-invoke-binding

> **Status: pre-alpha — not published to npm yet.**
> The core layer is implemented and tested: `createClient` (hand-written `CommandMap`),
> the `tauri-specta` adapter (`tauri-invoke-binding/specta`), `TransportError`, and the
> never-throws `.safe.*` call site (roadmap L1/L2 — [Epic][epic]). Namespacing (L1) is in
> too. Everything past that — middleware/cancellation, events, channels, raw IPC, mocking
> — is still a design sketch, not shipped code; each such example below says so. Feedback
> on the design, implemented or sketched, is exactly what is wanted right now.

**日本語版: [README.ja.md](./README.ja.md)**

A type-safe **runtime layer** for Tauri v2 IPC.

`tauri-invoke-binding` does **not** generate TypeScript types from Rust. That problem
is already solved well by [`specta`/`tauri-specta`][tauri-specta] and [`ts-rs`][ts-rs].
What is still missing is everything *around* those generated bindings — typed
transport errors, middleware, mocking, `emitTo`, async-iterable channels, raw IPC.
That is the layer this package builds.

---

## Origin

This project exists because, **as of 2026-07-31**, `tauri-specta` — the leading Rust→TypeScript
codegen tool for Tauri — has a documented set of runtime-layer gaps that are tracked as *open*
upstream issues but not yet implemented (see the table in [Why](#why) below for the full list
with issue links). This repository is a **preemptive implementation** of that missing layer: it
does not wait for those upstream issues to be fixed, and it does not ask `tauri-specta` to change
its own scope. It sits on top of `tauri-specta`'s generated output and fills the gaps from the
outside.

This is deliberately time-boxed language — upstream moves, and some of these gaps may close on
their own before this package reaches v1. Each claim below is tied to a specific upstream issue
number precisely so it can be checked, and re-checked, rather than taken on faith.

**Once this library is proven to work end-to-end, the intent is to propose upstreaming the
relevant pieces into `tauri-specta` itself** (see [Roadmap L10](#roadmap) and issue
[#31][epic-l10]) — starting with `emitTo` ([#187][up187]), which looks like the cleanest,
lowest-risk candidate to contribute directly. This package is meant to be a stopgap that closes
gaps quickly, evolves in the open, and hands working, battle-tested pieces back to the upstream
project rather than permanently forking the ecosystem. Where a gap turns out to require changes
only `tauri-specta` itself can make (e.g. baking transport-error types into codegen), that
decision is made explicitly in the open, not assumed.

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

### What is still missing, and what this repo does about it

These gaps live *outside* codegen, in the runtime and DX layer. Each row cites the upstream
evidence (mostly an open issue, checkable independently of this README) and the preemptive
implementation planned here to close it — see [Roadmap](#roadmap) for what the layer codes mean,
and the [Epic issue][epic] for the live checklist.

| Gap | Upstream evidence | Preemptive implementation here |
| --- | --- | --- |
| **Transport errors are absent from the types.** Generated code does `catch (e) { if (e instanceof Error) throw e; … }`, so argument-serialization failures, unregistered commands, denied permissions and panics **throw untyped**. Commands that don't return `Result` have no safe path at all. | [tauri-specta#169][up169] — *"The result was a transport error, which wasn't represented in the types at all"*, breaking exhaustive `ts-pattern` matching | **L2** — a `TransportError` discriminated union, a classifier that normalizes raw rejections into it, a `api.safe.*` call site that never throws, and exhaustiveness type tests (issues #9–#12) |
| **`emitTo` is unavailable.** The generated `makeEvent` exposes `listen` / `once` / `emit` only. | [tauri-specta#187][up187] | **L4** — typed `emitTo` plus the 6-way `EventTarget` union (issue #19) |
| **`ipc::Request` / `ipc::Response` unsupported** — headers, raw bodies, `ArrayBuffer` responses. | [tauri-specta#170][up170] (labelled *blocked on other work*) | **L6** — typed raw-body requests and `ArrayBuffer` responses (issues #24–#25) |
| **No unit-testing story.** Generated commands are const arrow functions bound directly to `__TAURI_INVOKE`, awkward to stub. No fallback for non-Tauri contexts (browser, SSR, Storybook, vitest). | [tauri-specta#197][up197] | **L7** — `createMockClient` with typed handlers, plus a non-Tauri fallback strategy (issues #26–#27) |
| **Commands live in one flat namespace.** | [tauri-specta#172][up172] | **L1** — TS-side module namespacing on top of the flat command map (issue #8) |
| **No middleware layer.** Retry, timeout, `AbortSignal` cancellation, logging and in-flight deduplication are hand-rolled per app — the generated code offers no seam to hook into. | structural | **L3** — a middleware pipeline plus `timeout` / `retry` / cancellation / `logger` / dedupe (issues #13–#18) |
| **Channels are callback-only.** `Channel<T>` drives `onmessage`; no `for await`, no completion or error convention. | `Channel<T>` API shape | **L5** — `AsyncIterable` channels and a tagged-enum narrowing helper (issues #22–#23) |
| **No runtime validation.** Generated types are compile-time only, so a forgotten regeneration silently drifts from reality. | by design | **L8** — opt-in Standard Schema validation (issue #28) |
| **No framework integration** (React hooks, Vue composables, TanStack Query). | out of scope upstream | **L9** — React hooks / Vue composables, backed by TanStack Query rather than a bespoke cache (issue #29) |

None of the right-hand column requires touching type generation. That is the space this package
occupies — see [Origin](#origin) for why that boundary is drawn where it is.

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

### Two entry points, one accessor-naming convention

Both entry points below are implemented and tested (`packages/core/src/client.ts`,
`packages/core/src/specta.ts`).

```ts
// ── A. Using tauri-specta: hand over the generated object. Zero type redeclaration.
import { commands } from './bindings' // tauri-specta output
import { createClient } from 'tauri-invoke-binding/specta'

const api = createClient(commands)
await api.helloWorld('Tauri')          // positional — mirrors commands.helloWorld's own signature exactly
await api.safe.hasError()              // never throws

// ── B. Not using specta: declare by hand.
import { createClient, type Command } from 'tauri-invoke-binding'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
}
const api = createClient<AppCommands>()
await api.helloWorld({ myName: 'Tauri' }) // a single named-args object, matching Tauri's wire format
await api.safe.hasError()
```

Both paths derive **camelCase** accessor names from whatever the source declares in
**snake_case** — `hello_world` / `commands.helloWorld` both become `api.helloWorld`, matching
`#[tauri::command]`'s own default renaming instead of leaving it invisible to TypeScript. That
part is genuinely identical between A and B.

The *argument-passing convention* is not, and that is deliberate rather than an oversight: path A
calls the already-generated function directly with whatever positional parameters it declares —
there is no way to safely recover parameter names from a function type in order to repackage them
into an object, so no re-shaping is attempted. Path B has no generated function to defer to, so it
uses a single named-args object, which is the closest match to what `invoke(cmd, args)` sends over
the wire in the first place. Either way, `.safe.*` works the same way once you're past argument
passing — see below.

### 1. A call that never throws

Both the Rust `Err(E)` **and** transport failures appear in the type:

```ts
import { assertExhaustive } from 'tauri-invoke-binding'

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
    case 'unknown':            break // classification failed; r.error.cause has the raw value
    default:                   assertExhaustive(r.error) // a case left out here is a compile error
  }
}
```

### 2. Cancellation and middleware (not implemented yet — [#16][i16])

```ts
await api.hasError({ signal: AbortSignal.timeout(1_000) })
```

The v0.1 call sites shipped so far (`createClient`, `.safe`, the `tauri-specta`
adapter) take exactly the arguments shown in section 1 — no trailing
`options` parameter. Adding one generically, without a runtime schema to
tell an options object apart from a real args object, needs the middleware
work tracked in issue #16; the calling convention above is what it's
expected to look like once that lands, not what exists today.

### 3. `emitTo` (not implemented yet — L4, upstream gap [#187][up187])

```ts
await api.events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, payload)
```

### 4. Channels as async iterables (not implemented yet — L5)

```ts
for await (const ev of api.channel<DownloadEvent>('download', { url })) {
  // ev: DownloadEvent
}
```

### 5. Testing (not implemented yet — L7, upstream gap [#197][up197])

```ts
import { createMockClient } from 'tauri-invoke-binding/testing'

const api = createMockClient<AppCommands>({
  helloWorld: ({ myName }) => `hi ${myName}`,
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
| L10 | Propose upstreaming proven pieces into `tauri-specta` ([#31][epic-l10]) |

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
[epic-l10]: https://github.com/UtakataKyosui/tauri-invoke-binding/issues/31
[i16]: https://github.com/UtakataKyosui/tauri-invoke-binding/issues/16
