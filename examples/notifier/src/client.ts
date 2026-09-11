/**
 * The smallest possible Klopt client: a bearer token and `fetch`.
 *
 * There is no SDK, deliberately. An integrator should be able to talk to this
 * API with whatever their language calls an HTTP library, and an example that
 * leans on a client library proves the library works rather than that the API
 * does.
 */

export interface ClientOptions {
  readonly baseUrl: string
  readonly token: string
  /** Injected in tests, so this example never opens a socket in CI. */
  readonly fetch?: typeof globalThis.fetch
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    async get(path: string): Promise<unknown> {
      const response = await doFetch(`${options.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      })

      // A refusal is not an exception. A token that has been narrowed since
      // this module was connected should make it go quiet, not crash-loop.
      if (!response.ok) return null
      return response.json()
    },
  }
}
