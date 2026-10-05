/**
 * Reading a Moneybird administration (issue #32).
 *
 * Modelled on `ports/exact.ts`: a narrow client so planning stays a pure
 * function of a snapshot, and a test replaces the client with a recorded
 * fixture rather than inventing a second architecture.
 *
 * ## The token is a personal API token, not OAuth
 *
 * Moneybird REST API v2 accepts `Authorization: Bearer <token>`. One token
 * reaches every administration the user belongs to, so `administrations()` is
 * a required step between connecting and importing — the same reason Exact
 * makes choosing a division its own act.
 *
 * OAuth is out of scope for this importer (a later issue). The adapter stores
 * the token encrypted like every other secret.
 *
 * ## Amounts arrive as decimal strings
 *
 * Unlike Exact's `Edm.Double`, Moneybird sends `"121.0"`. Conversion to minor
 * units still happens once at the edge, and a value that is not whole cents
 * is refused rather than rounded.
 *
 * ## History is in the API
 *
 * Exact's importer brings master data and open items; ledger history is XAF.
 * Moneybird has no equivalent audit file that is sufficient for the books, so
 * this client also reads booked documents (see ADR 0060).
 */

/** One administration, from `GET /administrations.json`. */
export interface MoneybirdAdministration {
  readonly id: string
  readonly name: string
  readonly language: string | null
  readonly currency: string | null
  readonly country: string | null
  readonly timeZone: string | null
  /**
   * Month the Moneybird year starts (1–12), from `period_start_date`.
   *
   * `null` when the administration row has no readable start — the planner
   * warns rather than assuming January. A known month that does not match
   * this entity is refused as `fiscal_year_start_mismatch`.
   */
  readonly fiscalYearStartMonth: number | null
}

/** A page of rows. Moneybird paginates with `page` / `per_page`, not a next URL. */
export interface MoneybirdPage<T> {
  readonly rows: readonly T[]
  readonly page: number
  readonly perPage: number
  /** True when this page was full, so another may exist. */
  readonly maybeMore: boolean
}

/** What one request cost, for the log and for the screen. */
export interface MoneybirdRequestLog {
  readonly method: string
  readonly path: string
  readonly status: number
  readonly durationMs: number
  readonly rows: number
}

/**
 * The client an import reads through.
 *
 * Deliberately narrow: list administrations, page a resource, download an
 * attachment. Shapes live in `@klopt/core/moneybird`; transport lives in the
 * adapter. This interface is the seam a test replaces with a fixture.
 */
export interface MoneybirdClient {
  /** Every administration this token can reach. */
  administrations(): Promise<readonly MoneybirdAdministration[]>
  /**
   * One page of an administration-scoped resource.
   *
   * `path` is the part after the administration id — `contacts.json`, not the
   * whole URL. Filter query parameters are caller-owned.
   */
  page(request: {
    readonly administrationId: string
    readonly path: string
    readonly page?: number
    readonly perPage?: number
    readonly query?: Readonly<Record<string, string>>
  }): Promise<MoneybirdPage<Record<string, unknown>>>
  /** An attachment's bytes, from a Moneybird `download_url`. */
  download(url: string): Promise<Uint8Array>
  /** Everything asked so far, newest last. Spec 8: adapters record their calls. */
  readonly log: readonly MoneybirdRequestLog[]
}
