/**
 * Formatting money for a Dutch bookkeeper.
 *
 * Re-exported rather than implemented: the same functions render the PDF that
 * the customer receives, and a figure that reads 1.210,00 on screen and
 * 1210.00 on the document is a support call. `@klopt/core/format` is a
 * browser-safe subpath — it imports nothing, which the package's main entry
 * cannot claim.
 */
export {
  type MoneyFormat,
  DEFAULT_MONEY_FORMAT,
  formatDate,
  formatMinorUnits,
  multiplyByDecimal,
  parseMinorUnits,
  percentOf,
} from '@klopt/core/format'
