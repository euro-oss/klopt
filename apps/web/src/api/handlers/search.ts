import { SEARCH_RESOURCE_TYPES } from '@klopt/core'
import { withSearch, type SearchHit } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { SearchQuery } from '../schemas.js'

/**
 * One search across five resources (spec 10.3).
 *
 * The rule the shape follows is "provenance is mandatory": every hit carries
 * its id and the path that reads the whole thing, so an agent cites rather than
 * paraphrases. Nothing here is a summary an agent could quote as a fact — it is
 * a list of places to look, and the amounts on it exist so that the right one
 * is recognisable, not so that they can be added up.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function serialiseHit(hit: SearchHit) {
  return {
    type: hit.type,
    id: hit.id,
    title: hit.title,
    subtitle: hit.subtitle,
    date: hit.date,
    amountMinorUnits: hit.amountMinorUnits === null ? null : hit.amountMinorUnits.toString(),
    currency: hit.currency,
    /**
     * Relative to /api/v1, because the caller already knows where that is and
     * an absolute URL would bake in whichever host this instance answered on.
     */
    path: hit.path,
    rank: hit.rank,
  }
}

export async function handleSearch(context: RequestContext, query: SearchQuery) {
  requirePermission(context, 'ledger:read')

  // Empty means all five. Spelling them out on the response rather than
  // echoing the empty list, so a caller can see what was actually searched.
  const types = query.types.length === 0 ? SEARCH_RESOURCE_TYPES : query.types

  return withSearch(context.database, async (repository) => {
    const result = await repository.search({
      entityId: context.entityId,
      term: query.q,
      types,
      limit: query.limit,
    })

    return {
      status: 200,
      body: {
        query: query.q,
        entityId: context.entityId,
        types,
        limitPerType: query.limit,
        results: result.hits.map(serialiseHit),
        counts: Object.fromEntries(
          types.map((type) => [type, result.hits.filter((hit) => hit.type === type).length]),
        ),
        /**
         * Which types hit the limit. Reported rather than left to be inferred
         * from a count equalling the limit, because that inference is wrong
         * exactly as often as there are precisely `limit` matches.
         */
        truncated: result.truncated,
      },
    }
  })
}
