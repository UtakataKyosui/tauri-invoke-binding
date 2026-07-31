/**
 * Narrowing helpers for Rust `enum`s serialized by `serde`, matched to the
 * three representations `serde` actually produces (see
 * https://serde.rs/enum-representations.html and issue #23):
 *
 *  - **externally tagged** (serde's default, no `#[serde(tag = ...)]`):
 *    `{ Started: { url, contentLength } } | { Progress: { chunkLength } } | 'Finished'`
 *    — the variant name is an object *key*, so this is not a normal TS
 *    discriminated union and plain `switch` cannot narrow it.
 *  - **internally tagged** (`#[serde(tag = "event")]`):
 *    `{ event: 'Started', url, contentLength } | ...` — already a standard
 *    discriminated union; TS narrows this natively via `value.event`. The
 *    matcher below exists mainly for API symmetry with the other two
 *    representations and for its exhaustiveness check.
 *  - **adjacently tagged** (`#[serde(tag = "event", content = "data")]`):
 *    `{ event: 'Started', data: { url, contentLength } } | ...` — also a
 *    standard discriminated union (the tag is top-level), same rationale.
 *
 * Every matcher below takes a `handlers` object with exactly one entry per
 * variant name — a missing variant is a type error (the "網羅チェック" from
 * the issue), enforced by `handlers`'s mapped-object type rather than by a
 * `default`/`never` fallthrough.
 */

/** One handler per variant name, each receiving that variant's own payload. */
export type TaggedHandlers<Variants extends Record<string, unknown>, R> = {
  [K in keyof Variants]: (payload: Variants[K]) => R
}

/**
 * Builds the TS union `serde`'s **externally tagged** (default)
 * representation produces from a `Variants` record: a unit variant
 * (`Variants[K]` is `undefined`) serializes to the bare variant name; any
 * other variant serializes to a single-key object.
 */
export type ExternallyTagged<Variants extends Record<string, unknown>> = {
  [K in keyof Variants]: [Variants[K]] extends [undefined] ? K : { readonly [P in K]: Variants[K] }
}[keyof Variants]

/** Builds the TS union `serde`'s **internally tagged**
 * (`#[serde(tag = "...")]`) representation produces. */
export type InternallyTagged<Tag extends string, Variants extends Record<string, unknown>> = {
  [K in keyof Variants]: { readonly [P in Tag]: K } & Variants[K]
}[keyof Variants]

/** Builds the TS union `serde`'s **adjacently tagged**
 * (`#[serde(tag = "...", content = "...")]`) representation produces. */
export type AdjacentlyTagged<
  Tag extends string,
  Content extends string,
  Variants extends Record<string, unknown>,
> = {
  [K in keyof Variants]: { readonly [P in Tag]: K } & { readonly [P in Content]: Variants[K] }
}[keyof Variants]

/**
 * Narrows an externally tagged value (serde's default representation) by
 * dispatching to the handler matching its variant.
 *
 * ```ts
 * type DownloadEvent = ExternallyTagged<{
 *   Started: { url: string; contentLength: number }
 *   Progress: { chunkLength: number }
 *   Finished: undefined
 * }>
 *
 * for await (const ev of stream) {
 *   matchExternallyTagged(ev, {
 *     Started: ({ url }) => console.log('start', url),
 *     Progress: ({ chunkLength }) => console.log('chunk', chunkLength),
 *     Finished: () => console.log('done'),
 *   })
 * }
 * ```
 */
export function matchExternallyTagged<Variants extends Record<string, unknown>, R>(
  value: ExternallyTagged<Variants>,
  handlers: TaggedHandlers<Variants, R>,
): R {
  if (typeof value === 'string') {
    const handler = handlers[value as keyof Variants] as (payload: unknown) => R
    return handler(undefined)
  }
  const key = Object.keys(value as object)[0] as keyof Variants
  const handler = handlers[key] as (payload: unknown) => R
  return handler((value as Record<string, unknown>)[key as string])
}

/**
 * Narrows an internally tagged value (`#[serde(tag = "...")]`) by
 * dispatching to the handler matching `value[tag]`. `tag` is a runtime
 * parameter because the discriminant key name is whatever `#[serde(tag =
 * "...")]` was given — there is nothing to default to.
 */
export function matchInternallyTagged<
  Tag extends string,
  Variants extends Record<string, unknown>,
  R,
>(tag: Tag, value: InternallyTagged<Tag, Variants>, handlers: TaggedHandlers<Variants, R>): R {
  const key = (value as Record<string, unknown>)[tag] as keyof Variants
  const handler = handlers[key] as (payload: unknown) => R
  return handler(value)
}

/**
 * Narrows an adjacently tagged value (`#[serde(tag = "...", content =
 * "...")]`) by dispatching to the handler matching `value[tag]`, passing it
 * `value[content]`.
 */
export function matchAdjacentlyTagged<
  Tag extends string,
  Content extends string,
  Variants extends Record<string, unknown>,
  R,
>(
  tag: Tag,
  content: Content,
  value: AdjacentlyTagged<Tag, Content, Variants>,
  handlers: TaggedHandlers<Variants, R>,
): R {
  const key = (value as Record<string, unknown>)[tag] as keyof Variants
  const handler = handlers[key] as (payload: unknown) => R
  return handler((value as Record<string, unknown>)[content])
}
