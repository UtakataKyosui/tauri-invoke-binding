<!--
  Thanks for contributing! Please keep the sections below — reviewers rely on
  them. Delete any section that genuinely does not apply.
-->

## What

<!-- What does this PR change? One or two sentences. -->

## Why

<!-- Link the issue this closes: `Closes #123`. If there is no issue, explain
     the motivation here. -->

## How

<!-- Notable implementation decisions, trade-offs, or anything a reviewer would
     otherwise have to reverse-engineer from the diff. -->

## Scope check

<!-- This project deliberately does NOT generate TypeScript types from Rust —
     that is `specta` / `tauri-specta` / `ts-rs` territory. See the Non-goals
     section of the README. Tick the box to confirm this PR stays on our side of
     that line. -->

- [ ] This PR does not add Rust-to-TypeScript type generation, a proc-macro, or a Rust crate.

## Testing

<!-- How was this verified? For typed APIs, include the type-level tests
     (`*.test-d.ts`) that cover the new surface. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Changeset

- [ ] `pnpm changeset` was run (or this change is docs/CI-only and needs none).
