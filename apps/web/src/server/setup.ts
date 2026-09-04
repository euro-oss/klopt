import { createServerFn } from '@tanstack/react-start'
import { uuidv7 } from '@klopt/core'
import {
  handleCreateEntity,
  handleCreateFiscalYear,
  handleListCharts,
  handleListFiscalYears,
} from '~/api/handlers/setup'
import { createEntityBody, createFiscalYearBody } from '~/api/schemas'
import { contextFromRequest, run, setupContextFromRequest } from './internal'

/**
 * Setting up an administration, from the UI.
 *
 * Same handlers as `PUT /api/v1/entities/{id}` and friends, so the screen has
 * no privileged path — which is the whole of principle 3, applied to the one
 * flow that is most tempting to special-case.
 */

/**
 * What the setup form needs to render, plus the id it will submit under.
 *
 * The id is minted **here**, on the server, and not in the component. That is
 * what makes a double-submitted form produce one administration rather than
 * two — the write is a PUT to this id, so the second request finds the books
 * the first one made. Minting it in the browser would work too, and cost a
 * client-side import of `@klopt/core`, which drags a domain package built
 * around `node:crypto` and `node:fs` into a bundle that cannot run it.
 */
export const beginSetup = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => ({
    ...handleListCharts(await setupContextFromRequest()).body,
    entityId: uuidv7(),
  })),
)

export const createAdministration = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>
    return {
      // The client picks the id so a double submit produces one administration
      // rather than two. See the route file.
      entityId: typeof raw['entityId'] === 'string' ? raw['entityId'] : uuidv7(),
      body: createEntityBody.parse(raw),
    }
  })
  .handler(async ({ data }) =>
    run(async () => {
      const context = await setupContextFromRequest()
      const result = await handleCreateEntity(context, data.entityId, data.body)

      // Land the session on the books it just created rather than on whichever
      // administration sorts first.
      const { getRequest } = await import('@tanstack/react-start/server')
      const { resolveMemberships } = await import('~/api/auth')
      const { setActiveEntity } = await import('@klopt/db')
      const session = await resolveMemberships(context.database, getRequest())
      if (session !== null) {
        await setActiveEntity(context.database, session.sessionToken, data.entityId)
      }

      return result.body
    }),
  )

export const listFiscalYears = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListFiscalYears(await contextFromRequest())).body),
)

export const createFiscalYear = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createFiscalYearBody.parse(input))
  .handler(async ({ data }) =>
    run(async () => (await handleCreateFiscalYear(await contextFromRequest(), data)).body),
  )
