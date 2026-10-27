import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy `/moneybird` bookmarks redirect to the import wizard (#105).
 * The Moneybird UI lives at `/importeren?bron=moneybird`.
 */
export const Route = createFileRoute('/_app/moneybird/')({
  beforeLoad: () => {
    throw redirect({ to: '/importeren', search: { bron: 'moneybird' } })
  },
})
