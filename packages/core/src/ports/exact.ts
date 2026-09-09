/**
 * Reading an Exact Online administration (spec 13).
 *
 * "Exact Online importer: via their REST API, for contacts, open items, chart
 * of accounts and documents." Which is a one-line requirement carrying three
 * awkward facts about the API on the other side.
 *
 * ## Every URL is division-scoped, and the division is the whole question
 *
 * Exact's paths are `/api/v1/{division}/…`. One login reaches every
 * administration the user has rights to — a holding, its BVs, and the practice
 * and test divisions the accountant made along the way. There is no such thing
 * as importing "the Exact account": you import exactly one division, and
 * picking the wrong one silently imports test data into real books.
 *
 * So `divisions()` is not a convenience. It is a required step between
 * connecting and importing, and the division is a stored property of the
 * connection rather than a parameter somebody passes each time.
 *
 * ## The token lasts ten minutes and the refresh token is single-use
 *
 * Exact rotates the refresh token on every refresh and invalidates the old one.
 * A client that refreshes twice concurrently loses the connection, and a client
 * that forgets to persist the new one loses it at the next call. Hence
 * `onTokens`: the adapter hands back every new pair as it gets it, so the
 * caller can write it down before it is used.
 *
 * ## Money arrives as a double
 *
 * `Edm.Double` for every amount. Nothing can be done about that at the wire —
 * it is JSON — so it is converted to minor units once, at the edge, by
 * `minorFromExactAmount`, which refuses a value that is not a two-decimal
 * amount rather than rounding it quietly.
 */

/** What an OAuth app is, before anybody has logged in. */
export interface ExactApp {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
}

/**
 * A token pair with the moment the access half stops working.
 *
 * `expiresAt` is absolute rather than a duration, because a duration is only
 * meaningful at the instant it was issued and this gets stored.
 */
export interface ExactTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: string
}

/** `/api/v1/current/Me`, trimmed to what an import cares about. */
export interface ExactUser {
  readonly userId: string
  readonly fullName: string
  /** The division Exact will use when the path says `current`. */
  readonly currentDivision: number
  readonly serverTime: string | null
}

/**
 * One administration, from `system/Divisions`.
 *
 * `code` is the number that goes in the URL. `status` is Exact's own: 0
 * inactive, 1 active, 2 archived. The three booleans are why this type is
 * bigger than "an id and a name" — they are how somebody tells their test
 * division from the one their accountant files from.
 */
export interface ExactDivision {
  readonly code: number
  readonly description: string
  readonly currency: string | null
  readonly country: string | null
  readonly vatNumber: string | null
  readonly chamberOfCommerceNumber: string | null
  readonly status: number | null
  readonly isMainDivision: boolean
  readonly isPracticeDivision: boolean
  readonly isDossierDivision: boolean
  readonly archiveDate: string | null
  /** True for the division the API is currently pointed at. */
  readonly current: boolean
}

/** A page of rows, and where the next one is. */
export interface ExactPage<T> {
  readonly rows: readonly T[]
  /** Exact's `__next`, absolute and opaque. Null on the last page. */
  readonly next: string | null
}

/** What one request cost, for the log and for the screen. */
export interface ExactRequestLog {
  readonly method: string
  readonly path: string
  readonly status: number
  readonly durationMs: number
  readonly rows: number
}

/**
 * The client an import reads through.
 *
 * Deliberately narrow: four reads and a download. Everything Exact-specific
 * about *shapes* lives in `@klopt/core/exact`; everything Exact-specific about
 * *transport* lives in the adapter. This interface is the seam, and it is what
 * a test replaces with a fixture.
 */
export interface ExactClient {
  me(): Promise<ExactUser>
  /** Every administration this login can reach. */
  divisions(): Promise<readonly ExactDivision[]>
  /**
   * One page of a division-scoped resource.
   *
   * `path` is the part after the division — `crm/Accounts`, not the whole URL.
   * `select` is not optional in practice: Exact returns every column otherwise,
   * which on `crm/Accounts` is over two hundred of them.
   */
  page(request: {
    readonly division: number
    readonly path: string
    readonly select: readonly string[]
    readonly filter?: string
    readonly orderBy?: string
    readonly top?: number
  }): Promise<ExactPage<Record<string, unknown>>>
  /** Follow a `__next`, which is already a complete URL. */
  nextPage(url: string): Promise<ExactPage<Record<string, unknown>>>
  /**
   * Whether this login may call one endpoint, according to Exact.
   *
   * `users/UserHasRights` — "check whether the current user has rights for an
   * action on a specific endpoint". It exists because a 403 from Exact has at
   * least four possible causes and their error body distinguishes none of
   * them: the user's rights, the subscription's modules, the division, and the
   * app's own data scoping.
   *
   * Asking turns "you need some permission, work out which" into "your user
   * does or does not have this one", which is the difference between a support
   * ticket and a setting.
   *
   * `null` when the probe itself could not be answered — it is scoped
   * `Organization administration`, so a login refused the resource may be
   * refused the question about it too. An unanswered probe must not read as a
   * "no".
   */
  mayRead(division: number, path: string): Promise<boolean | null>

  /** An attachment's bytes, from a `DocumentAttachments.Url`. */
  download(url: string): Promise<Uint8Array>
  /** Everything asked so far, newest last. Spec 8: adapters record their calls. */
  readonly log: readonly ExactRequestLog[]
}
