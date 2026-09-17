import { createFileRoute } from '@tanstack/react-router'
import { KLOPT_VERSION } from '@klopt/core'

/**
 * Liveness. Deliberately says nothing about the database: a self-hoster's load
 * balancer should not take the app out of rotation because Postgres blipped,
 * and readiness is a separate question with a separate endpoint.
 */
export const Route = createFileRoute('/api/v1/health')({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: 'ok',
          version: process.env['KLOPT_VERSION'] ?? KLOPT_VERSION,
        }),
    },
  },
})
