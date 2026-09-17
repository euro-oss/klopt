import type { ApiClient } from './client.js'
import type { Provenance } from './provenance.js'

/**
 * What every tool needs: the API client, and the administration it is pointed
 * at, so that no result can be produced without saying whose books it is.
 */

interface EntityBody {
  readonly id: string
  readonly name: string
  readonly functionalCurrency: string
}

export class ToolContext {
  private entity: EntityBody | null = null

  constructor(readonly api: ApiClient) {}

  /**
   * The administration behind the token, read once.
   *
   * Cached because it is on every answer and it does not change during a
   * session; a token is scoped to one entity, so there is nothing to
   * invalidate. If somebody renames the company mid-conversation the agent
   * quotes the old name for a few minutes, which is a smaller problem than an
   * extra request on every tool call.
   */
  async describeEntity(): Promise<EntityBody> {
    this.entity ??= await this.api.get<EntityBody>('/entity')
    return this.entity
  }

  /** The envelope every tool answers in. */
  async provenance(sources: readonly string[], period?: Provenance['period']): Promise<Provenance> {
    const entity = await this.describeEntity()
    return {
      entity: { id: entity.id, name: entity.name },
      currency: entity.functionalCurrency,
      ...(period === undefined ? {} : { period }),
      amounts: {
        unit: 'decimal',
        note: `Amounts are decimal strings in ${entity.functionalCurrency}, e.g. "1474259.80" is one million four hundred and seventy-four thousand euro. Quote them as they are.`,
      },
      readAt: new Date().toISOString(),
      sources,
    }
  }
}
