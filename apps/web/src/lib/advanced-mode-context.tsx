import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { writeAdvancedModeCookie } from '~/lib/advanced-mode'
import { setAdvancedMode as persistAdvancedMode } from '~/server/advanced-mode'

interface AdvancedModeContextValue {
  readonly advanced: boolean
  readonly setAdvanced: (enabled: boolean) => void
  readonly toggleAdvanced: () => void
}

const AdvancedModeContext = createContext<AdvancedModeContextValue | null>(null)

/**
 * Geavanceerd for the shell, the palette, and any screen that asks.
 *
 * The initial value comes from the layout loader (cookie + role default) so the
 * first paint matches the cookie. Toggles write the cookie on the server and
 * update local state immediately — no full invalidate needed for the nav.
 */
export function AdvancedModeProvider({
  initial,
  children,
}: {
  initial: boolean
  children: ReactNode
}) {
  const [advanced, setAdvancedState] = useState(initial)

  const setAdvanced = useCallback((enabled: boolean) => {
    setAdvancedState(enabled)
    // Optimistic local write so a screen that still reads document.cookie
    // (Moneybird) sees the same value before the server round-trip lands.
    writeAdvancedModeCookie(enabled)
    void persistAdvancedMode({ data: { enabled } }).catch((cause: unknown) => {
      console.error('[app] could not persist Geavanceerd', cause)
    })
  }, [])

  const toggleAdvanced = useCallback(() => {
    setAdvanced(!advanced)
  }, [advanced, setAdvanced])

  const value = useMemo(
    () => ({ advanced, setAdvanced, toggleAdvanced }),
    [advanced, setAdvanced, toggleAdvanced],
  )

  return <AdvancedModeContext.Provider value={value}>{children}</AdvancedModeContext.Provider>
}

export function useAdvancedMode(): AdvancedModeContextValue {
  const value = useContext(AdvancedModeContext)
  if (value === null) {
    throw new Error('useAdvancedMode needs AdvancedModeProvider')
  }
  return value
}

/** Soft read for surfaces that may render outside the shell (tests, setup). */
export function useOptionalAdvancedMode(): AdvancedModeContextValue | null {
  return useContext(AdvancedModeContext)
}
