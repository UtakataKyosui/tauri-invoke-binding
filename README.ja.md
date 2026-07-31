# tauri-invoke-binding

> **ステータス: pre-alpha — npm には未公開です。**
> コア層は実装・テスト済みです：`createClient`（手書き `CommandMap`）、`tauri-specta` アダプタ
> （`tauri-invoke-binding/specta`）、`TransportError`、絶対に throw しない `.safe.*` 呼び出し口
> （ロードマップ L1/L2 — [Epic][epic]）。名前空間化（L1）も入っています。ミドルウェアパイプライン
> と `AbortSignal` によるキャンセル（L3）も実装済みです：`timeout` / `retry` / `logger` / `dedupe`、
> および全呼び出しでの `signal` 対応。それ以外 — イベント・チャネル・raw IPC・モック — はまだ
> 設計スケッチで、動くコードではありません。該当する例にはその旨を明記しています。実装済み・
> スケッチのどちらについても、設計へのフィードバックはいま一番ほしいものです。

**English: [README.md](./README.md)**

Tauri v2 の IPC に型安全性を与える**ランタイム層**です。

`tauri-invoke-binding` は **Rust から TypeScript の型を生成しません**。それは
[`specta` / `tauri-specta`][tauri-specta] や [`ts-rs`][ts-rs] がすでによく解いている問題です。
残っているのは、生成されたバインディングの**まわり**にあるもの — 型付きのトランスポート
エラー、ミドルウェア、モック、`emitTo`、AsyncIterable なチャネル、raw IPC。本パッケージが
作るのはその層です。

---

## 由来（Origin）

