import { createServerFn } from '@tanstack/react-start'

/**
 * Session state for the shell.
 *
 * Exports nothing but server functions — see the note in ./internal.ts for why
 * that rule exists and what breaks when it is ignored.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const { resolveMemberships } = await import('~/api/auth')
  const { getDatabase } = await import('~/api/database')
  return resolveMemberships(getDatabase(), getRequest())
})
