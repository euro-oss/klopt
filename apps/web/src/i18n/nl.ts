/**
 * Dutch, and the source of truth.
 *
 * Dutch first because that is what this system is: a Dutch bookkeeping
 * package, whose users say *journaalpost* and *proefbalans* and whose
 * accountant will not thank anybody for "trial balance". English is the
 * translation, not the original, and the file is written that way round so the
 * terminology stays right by default rather than by discipline.
 *
 * ## Keys are paths, not sentences
 *
 * `nav.dashboard`, not `Dashboard`. A key that *is* the English text looks
 * convenient until the English changes and every translation silently falls
 * back to a sentence nobody wrote.
 *
 * ## Placeholders
 *
 * `{name}` is substituted by `t('key', { name })`. A placeholder with no value
 * is left visible rather than blanked — an obvious `{name}` on screen is a bug
 * somebody reports, and an empty gap is one nobody notices.
 *
 * ## Plurals
 *
 * Both languages have two forms, so a countable message is two keys: `_one`
 * and `_other`. `plural()` picks between them. Anything more elaborate is
 * borrowed complexity until a language that needs it turns up.
 */
export const nl = {
  // The shell, which is on every screen.
  'nav.dashboard': 'Dashboard',
  'nav.entries': 'Journaalposten',
  'nav.accounts': 'Grootboek',
  'nav.invoices': 'Verkoopfacturen',
  'nav.inbox': 'Postvak',
  'nav.purchases': 'Inkoopfacturen',
  'nav.contacts': 'Relaties',
  'nav.bank': 'Bank',
  'nav.payments': 'Betalingen',
  'nav.dunning': 'Aanmaningen',
  'nav.vat': 'BTW',
  'nav.trialBalance': 'Proefbalans',
  'nav.balanceSheet': 'Balans',
  'nav.profitAndLoss': 'Winst & verlies',
  'nav.settings': 'Instellingen',
  'nav.members': 'Toegang',
  'nav.auditLog': 'Wie wat deed',
  'nav.exact': 'Exact Online',
  'nav.retention': 'Bewaarplicht',
  'nav.snapshots': 'Momentopnames',

  'shell.tagline': 'Open boekhouden',
  'shell.administration': 'Administratie',
  'shell.role': 'rol: {role}',
  'shell.signOut': 'Afmelden',
  'shell.help': 'Sneltoetsen',
  'shell.skipToContent': 'Naar de inhoud',
  'shell.navigation': 'Hoofdnavigatie',
  'shell.newEntry': 'Nieuwe journaalpost',

  // Language, which is the one setting that has to be findable in a language
  // you cannot read — so it is labelled in both.
  'language.label': 'Taal / Language',
  'language.nl': 'Nederlands',
  'language.en': 'English',
  'language.saved': 'Taal gewijzigd.',

  // Signing in. The heading is the product name, so it is not translated.
  'signIn.introEmail': 'Vul je e-mailadres in. We sturen je een code.',
  'signIn.introCode': 'Vul de code in die we je hebben gestuurd.',
  'signIn.email': 'E-mail',
  'signIn.sendCode': 'Stuur me een code',
  'signIn.sendFailed': 'De code kon niet worden verstuurd.',
  'signIn.codeSent': 'We hebben een code van {digits} cijfers naar {email} gestuurd.',
  'signIn.codeWrong': 'Die code klopt niet, of is verlopen. Vraag zo nodig een nieuwe aan.',
  'signIn.change': 'wijzigen',
  'signIn.code': 'Code',
  'signIn.verify': 'Aanmelden',
  'signIn.resend': 'Stuur een nieuwe code',
  'signIn.footer': 'Geen wachtwoord nodig. Een code is tien minuten geldig en werkt één keer.',

  // Setting an administration up.
  'setup.needOne': 'Nog geen administratie',
  'setup.needOneBody':
    'Je bent aangemeld als {email}. Zet een administratie op, of vraag een eigenaar om je uit te nodigen voor een bestaande.',
  'setup.start': 'Administratie opzetten',
  'setup.title': 'Nieuwe administratie',
  'setup.intro':
    'Je bent aangemeld als {email}. Vul een naam in — de rest kun je later nog wijzigen.',
  'setup.chartsFailed': 'De rekeningschema’s konden niet worden geladen: {detail}',
  'setup.name': 'Naam van de administratie',
  'setup.namePlaceholder': 'Mijn Bedrijf',
  'setup.legalName': 'Statutaire naam',
  'setup.legalNamePlaceholder': 'Mijn Bedrijf B.V.',
  'setup.optional': '(optioneel)',
  'setup.kvk': 'KvK-nummer',
  'setup.vat': 'Btw-nummer',
  'setup.chart': 'Rekeningschema',
  'setup.chartSummary':
    '{accounts} grootboekrekeningen, {journals} dagboeken en {taxCodes} btw-codes, gekoppeld aan RGS {rgs}.',
  'setup.currency': 'Valuta',
  'setup.fiscalYear': 'Boekjaar',
  'setup.startsIn': 'Begint in',
  'setup.fiscalYearNote':
    'Een boekjaar hoeft geen kalenderjaar te zijn. Het jaar heet naar de maand waarin het begint, dus een boekjaar dat in juli 2026 opent, heet 2026.',
  'setup.create': 'Administratie aanmaken',

  // Things every screen says.
  'common.save': 'Opslaan',
  'common.cancel': 'Annuleren',
  'common.busy': 'Bezig…',
  'common.unknownError': 'Onbekende fout.',
  'common.none': 'geen',
  'common.never': 'nooit',
  'common.yes': 'ja',
  'common.no': 'nee',
  'common.retry': 'Opnieuw proberen',

  'error.title': 'Dit scherm kon niet geladen worden',
  'error.body':
    'Meestal is de verbinding even weg. Probeer het opnieuw; als het blijft gebeuren, is dit de melding om door te geven.',
  'common.count_one': '{count} regel',
  'common.count_other': '{count} regels',
} as const

export type MessageKey = keyof typeof nl
