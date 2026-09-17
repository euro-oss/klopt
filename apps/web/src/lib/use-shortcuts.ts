import { useEffect, useRef, useState } from 'react'
import { isTypingInto, type Binding } from './keyboard'
import { resolveKeystroke } from './shortcut-resolution'

/**
 * The global keyboard, wired to the registry (docs/keyboard-map.md).
 *
 * The registry has existed since M0 and the sidebar has been printing its keys
 * next to every navigation item ever since. Nothing listened for them. A
 * shortcut shown and not implemented is worse than no shortcut: it is a promise
 * the application breaks the first time somebody believes it.
 *
 * What each key *means* is decided in `shortcut-resolution.ts`, where it can be
 * tested by naming a key rather than by simulating a browser. This is the
 * listener and the prefix timer, and nothing else.
 */

/** The prefix window from docs/keyboard-map.md. */
const PREFIX_TIMEOUT_MS = 1_500

export type ShortcutHandler = (binding: Binding) => void

/**
 * @param onTrigger must be stable — `useCallback` it. The listener is
 * registered when it changes, and a handler rebuilt every render would mean a
 * global listener torn down and re-added on every keystroke.
 */
export function useShortcuts(
  onTrigger: ShortcutHandler,
  enabled = true,
): { readonly prefix: string | null } {
  const [prefix, setPrefix] = useState<string | null>(null)

  const armed = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const clear = (): void => {
      armed.current = null
      setPrefix(null)
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }

    /**
     * Take a key completely.
     *
     * `preventDefault` alone is not enough: a screen with its own window
     * listener — the koppelscherm, where `1`–`9` book a suggestion — would
     * still see it, so pressing `g` and then a digit by accident would arm a
     * prefix *and* book a match. `stopImmediatePropagation` is what makes a
     * consumed key consumed.
     */
    const take = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return

      const resolution = resolveKeystroke(
        {
          key: event.key.toLowerCase(),
          hasModifier: event.metaKey || event.ctrlKey || event.altKey,
          shiftKey: event.shiftKey,
          typing: isTypingInto(event.target),
        },
        armed.current,
      )

      switch (resolution.action) {
        case 'ignore':
          return

        case 'clear':
          clear()
          return

        case 'arm':
          take(event)
          armed.current = resolution.prefix
          setPrefix(resolution.prefix)
          timer.current = setTimeout(clear, PREFIX_TIMEOUT_MS)
          return

        case 'swallow':
          take(event)
          clear()
          return

        case 'trigger':
          take(event)
          clear()
          onTrigger(resolution.binding)
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [enabled, onTrigger])

  return { prefix }
}
