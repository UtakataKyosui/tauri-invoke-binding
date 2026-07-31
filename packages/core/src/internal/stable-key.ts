/**
 * Serializes `value` into a string that is identical for two
 * deeply-equal-but-differently-ordered object graphs — used by the `dedupe`
 * middleware to key in-flight calls by command + args without caring about
 * the order properties were set in (issue #18's "キー順序に依存しないこと").
 * Object keys are sorted recursively; arrays keep their order (position is
 * meaningful there, unlike object key order).
 */
export function stableKey(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}
