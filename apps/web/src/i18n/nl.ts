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

  // The dashboard.
  'dash.title': 'Dashboard',
  'dash.intro': 'Boekjaar {year}. De drie getallen die zeggen of de boeken kloppen.',
  'dash.trialBalance': 'Proefbalans',
  'dash.trialBalanceEqual': 'Debet en credit zijn gelijk.',
  'dash.trialBalanceDifference': 'Verschil tussen debet en credit.',
  'dash.chain': 'Hash-keten',
  'dash.chainVerified': 'Geverifieerd',
  'dash.chainBroken': 'Gebroken',
  'dash.chainHint': '{count} posten. Kop: {head}…',
  'dash.rgsCoverage': 'RGS-dekking',
  'dash.rgsCoverageHint': '{mapped} van {total} rekeningen gekoppeld aan RGS {version}',
  'dash.unmapped': 'Niet-gekoppelde rekeningen',
  'dash.unmappedBody': 'Deze rekeningen komen niet voor in een RGS-rapportage of in de auditfile.',
  'dash.unmappedFix': 'Koppelingen bijwerken',
  'dash.exportTitle': 'Je gegevens verlaten Klopt wanneer je wilt',
  'dash.exportBody':
    'Een volledige XAF 3.2-auditfile met RGS-codes, gevalideerd tegen het gepubliceerde schema.',
  'dash.exportAction': 'Auditfile downloaden',

  // Journal entries and the chart of accounts.
  'entries.title': 'Journaalposten',
  'entries.intro': 'Onveranderlijk. Correcties zijn tegenboekingen.',
  'entries.empty': 'Nog geen journaalposten geboekt.',
  'entries.number': 'Nr.',
  'entries.bookingDate': 'Boekdatum',
  'entries.description': 'Omschrijving',
  'entries.hash': 'Hash',
  'accounts.title': 'Grootboekrekeningen',
  'accounts.caption': 'Grootboekrekeningen met hun RGS-koppeling',
  'accounts.intro':
    '{mapped} van {total} gekoppeld aan RGS {version} ({variant}). {percentage}% van het saldo is rapporteerbaar.',
  'accounts.number': 'Nummer',
  'accounts.description': 'Omschrijving',
  'accounts.kind': 'Soort',
  'accounts.unmapped': 'niet gekoppeld',
  'accounts.blocked': 'geblokkeerd',
  'accounts.type.asset': 'Activa',
  'accounts.type.liability': 'Passiva',
  'accounts.type.equity': 'Eigen vermogen',
  'accounts.type.revenue': 'Opbrengsten',
  'accounts.type.expense': 'Kosten',

  // The three statements.
  'trial.title': 'Proefbalans',
  'trial.intro': 'Boekjaar {year}, periode {from} tot en met {to}.',
  'trial.empty': 'Nog geen boekingen in dit boekjaar.',
  'trial.account': 'Rek.',
  'trial.opening': 'Beginsaldo',
  'trial.debit': 'Debet',
  'trial.credit': 'Credit',
  'trial.closing': 'Eindsaldo',
  'report.total': 'Totaal',
  'balance.title': 'Balans',
  'balance.intro': 'Per {date}, in {currency}.',
  'balance.result': 'Resultaat boekjaar',
  'balance.totalAssets': 'Totaal activa',
  'balance.totalLiabilities': 'Totaal passiva',
  'balance.doesNotBalance': 'De balans sluit niet: verschil van',
  'balance.doesNotBalanceBody': '. Dit hoort niet te kunnen en is een fout in het grootboek.',
  'profit.title': 'Winst- en verliesrekening',
  'profit.intro': '{from} tot en met {to}, in {currency}.',
  'profit.revenue': 'Opbrengsten',
  'profit.expenses': 'Kosten',
  'profit.loss': 'Verlies',
  'profit.result': 'Resultaat',

  // Creditor ageing.
  'ageing.title': 'Ouderdomsanalyse crediteuren',
  'ageing.intro': 'Openstaande inkoopfacturen per {date}, ingedeeld naar hoe lang ze te laat zijn.',
  'ageing.caption': 'Openstaande bedragen per leverancier en ouderdom',
  'ageing.supplier': 'Leverancier',
  'ageing.totalOutstanding': 'Totaal openstaand',
  'ageing.overdue': 'Te laat',
  'ageing.controlAccount': 'Grootboek {account}',
  'ageing.reconciles': 'sluit aan',
  'ageing.doesNotReconcile': 'wijkt af',
  'ageing.empty': 'Geen openstaande inkoopfacturen.',
  'ageing.driftBefore': 'De subadministratie telt op tot',
  'ageing.driftMiddle': 'en de grootboekrekening staat op',
  'ageing.driftAfter':
    'betekent dat er op de crediteurenrekening is geboekt buiten een inkoopfactuur om, of dat een factuur is geboekt zonder de koppeling vast te leggen. Zoek het verschil voordat je op deze lijst afgaat.',
  'ageing.difference': 'Het verschil van',
  'ageing.bucket.current': 'Niet vervallen',
  'ageing.bucket.upTo30': '1–30 dagen',
  'ageing.bucket.upTo60': '31–60 dagen',
  'ageing.bucket.upTo90': '61–90 dagen',
  'ageing.bucket.over90': 'Meer dan 90',

  // Booking an entry, and looking at one.
  'entryNew.title': 'Nieuwe journaalpost',
  'entryNew.intro':
    '{mod}+↵ boekt. {mod}+⇧+↵ boekt en begint de volgende. = in een bedrag vult het sluitende bedrag in.',
  'entryNew.journal': 'Dagboek',
  'entryNew.account': 'Rekening',
  'entryNew.accountLine': 'Rekening regel {line}',
  'entryNew.descriptionLine': 'Omschrijving regel {line}',
  'entryNew.debitLine': 'Debet regel {line}',
  'entryNew.creditLine': 'Credit regel {line}',
  'entryNew.addLine': 'Regel toevoegen',
  'entryNew.balances': 'Sluit.',
  'entryNew.difference': 'Verschil',
  'entryNew.post': 'Boeken',
  'entryNew.postAndNext': 'Boeken en volgende',
  'entry.bookingDate': 'Boekdatum',
  'entry.documentDate': 'Documentdatum',
  'entry.period': 'Periode',
  'entry.postedBy': 'Geboekt door',
  'entry.dimensions': 'Dimensies',
  'entry.chain': 'Hash-keten',
  'entry.chainPosition': 'Positie',
  'entry.chainPrevious': 'Vorige',
  'entry.chainThis': 'Deze',
  'entry.chainFirst': '— (eerste post)',
  'entry.reversalOf': 'Dit is een tegenboeking van',
  'entry.reversalOfLink': 'een eerdere post',

  // Sales invoices.
  'invoices.title': 'Verkoopfacturen',
  'invoices.intro': 'Een verstuurde factuur is definitief. Corrigeren gaat met een creditnota.',
  'invoices.new': 'Nieuwe factuur',
  'invoices.empty': 'Nog geen facturen.',
  'invoices.filter': 'Filter',
  'invoices.filter.all': 'Alles',
  'invoices.filter.draft': 'Concept',
  'invoices.filter.issued': 'Verstuurd',
  'invoices.filter.cancelled': 'Vervallen',
  'invoices.status.draft': 'concept',
  'invoices.status.issued': 'verstuurd',
  'invoices.status.cancelled': 'vervallen',
  'invoices.kind.invoice': 'factuur',
  'invoices.kind.creditNote': 'creditnota',
  'invoices.number': 'Nummer',
  'invoices.date': 'Datum',
  'invoices.contact': 'Relatie',
  'invoices.kind': 'Soort',
  'invoices.status': 'Status',
  'invoices.due': 'Vervalt',

  // One sales invoice.
  'invoice.title': 'Factuur',
  'invoice.creditNote': 'Creditnota',
  'invoice.draft': 'Concept',
  'invoice.issueAndPost': 'Versturen en boeken',
  'invoice.send': 'Versturen',
  'invoice.sendAgain': 'Opnieuw versturen',
  'invoice.sendFailed': 'Versturen mislukt: {reason}',
  'invoice.credit': 'Crediteren',
  'invoice.downloadPdf': 'PDF downloaden',
  'invoice.downloadUbl': 'UBL downloaden',
  'invoice.draftNotice':
    'Dit is een concept. Er is nog geen nummer uitgegeven en er is niets geboekt. Versturen is definitief: corrigeren gaat daarna met een creditnota.',
  'invoice.lines': 'Factuurregels',
  'invoice.noLines': 'Geen regels.',
  'invoice.quantity': 'Aantal',
  'invoice.price': 'Prijs',
  'invoice.ledgerAccount': 'Grootboek',
  'invoice.vat': 'Btw',
  'invoice.net': 'Netto',
  'invoice.subtotal': 'Subtotaal',
  'invoice.sent': 'Verzonden',
  'invoice.sentWhen': 'Wanneer',
  'invoice.sentWhat': 'Wat',
  'invoice.sentTo': 'Naar',
  'invoice.sentVia': 'Via',
  'invoice.sentResult': 'Resultaat',
  'invoice.sentDocument': 'Document',
  'invoice.delivered': 'verzonden',
  'invoice.notDelivered': 'niet verzonden',
  'invoice.postedAs': 'Geboekt als',
  'invoice.postedAsLink': 'journaalpost',

  // Drafting a sales invoice.
  'invoiceNew.intro': '{mod}+↵ maakt het concept. Versturen is een aparte stap.',
  'invoiceNew.noCustomers': 'Er zijn nog geen klanten. Maak eerst een relatie aan onder Relaties.',
  'invoiceNew.customer': 'Klant',
  'invoiceNew.issueDate': 'Factuurdatum',
  'invoiceNew.buyerReference': 'Referentie klant',
  'invoiceNew.buyerReferencePlaceholder': 'Kostenplaats',
  'invoiceNew.purchaseOrder': 'Inkoopnummer',
  'invoiceNew.referenceNote':
    'Een e-factuur heeft een van beide referenties nodig — Peppol weigert een factuur zonder (PEPPOL-EN16931-R003). Welke van de twee maakt niet uit.',
  'invoiceNew.unit': 'Eenheid',
  'invoiceNew.quantityLine': 'Aantal regel {line}',
  'invoiceNew.unitLine': 'Eenheid regel {line}',
  'invoiceNew.priceLine': 'Prijs regel {line}',
  'invoiceNew.accountLine': 'Grootboek regel {line}',
  'invoiceNew.vatLine': 'Btw regel {line}',
  'invoiceNew.vatNote':
    'Indicatief. De definitieve btw wordt op de server berekend volgens de afrondingsinstelling van deze administratie, en kan een cent afwijken.',
  'invoiceNew.saveDraft': 'Concept opslaan',
  'invoiceNew.emptyLinesSkipped': 'Regels zonder omschrijving worden overgeslagen.',

  // Contacts — customers and suppliers.
  'contacts.title': 'Relaties',
  'contacts.intro': 'Klanten en leveranciers, met de gegevens die een e-factuur nodig heeft.',
  'contacts.new': 'Nieuwe relatie',
  'contacts.empty': 'Nog geen relaties. Maak er een aan om te kunnen factureren.',
  'contacts.number': 'Nr.',
  'contacts.name': 'Naam',
  'contacts.role': 'Rol',
  'contacts.customer': 'klant',
  'contacts.supplier': 'leverancier',
  'contacts.customerLabel': 'Klant',
  'contacts.supplierLabel': 'Leverancier',
  'contacts.vatNumber': 'Btw-nummer',
  'contacts.country': 'Land',
  'contacts.terms': 'Termijn',
  'contacts.numberLabel': 'Nummer',
  'contacts.legalName': 'Statutaire naam',
  'contacts.kvkNumber': 'KvK-nummer',
  'contacts.email': 'E-mail',
  'contacts.phone': 'Telefoon',
  'contacts.street': 'Straat',
  'contacts.houseNumber': 'Huisnr.',
  'contacts.postalCode': 'Postcode',
  'contacts.city': 'Plaats',
  'contacts.paymentTerms': 'Betalingstermijn',
  'contacts.namePlaceholder': 'Grote Klant N.V.',

  // One contact.
  'contact.title': 'Relatie',
  'contact.intro':
    'Wat hier verandert geldt vanaf nu. Facturen die al verstuurd zijn houden wat erop stond — dat is het document, en dat verandert niet meer.',
  'contact.back': 'Terug',
  'contact.stillOpen': 'Nog open:',
  'contact.stillOpenNote': '. Zolang die er zijn kan de rol niet weg — blokkeren kan wel.',
  'contact.openSales_one': '{count} verkoopfactuur',
  'contact.openSales_other': '{count} verkoopfacturen',
  'contact.openPurchase_one': '{count} inkoopfactuur',
  'contact.openPurchase_other': '{count} inkoopfacturen',
  'contact.and': ' en ',
  'contact.blocked': 'Geblokkeerd',
  'contact.saved': 'Opgeslagen.',

  // Purchase invoices.
  'purchases.title': 'Inkoopfacturen',
  'purchases.intro':
    'Wat leveranciers hebben gestuurd. De bedragen zijn die van hun document — wij rekenen ze na, we rekenen ze niet uit.',
  'purchases.enter': 'Factuur invoeren',
  'purchases.empty': 'Geen inkoopfacturen.',
  'purchases.ageing': 'Ouderdomsanalyse',
  'purchases.drafts': 'Concepten',
  'purchases.awaitingApproval': 'Wacht op fiat',
  'purchases.overdue': 'Te laat',
  'purchases.stillToPay': 'Nog te betalen',
  'purchases.filter.all': 'Alles',
  'purchases.filter.open': 'Openstaand',
  'purchases.filter.disputed': 'In geschil',
  'purchases.invoiceNumber': 'Factuurnr.',
  'purchases.invoiceDate': 'Factuurdatum',
  'purchases.dueDate': 'Vervaldatum',
  'purchases.outstanding': 'Openstaand',

  // Entering a purchase invoice.
  'purchaseNew.title': 'Inkoopfactuur invoeren',
  'purchaseNew.intro':
    'Neem de bedragen over van het document. Ze worden nagerekend, niet uitgerekend — wat de leverancier zegt, is wat je verschuldigd bent.',
  'purchaseNew.noSuppliers':
    'Er is nog geen leverancier. Maak er een aan onder Relaties en vink “leverancier” aan.',
  'purchaseNew.supplierInvoiceNumber': 'Factuurnummer leverancier',
  'purchaseNew.paymentReference': 'Betalingskenmerk',
  'purchaseNew.asOnDocument': 'Zoals op het document',
  'purchaseNew.netAmount': 'Bedrag excl. btw',
  'purchaseNew.lines': 'Regels van de inkoopfactuur',
  'purchaseNew.taxCode': 'Btw-code',
  'purchaseNew.excludingVat': 'Excl. btw',
  'purchaseNew.netLine': 'Excl. btw regel {line}',
  'purchaseNew.taxCodeLine': 'Btw-code regel {line}',
  'purchaseNew.computeTaxLine': 'Btw berekenen voor regel {line}',
  'purchaseNew.computeTaxTitle': 'Btw uit de code berekenen',
  'purchaseNew.linesTogether': 'Regels bij elkaar',
  'purchaseNew.netDoesNotMatch':
    'De regels tellen op tot een ander bedrag dan het document zegt. Er mist een regel, of er staat een typefout in.',
  'purchaseNew.taxDoesNotMatch': 'De btw op de regels is niet de btw op het document.',
  'purchaseNew.totalDoesNotMatch': 'Excl. btw plus btw is niet het totaal.',
  'purchaseNew.saveNote':
    'Opslaan boekt nog niets. Op de factuur zelf staat wat er niet klopt en kun je hem boeken — dan pas ontstaan de schuld en de voorbelasting, met de factuurdatum als boekdatum.',

  // One purchase invoice, and what the checks found.
  'purchase.title': 'Inkoopfactuur',
  'purchase.book': 'Boeken',
  'purchase.approve': 'Goedkeuren voor betaling',
  'purchase.dispute': 'In geschil zetten',
  'purchase.resolve': 'Geschil opgelost',
  'purchase.cancel': 'Laten vervallen',
  'purchase.all': 'Alle facturen',
  'purchase.paid': 'betaald',
  'purchase.dueOn': 'vervalt {date}',
  'purchase.disputeWhy': 'Waarom is deze factuur in geschil?',
  'purchase.disputeHint':
    'Dit is wat de leverancier te horen krijgt en wat de volgende persoon leest. De factuur blijft geboekt — de schuld bestaat tot hij is voldaan of gecrediteerd — maar wordt niet betaald.',
  'purchase.disputed': 'In geschil:',
  'purchase.lines': 'Regels',
  'purchase.linesCaption': 'Regels van deze inkoopfactuur',
  'purchase.findings': 'Bevindingen',
  'purchase.findingsBlocking': ' ({count} blokkerend)',
  'purchase.findingLine': ' (regel {line})',
  'purchase.postedAsEntry': 'journaalpost {number}',
  'purchase.approvedForPayment': ' · goedgekeurd voor betaling',
  'purchase.severity.blocking': 'Blokkerend',
  'purchase.severity.warning': 'Ter beoordeling',
  'purchase.severity.note': 'Ter info',
  'purchase.finding.lines_do_not_sum_to_net': 'Regels tellen niet op tot het bedrag op de factuur',
  'purchase.finding.lines_do_not_sum_to_tax': 'Btw op de regels is niet de btw op de factuur',
  'purchase.finding.net_plus_tax_is_not_total': 'Excl. btw plus btw is niet het totaal',
  'purchase.finding.rate_mismatch': 'Btw wijkt af van het tarief van de code',
  'purchase.finding.reverse_charge_with_tax':
    'Verlegde btw, maar de factuur brengt btw in rekening',
  'purchase.finding.unknown_tax_code': 'Btw-code klopt niet',
  'purchase.finding.no_rule_in_force': 'Btw-code is niet geldig op de factuurdatum',
  'purchase.finding.not_deductible': 'Btw is niet aftrekbaar',
  'purchase.finding.pro_rata': 'Btw is gedeeltelijk aftrekbaar',
  'purchase.finding.duplicate_invoice_number': 'Dit factuurnummer is al eerder geboekt',
} as const

export type MessageKey = keyof typeof nl
