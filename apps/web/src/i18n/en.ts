import type { MessageKey } from './nl.js'

/**
 * English.
 *
 * Typed as a complete record of the Dutch keys, so a key added to `nl.ts` and
 * forgotten here fails the build rather than falling back to Dutch on an
 * English screen. That is the whole reason this is a typed object rather than
 * a JSON file: a missing translation should be a compile error, not something
 * a user discovers.
 *
 * The accounting terms are the ones an English-speaking accountant would use,
 * except where the Dutch word *is* the term — `BTW` stays `VAT`, but a
 * *journaalpost* is a journal entry and a *proefbalans* is a trial balance.
 */
export const en: Record<MessageKey, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.entries': 'Journal entries',
  'nav.accounts': 'Chart of accounts',
  'nav.invoices': 'Sales invoices',
  'nav.inbox': 'Inbox',
  'nav.purchases': 'Purchase invoices',
  'nav.contacts': 'Contacts',
  'nav.bank': 'Bank',
  'nav.payments': 'Payments',
  'nav.dunning': 'Reminders',
  'nav.vat': 'VAT',
  'nav.trialBalance': 'Trial balance',
  'nav.balanceSheet': 'Balance sheet',
  'nav.profitAndLoss': 'Profit & loss',
  'nav.settings': 'Settings',
  'nav.members': 'Access',
  'nav.auditLog': 'Who did what',
  'nav.exact': 'Exact Online',
  'nav.retention': 'Retention',
  'nav.snapshots': 'Sealed snapshots',

  'shell.tagline': 'Open bookkeeping',
  'shell.administration': 'Administration',
  'shell.role': 'role: {role}',
  'shell.signOut': 'Sign out',
  'shell.help': 'Keyboard shortcuts',
  'shell.skipToContent': 'Skip to content',
  'shell.navigation': 'Main navigation',
  'shell.newEntry': 'New journal entry',

  'language.label': 'Taal / Language',
  'language.nl': 'Nederlands',
  'language.en': 'English',
  'language.saved': 'Language changed.',

  'signIn.introEmail': 'Enter your email address. We will send you a code.',
  'signIn.introCode': 'Enter the code we sent you.',
  'signIn.email': 'Email',
  'signIn.sendCode': 'Send me a code',
  'signIn.sendFailed': 'The code could not be sent.',
  'signIn.codeSent': 'We sent a {digits}-digit code to {email}.',
  'signIn.codeWrong': 'That code is wrong, or has expired. Request a new one if you need to.',
  'signIn.change': 'change',
  'signIn.code': 'Code',
  'signIn.verify': 'Sign in',
  'signIn.resend': 'Send a new code',
  'signIn.footer': 'No password needed. A code is valid for ten minutes and works once.',

  'setup.needOne': 'No administration yet',
  'setup.needOneBody':
    'You are signed in as {email}. Set up an administration, or ask an owner to invite you to one that exists.',
  'setup.start': 'Set up an administration',
  'setup.title': 'New administration',
  'setup.intro': 'You are signed in as {email}. Fill in a name — the rest you can change later.',
  'setup.chartsFailed': 'The charts of accounts could not be loaded: {detail}',
  'setup.name': 'Name of the administration',
  'setup.namePlaceholder': 'My Company',
  'setup.legalName': 'Legal name',
  'setup.legalNamePlaceholder': 'My Company Ltd.',
  'setup.optional': '(optional)',
  'setup.kvk': 'Chamber of Commerce number',
  'setup.vat': 'VAT number',
  'setup.chart': 'Chart of accounts',
  'setup.chartSummary':
    '{accounts} ledger accounts, {journals} journals and {taxCodes} VAT codes, mapped to RGS {rgs}.',
  'setup.currency': 'Currency',
  'setup.fiscalYear': 'Book year',
  'setup.startsIn': 'Starts in',
  'setup.fiscalYearNote':
    'A book year need not be a calendar year. The year is named after the month it opens in, so a book year opening in July 2026 is called 2026.',
  'setup.create': 'Create administration',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.busy': 'Working…',
  'common.unknownError': 'Something went wrong.',
  'common.none': 'none',
  'common.never': 'never',
  'common.yes': 'yes',
  'common.no': 'no',
  'common.retry': 'Try again',

  'error.title': 'This screen could not be loaded',
  'error.body':
    'Usually the connection dropped for a moment. Try again; if it keeps happening, this is the message to pass on.',
  'common.count_one': '{count} line',
  'common.count_other': '{count} lines',
}
