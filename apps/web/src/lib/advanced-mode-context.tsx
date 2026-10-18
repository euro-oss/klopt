import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { defaultAdvancedMode, writeAdvancedModeCookie } from '~/lib/advanced-mode'
import { setAdvancedMode as persistAdvancedMode } from '~/server/advanced-mode'

interface AdvancedModeContextValue {
  readonly advanced: boolean
  readonly setAdvanced: (enabled: boolean) => void
  readonly toggleAdvanced: () => void
}

const AdvancedModeContext = createContext<AdvancedModeContextValue | null>(null)

/**
 * Geavanceerd for the shell, the palette, Moneybird, and any screen that asks.
 *
 * - No explicit choice yet → follow the role default for the *active*
 *   administration (Eigenaar off; Boekhouder / Accountant / Controleur on).
 * - After the user toggles → keep that explicit choice across administration
 *   switches (still per user, not per browser).
 * - When the signed-in user changes, re-read that user's cookie.
 */
export function AdvancedModeProvider({
  userId,
  role,
  initial,
  initialHasExplicit,
  children,
}: {
  userId: string
  role: string
  initial: boolean
  initialHasExplicit: boolean
  children: ReactNode
}) {
  // null = use role default; boolean = user has chosen.
  const [explicit, setExplicit] = useState<boolean | null>(() =>
    initialHasExplicit ? initial : null,
  )
  const [activeUserId, setActiveUserId] = useState(userId)

  // Another account signed in on this tab: drop the previous user's choice and
  // take the loader's value for the new user (cookie is already user-scoped).
  useEffect(() => {
    if (userId === activeUserId) return
    setActiveUserId(userId)
    setExplicit(initialHasExplicit ? initial : null)
  }, [userId, activeUserId, initial, initialHasExplicit])

  const advanced = explicit !== null ? explicit : defaultAdvancedMode(role)

  const setAdvanced = useCallback(
    (enabled: boolean) => {
      setExplicit(enabled)
      writeAdvancedModeCookie(userId, enabled)
      void persistAdvancedMode({ data: { enabled } }).catch((cause: unknown) => {
        console.error('[app] could not persist Geavanceerd', cause)
      })
    },
    [userId],
  )

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
