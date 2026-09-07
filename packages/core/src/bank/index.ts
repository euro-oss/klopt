export {
  type BankEntry,
  type BankStatement,
  type BankStatementFormat,
  BankStatementError,
  parseBankAmount,
} from './model.js'

export { parseCamt053 } from './camt.js'
export { parseMt940 } from './mt940.js'

export {
  type BankFileFormat,
  type ImportContext,
  type ImportPlan,
  type PlannedEntry,
  type StatementPlan,
  type StatementProblem,
  dedupeKey,
  detectBankFormat,
  normaliseIban,
  parseBankFile,
  planImport,
} from './import.js'

export {
  type Allocation,
  type MatchCandidate,
  type MatchOptions,
  type MatchRule,
  type MatchStrategy,
  type MatchSuggestion,
  DEFAULT_MATCH_OPTIONS,
  allocateOldestFirst,
  mentionsNumber,
  nameSimilarity,
  normaliseIbanForMatch,
  normaliseName,
  ruleToLearn,
  suggestMatches,
} from './matching.js'

export { type BankMatchAllocation, type BankMatchRequest, buildBankMatchEntry } from './posting.js'

export {
  type CsvAmountStyle,
  type CsvMapping,
  type CsvStatementOptions,
  type MappingGuess,
  DEFAULT_CSV_MAPPING,
  guessCsvMapping,
  parseBankCsv,
  parseCsv,
  sniffDelimiter,
} from './csv.js'
