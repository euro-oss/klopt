import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Any leftover `/moneybird/…` bookmark also lands on the wizard (#105).
 */
export const Route = createFileRoute('/_app/moneybird/$')({
  beforeLoad: () => {
    throw redirect({ to: '/importeren', search: { bron: 'moneybird' } })
  },
})
