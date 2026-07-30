/**
 * A fixture modeling the shape `tauri-specta` v2 actually generates into
 * `bindings.ts` — see
 * https://github.com/specta-rs/tauri-specta/blob/main/examples/app/src/bindings.ts
 * (the `commands` object, the `Result<T, E>` alias, and the `typedError`
 * wrapper). Used by both the runtime test (specta.test.ts) and the
 * type-level test (specta.test-d.ts) for issue #6's "実際の生成物サンプルを
 * fixture に置いた型レベルテスト" completion criterion, so both are checked
 * against the same shape rather than a simplified stand-in.
 */

type __Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }

async function __TAURI_INVOKE<T>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error('fixture stub — replaced per-test via vi.mock of the underlying invoke')
}

async function typedError<T, E>(promise: Promise<T>): Promise<__Result<T, E>> {
  try {
    return { status: 'ok', data: await promise }
  } catch (e) {
    if (e instanceof Error) throw e
    return { status: 'error', error: e as E }
  }
}

export const commands = {
  helloWorld: (myName: string) => __TAURI_INVOKE<string>('hello_world', { myName }),
  hasError: () => typedError<string, number>(__TAURI_INVOKE('has_error')),
  ping: () => __TAURI_INVOKE<null>('ping'),
}
