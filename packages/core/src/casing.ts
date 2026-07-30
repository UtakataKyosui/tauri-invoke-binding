/**
 * `#[tauri::command]` renames arguments/commands to camelCase by default; the
 * hand-written `CommandMap` (see command.ts) declares keys in snake_case to
 * match the literal Rust command name Tauri puts on the wire, and call sites
 * use the camelCase accessor `createClient` derives from it — see the "Two
 * entry points" section of the README for the reasoning. This is that
 * derivation, made explicit and typed instead of happening invisibly inside
 * `#[tauri::command]`.
 */
export type SnakeToCamel<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
  : S

export function snakeToCamel(input: string): string {
  return input.replace(/_([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase())
}

/**
 * The inverse of `snakeToCamel`, used by the hand-written client (client.ts)
 * to recover the wire command name from the camelCase property a caller
 * accessed, since there is no runtime `CommandMap` to look it up in — see
 * the Proxy-based implementation in client.ts. Simple ASCII-case inversion;
 * it does not attempt to specially handle runs of consecutive capitals
 * (acronyms), which is a lossy case in either direction and out of scope
 * here.
 */
export function camelToSnake(input: string): string {
  return input.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
}