本プロジェクトが存在する理由は、**2026-07-31 時点**で、Tauri 向け Rust→TypeScript codegen の
筆頭である `tauri-specta` に、上流で open な Issue としてすでに報告されているものの**まだ実装
されていない**ランタイム層の不足点が複数あるためです（全リストと Issue へのリンクは下の
[なぜ作るのか](#なぜ作るのか) の表を参照）。本リポジトリは、その不足分に対する**先行実装**です。
上流 Issue の解決を待たず、また `tauri-specta` 自体のスコープを変えるよう求めるものでもありま
せん。`tauri-specta` の生成物の**上に乗り**、外側から穴を埋めます。

これは意図的に時点を切った言い方です。上流は動き続けており、本パッケージが v1 に達する前に
これらの穴のいくつかが自然に閉じている可能性もあります。以下の主張はすべて特定の上流 Issue
番号に紐付けており、鵜呑みにするのではなく、いつでも検証・再検証できるようにしています。

**本ライブラリが実際に十全に動作したことが確認できたら、該当する実装を `tauri-specta` 本体へ
アップストリームすることを提案する予定です**（[ロードマップ L10](#ロードマップ) および
Issue [#31][epic-l10] を参照）。最初の候補は `emitTo`（[#187][up187]）で、これは単独で切り出しやすく
リスクの低い貢献になりそうです。本パッケージは、エコシステムを恒久的にフォークするのではなく、
穴を素早く塞ぎながらオープンに育て、実戦で検証済みの部品を上流に還元するための橋渡し（stopgap）
と位置づけています。「codegen 自体に手を入れないと解決できない穴（例：トランスポートエラーの
型を生成コードに焼き込む）」に該当するかどうかは、推測で決めずそのつどオープンな場で判断します。

## なぜ作るのか

Tauri v2 のフロントエンド IPC は、実質的に型がありません。

```ts
// @tauri-apps/api/core
function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T>
type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array
```

`cmd` はただの `string`、`args` は開いたレコード、`T` は呼び出し側が手で言い張るだけの
ジェネリックです。コマンド名のタイポ・引数の過不足・戻り値の形の変化は、いずれもコンパイル時
ではなく実行時に失敗します。さらに、

- `#[tauri::command]` は引数名を既定で **camelCase** に変換して受け取ります
  （`user_name` → `userName`。`rename_all` で変わる）。この規約は TypeScript からは見えません。
- Rust の `Result<T, E>` は失敗が **reject** に潰れます。`catch` に来る値は `unknown` で、
  `E` の情報は失われます。
- イベント名・チャネルのペイロードと、その型との対応がコンパイル時に保証されません。

### ただし、型生成はすでに解決済み

`tauri-specta` は Rust を source of truth にして `bindings.ts` を生成します。

```ts
export const commands = {
  helloWorld: (myName: string) => __TAURI_INVOKE<string>('hello_world', { myName }),
  hasError:   () => typedError<string, number>(__TAURI_INVOKE('has_error')),
}
export const events = { myDemoEvent: makeEvent<DemoEvent, DemoEvent>('myDemoEvent') }
type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }
```

コマンド名・引数名・引数型・戻り値型・`Result<T, E>` の判別ユニオン化・イベントのペイロード型
は、これで全部解決しています。**ここを作り直すのは車輪の再発明であり、本プロジェクトはやりません。**

### それでも残っている穴と、本リポジトリがそれに対して行う先行実装

以下はいずれも codegen の**外側**、ランタイムと DX の領域の問題です。各行に、上流の根拠
（多くは独立に検証できる open issue）と、それを埋めるために本リポジトリが計画している先行実装
を並べています。レイヤー記号の意味は [ロードマップ](#ロードマップ) を、進捗のライブチェックリスト
は [Epic Issue][epic] を参照してください。

| 穴 | 上流の根拠 | 本リポジトリでの先行実装 |
| --- | --- | --- |
| **トランスポートエラーが型に現れない。** 生成コードは `catch (e) { if (e instanceof Error) throw e; … }` としているため、引数のシリアライズ失敗・未登録コマンド・権限拒否・パニックは**型なしで throw** されます。`Result` を返さないコマンドに至っては安全な経路が一切ありません。 | [tauri-specta#169][up169] — *"The result was a transport error, which wasn't represented in the types at all"*（`ts-pattern` の網羅マッチが破れる） | **L2** — `TransportError` 判別ユニオン、生の reject 値を正規化する分類ロジック、絶対に throw しない `api.safe.*`、網羅性の型レベルテスト（Issue #9〜#12） |
| **`emitTo` が使えない。** 生成される `makeEvent` は `listen` / `once` / `emit` のみ。 | [tauri-specta#187][up187] | **L4** — 型付き `emitTo` と 6 種の `EventTarget` 判別ユニオン（Issue #19） |
| **`ipc::Request` / `ipc::Response` 非対応** — headers・raw body・`ArrayBuffer` 戻り値。 | [tauri-specta#170][up170]（*blocked on other work* ラベル） | **L6** — 型付き raw body リクエストと `ArrayBuffer` レスポンス（Issue #24〜#25） |
| **ユニットテストの手段がない。** 生成物は `__TAURI_INVOKE` に直結した const アロー関数で差し替えにくく、非 Tauri 環境（ブラウザ・SSR・Storybook・vitest）のフォールバックもありません。 | [tauri-specta#197][up197] | **L7** — 型付きハンドラを登録できる `createMockClient` と非 Tauri 環境のフォールバック戦略（Issue #26〜#27） |
| **コマンドが単一のフラットな名前空間。** | [tauri-specta#172][up172] | **L1** — フラットなコマンドマップの上に TS 側だけで名前空間を切る仕組み（Issue #8） |
| **ミドルウェア層がない。** リトライ・タイムアウト・`AbortSignal` キャンセル・ロギング・インフライト重複排除は各アプリで手書きになります。生成コードの構造上、差し込み点が存在しません。 | 構造的な理由 | **L3** — ミドルウェアパイプラインと `timeout` / `retry` / キャンセル / `logger` / 重複排除（Issue #13〜#18） |
| **チャネルが callback のみ。** `Channel<T>` は `onmessage` ベースで、`for await` にできず、完了・エラーの通知規約もありません。 | `Channel<T>` の API 形状 | **L5** — `AsyncIterable` 化したチャネルと tagged enum のナローイングヘルパー（Issue #22〜#23） |
| **実行時検証がない。** 生成型はコンパイル時のみ。再生成を忘れると型と実データが静かに乖離します。 | 設計上の性質 | **L8** — Standard Schema によるオプトイン検証（Issue #28） |
| **フレームワーク統合がない**（React hooks・Vue composables・TanStack Query）。 | 上流のスコープ外 | **L9** — 独自キャッシュ層を作らず TanStack Query に委ねる React hooks / Vue composables（Issue #29） |

右列はどれも型生成に手を入れる必要がありません。本パッケージが占めるのはこの空間です — この線引き
の理由は [由来（Origin）](#由来origin) を参照してください。

## 立ち位置

```
Rust  #[tauri::command]
  │
  ├─ specta / tauri-specta / ts-rs   ← 型を生成する（既存 OSS。依存はしない）
  │
  └─ tauri-invoke-binding            ← 型を消費する（本パッケージ）
       ├─ 型付きトランスポートエラー
       ├─ ミドルウェア: retry / timeout / cancel / log / dedupe
       ├─ モック・非 Tauri フォールバック
       ├─ emitTo・AsyncIterable チャネル・raw IPC
       └─ React / Vue 統合
```

これは**置き換えではなく併用**です。`tauri-specta` を使っているならそのまま使い続けてください
— 生成されたオブジェクトを本パッケージに渡すだけで、型の再宣言はゼロです。使っていない場合は
手書きのコマンドマップで同じ呼び出し側 API が手に入り、あとから `tauri-specta` に移行しても
呼び出し側のコードは変わりません。

## 非目標（Non-goals）

機能と同じくらいプロジェクトを定義するものなので、先に明記します。

- **Rust → TypeScript の型生成をしない。** `specta` / `tauri-specta` / `ts-rs` に委ねます。
- **proc-macro を提供しない。** 導入にあたって Rust 側のコード変更を要求しません。
- **Rust クレートを公開しない。** TypeScript 専用パッケージです。
- **`@tauri-apps/api` を再実装しない。** peer dependency として薄く乗ります。

## 想定 API

> 設計スケッチです。名前も形も変わります。そのための [Issue](#ロードマップ) です。

### 入口は 2 つ、アクセサの命名規則は 1 つ

以下の 2 つの入口はどちらも実装・テスト済みです（`packages/core/src/client.ts` /
`packages/core/src/specta.ts`）。

```ts
// ── A. tauri-specta を使っている場合：生成物をそのまま渡す。型の再宣言はゼロ。
import { commands } from './bindings' // tauri-specta の生成物
import { createClient } from 'tauri-invoke-binding/specta'

const api = createClient(commands)
await api.helloWorld('Tauri')          // 位置引数。commands.helloWorld 自体のシグネチャそのまま
await api.safe.hasError()              // 絶対に throw しない

// ── B. specta を使っていない場合：手書きで宣言する。
import { createClient, type Command } from 'tauri-invoke-binding'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
}
const api = createClient<AppCommands>()
await api.helloWorld({ myName: 'Tauri' }) // 単一の名前付き引数オブジェクト。Tauri の wire 形式に一番近い
await api.safe.hasError()
```

どちらの入口も、宣言側の **snake_case** から **camelCase** のアクセサ名を導出する点は共通です
— `hello_world` も `commands.helloWorld` も `api.helloWorld` になり、`#[tauri::command]` 自身の
既定リネームを TypeScript から見えない状態のままにしません。ここは A と B で本当に同一です。

一方、**引数の渡し方**は同一ではありません。これは見落としではなく意図的な設計です。A は
既に生成された関数をそのまま呼ぶので、それが宣言している位置引数をそのまま使います —
関数の型からパラメータ名を安全に復元して1つのオブジェクトに詰め直す手段が TypeScript には
ないため、そうした変換は行いません。B には委譲先の生成関数がないので、単一の名前付き引数
オブジェクトを使います — これは `invoke(cmd, args)` が実際に wire に送る形式に最も近い形です。
引数の渡し方さえ済めば、そこから先の `.safe.*` の挙動はどちらも同じです（下記参照）。

### 1. 絶対に throw しない呼び出し

Rust の `Err(E)` も、トランスポートの失敗も、どちらも型に出ます。

```ts
import { assertExhaustive } from 'tauri-invoke-binding'

const r = await api.safe.hasError()

if (r.status === 'ok') {
  r.data satisfies string
} else {
  switch (r.error.kind) {
    case 'command':            r.error.value satisfies number; break // Rust の Err(E)
    case 'deserialization':    break // ← 現状は型なしで throw されている（上流 #169）
    case 'command-not-found':  break
    case 'permission-denied':  break
    case 'panic':              break
    case 'aborted':            break
    case 'not-in-tauri':       break
    case 'unknown':            break // 分類に失敗した場合。r.error.cause に元の値が残る
    default:                   assertExhaustive(r.error) // ケースの handling 漏れはコンパイルエラーになる
  }
}
```

### 2. キャンセルとミドルウェア（実装済み — [L3][i13]）

生成されるすべての呼び出し口（`createClient`・`.safe`・`tauri-specta` アダプタ）は、
末尾に `CallOptions` を受け取れます：`signal`、およびクライアントに設定した
ミドルウェアが読む値（`timeoutMs`・`retry`・`dedupe`）です。

```ts
import { createClient, timeout, retry, logger } from 'tauri-invoke-binding'

const api = createClient<AppCommands>({
  middleware: [timeout(5_000), retry({ times: 3 }), logger()],
})

await api.hasError(undefined, { signal: AbortSignal.timeout(1_000) })
await api.helloWorld({ myName: 'Tauri' }, { signal: controller.signal })
```

**引数なしコマンドで `undefined` が要る理由。** 手書き DSL（`createClient`）には実行時
スキーマがなく、呼び出し側の唯一の引数が「本物のコマンド引数」なのか `CallOptions`
なのかを、オブジェクトの形から推測することはできません。推測に頼る代わりに、`args`
は常に専用の引数位置を持ち（`void` 引数のコマンドでは `undefined`）、`options` は常に
その次の位置に置く設計にしました：`api.ping()` と `api.ping(undefined, { signal })`
はどちらも型チェックを通り、`api.ping({ signal })` は型エラーになります。`tauri-specta`
アダプタにはこの曖昧さがありません — 生成された関数の実際のアリティ（`fn.length`）から、
どこまでが位置引数でどこからが `CallOptions` かを一意に判定できるため、
`api.helloWorld('Tauri', { signal })` はそのまま動きます。

**ミドルウェア**（`Middleware = (next: Invoker) => Invoker`）は、渡した順に呼び出しを
包みます：`middleware[0]` の「before」ロジック（`next` を呼ぶ前の処理）が最初に実行され、
「after」／エラー処理ロジック（`next` の解決後・例外後の処理）は最後に実行されます —
典型的な onion モデルです。ミドルウェアを追加しても、各コマンド自身の引数・戻り値の型
推論は変わりません。

- **`timeout(ms)`** — `ms` 以内に解決しなければそのコマンド呼び出しを失敗させ、`.safe`
  経路では `{ kind: 'timeout', command, ms }` として観測できます。**Tauri の IPC 自体は
  キャンセルできません**：Rust 側のハンドラは中断されずそのまま走り続けます。これは
  あくまで TS 側が待つのをやめるだけであり、遅れて届いた結果は処理されず捨てられます。
  `{ timeoutMs }` でコマンド単位・呼び出し単位に上書きできます。
- **`retry({ times, backoff?, shouldRetry? })`** — 既定は指数バックオフ + ジッターです。
  既定でリトライするのは `TransportError` の `unknown` 種別のみです。`command-not-found`・
  `deserialization`・`permission-denied`・`aborted`・`timeout`・`not-in-tauri`、および
  Rust コマンド自身が宣言した `Err(E)`（`kind: 'command'`）はリトライしません — これらは
  リトライしても成功し得ない（存在しないコマンドは再試行しても現れない）か、副作用のある
  コマンドを二重に実行してしまう危険があるためです。`{ retry: { shouldRetry, times, backoff } }`
  で呼び出し単位に上書き、`{ retry: false }` で無効化できます。
- **`logger(options?)`** — コマンド名・（マスク済みの）引数・所要時間・結果を出力します。
  `process.env.NODE_ENV === 'production'` のときは既定で無効です（引数に個人情報や
  認証情報が含まれ得るため）。`{ mask: ['password'] }` やカスタム関数で機微なキーを
  マスクできます。出力先・所要時間フックともに差し替え可能です。
- **`dedupe(options?)`** — 同一コマンド・同一引数（キー順序に依存しない）の同時呼び出しを
  1 本の in-flight `invoke` にまとめます。**呼び出し単位・コマンド単位のオプトイン**
  （`{ dedupe: true }`）— 副作用のあるコマンドをまとめるのは危険なので既定は無効です。
  これはキャッシュではなく in-flight の合流にすぎません：呼び出しが完了すればすぐに
  マップから外れるので、次の呼び出しは常に新しい `invoke` を発火します。

**`AbortSignal` によるキャンセル**はミドルウェアではなくコア機能です — どのミドルウェアを
設定していても、すべての呼び出しが `signal` を受け付けます。すでに abort 済みの signal は
`invoke` を呼ぶ前に即座に中断し、実行中に abort された場合は結果を処理せず破棄します
（`.safe` 経路は `{ kind: 'aborted' }` で解決、通常経路は `AbortError` を throw）。`retry`
のバックオフ待機中の abort も即座に中断します。**Tauri の IPC 自体はキャンセルできません**
— `timeout` と同じ制約で、Rust 側のハンドラは中断されずそのまま走り続けます。

### 3. `emitTo`（未実装 — L4、上流の穴 [#187][up187]）

```ts
await api.events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, payload)
```

### 4. チャネルを AsyncIterable として消費（未実装 — L5）

```ts
for await (const ev of api.channel<DownloadEvent>('download', { url })) {
  // ev: DownloadEvent
}
```

### 5. テスト（未実装 — L7、上流の穴 [#197][up197]）

```ts
import { createMockClient } from 'tauri-invoke-binding/testing'

const api = createMockClient<AppCommands>({
  helloWorld: ({ myName }) => `hi ${myName}`,
})
```

## 既存 OSS との比較

| | [tauri-specta][tauri-specta] | [TauRPC][taurpc] | [ts-rs][ts-rs] | **tauri-invoke-binding** |
| --- | --- | --- | --- | --- |
| Rust から TS 型を生成 | ✅ | ✅ | ✅（型のみ） | ❌ **意図的に** |
| Rust 側の変更が必要 | proc-macro | trait マクロ | derive | **不要** |
| 型付きトランスポートエラー | ❌（[#169][up169]） | ❌ | — | ✅ 予定 |
| ミドルウェア（retry/timeout/cancel） | ❌ | ❌ | — | ✅ 実装済み |
| モック・非 Tauri フォールバック | ❌（[#197][up197]） | ❌ | — | ✅ 予定 |
| `emitTo` | ❌（[#187][up187]） | ✅ | — | ✅ 予定 |
| AsyncIterable なチャネル | ❌ | ❌ | — | ✅ 予定 |
| raw `ipc::Request`/`Response` | ❌（[#170][up170]） | ❌ | — | ✅ 予定 |
| 他と**併用**できる | — | — | — | ✅ それが狙い |

`tauri-specta` と `TauRPC` はそれぞれの領域で優れており、本パッケージはそれらを置き換えよう
とはしていません。上の ✅/❌ は品質ではなく**スコープ**を表しています。想定している構成は
「型は `tauri-specta`、そのまわりのランタイムは `tauri-invoke-binding`」です。ここで挙げた穴
のうち本質的に上流の課題であるもの（特に `emitTo`）は、ここに抱え込むより上流へ還元すること
を優先します。

## ロードマップ

[Epic Issue][epic] で追跡します。おおまかには以下のとおりです。

| レイヤー | 内容 |
| --- | --- |
| L0 | プロジェクト基盤 |
| L1 | バインディング抽象 — `tauri-specta` アダプタ + 手書きコマンドマップ |
| L2 | 型付きトランスポートエラー ← 目玉機能 |
| L3 | ミドルウェア / インターセプタ |
| L4 | イベント（`emitTo` を含む） |
| L5 | AsyncIterable なチャネル |
| L6 | raw IPC |
| L7 | モックと非 Tauri フォールバック |
| L8 | 実行時検証（Standard Schema・オプトイン） |
| L9 | React / Vue 統合、examples |
| L10 | 実戦検証済みの部分を `tauri-specta` へアップストリーム提案する（[#31][epic-l10]） |

## インストール

未公開です。想定しているパッケージ名は `tauri-invoke-binding` です（npm での空き状況は
初回リリース前に確認します）。

```sh
pnpm add tauri-invoke-binding   # リリース後
```

`@tauri-apps/api` v2 は peer dependency です。

## コントリビュート

[CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。現段階では、コードよりも Issue への
設計フィードバックのほうが価値があります。

## ライセンス

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
[i13]: https://github.com/UtakataKyosui/tauri-invoke-binding/issues/13
[i16]: https://github.com/UtakataKyosui/tauri-invoke-binding/issues/16
