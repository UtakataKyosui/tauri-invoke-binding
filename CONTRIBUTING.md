# Contributing / コントリビュートガイド

Thanks for looking. / ありがとうございます。

**English below each Japanese section.**

---

## スコープ / Scope

このプロジェクトで最も重要なルールです。まず [README の Non-goals](./README.ja.md#非目標non-goals)
を読んでください。

- Rust → TypeScript の**型生成はしません**。`specta` / `tauri-specta` / `ts-rs` の領分です。
- proc-macro も Rust クレートも提供しません。
- 生成された型を**消費する**ランタイム層だけを作ります。

型生成に関する提案は、上流（[tauri-specta](https://github.com/specta-rs/tauri-specta) など）に
出したほうが早く、みんなの利益になります。

> The single most important rule here. Read the [Non-goals](./README.md#non-goals) first.
> This project does not generate types from Rust, does not ship a proc-macro, and does not
> publish a Rust crate. It only builds the runtime layer that *consumes* generated types.
> Type-generation proposals belong upstream.

## 開発の準備 / Getting started

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (runtime + type-level)
pnpm lint        # biome check
pnpm build       # tsup
pnpm format      # biome check --write
```

Node.js 20 以降と pnpm が必要です。 / Node.js 20+ and pnpm are required.

## 型レベルテスト / Type-level tests

このパッケージの製品は型そのものです。**型に触れる変更には `*.test-d.ts` を必ず添えてください。**
`vitest` の typecheck が有効になっているので、`pnpm test` で通常のテストと一緒に走ります。

```ts
// packages/core/test/foo.test-d.ts
import { describe, expectTypeOf, it } from 'vitest'

describe('createClient (types)', () => {
  it('rejects an unknown command name', () => {
    // @ts-expect-error — 'nope' is not in the command map
    api.nope()
  })
})
```

> The types *are* the product. Any change that touches them needs a matching `*.test-d.ts`.
> `vitest`'s typecheck mode is enabled, so these run as part of `pnpm test`.

## コミットと PR / Commits and pull requests

- ブランチを切って PR を出してください。PR テンプレートの項目は埋めてください。
- `main` へ直接 push しないでください。
- 公開 API に影響する変更には `pnpm changeset` を実行してください（ドキュメントや CI だけの変更は不要です）。

> Branch, then open a PR and fill in the template. Don't push to `main` directly.
> Run `pnpm changeset` for anything that affects the public API.

## Issue / Issues

- バグ報告と機能要望にはテンプレートがあります。
- 上流（tauri-specta など）の穴を埋める提案なら、**対応する上流 issue 番号を書いてください。**
  それが本プロジェクトの存在意義の裏付けになります。
- 設計そのものへの異論も歓迎します。pre-alpha のいまが一番変えやすい時期です。

> Templates exist for bugs and features. If your proposal fills an upstream gap, cite the
> upstream issue number — that's what justifies the feature living here. Disagreement with
> the design is welcome; pre-alpha is the cheapest time to change it.

## ライセンス / License

コントリビュートは [MIT](./LICENSE) の下で受け入れられます。 /
Contributions are accepted under the [MIT](./LICENSE) license.
