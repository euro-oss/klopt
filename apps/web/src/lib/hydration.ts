import { useSyncExternalStore } from 'react'

/**
 * Whether React has taken over the server-rendered markup yet.
 *
 * Needed because a control whose only behaviour is a JavaScript handler does
 * nothing useful before hydration — and worse than nothing inside a form, where
 * the browser falls back to a native submit that reloads the page and throws
 * away what was typed. On a fast local connection the window is a few hundred
 * milliseconds; on a phone on mobile data it is not.
 *
 * So controls that cannot work without JavaScript render disabled and enable
 * themselves here. The user sees a control that is briefly unavailable rather
 * than one that is broken, which is also what a screen reader announces.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: the server
 * snapshot is `false`, the client snapshot is `true`, and React resolves the
 * difference during hydration instead of scheduling a second render pass.
 */
const subscribe = (): (() => void) => () => undefined

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
