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
  'signIn.unreachable': 'De server is niet bereikbaar.',
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

  // Bank accounts, statement import and learned rules.
  'bank.title': 'Bank',
  'bank.intro': 'Rekeningen, afschriften en wat er binnenkwam.',
  'bank.matchCount': '{count} koppelen',
  'bank.addAccount': 'Rekening toevoegen',
  'bank.accountName': 'Naam',
  'bank.accountNamePlaceholder': 'Rekening-courant',
  'bank.noAccounts': 'Nog geen bankrekening. Voeg er een toe om afschriften te kunnen inlezen.',
  'bank.noStatement': 'nog geen afschrift',
  'bank.asAt': 'per {date} · {consent}',
  'bank.unmatchedLines': '{count} regels nog te koppelen',
  'bank.importStatement': 'Afschrift inlezen',
  'bank.imported': '{count} transacties ingelezen',
  'bank.importedDuplicates': ', {count} stonden er al.',
  'bank.consent.not_required': 'bestandsimport',
  'bank.consent.active': 'toegang actief',
  'bank.consent.expiring': 'toegang verloopt binnenkort',
  'bank.consent.expired': 'toegang verlopen',
  'bank.counterparty': 'Tegenpartij',
  'bank.counterpartyUnknown': 'onbekend',
  'bank.amount': 'Bedrag',
  'bank.status.matched': 'gekoppeld',
  'bank.status.ignored': 'genegeerd',
  'bank.status.unmatched': 'te koppelen',
  'bank.columns': 'Kolommen van dit bestand',
  'bank.columnsIntro':
    'Dit is een CSV, en elke bank verzint zijn eigen kolommen. Dit is een gok — controleer hem. Hij wordt onthouden, dus dit hoeft één keer.',
  'bank.optionalSuffix': ' (optioneel)',
  'bank.map.bookingDate': 'Datum',
  'bank.map.amount': 'Bedrag',
  'bank.map.indicator': 'Af/bij-kolom',
  'bank.map.counterpartyName': 'Naam tegenpartij',
  'bank.map.counterpartyIban': 'Tegenrekening',
  'bank.map.description': 'Omschrijving',
  'bank.map.reference': 'Kenmerk',
  'bank.map.balanceAfter': 'Saldo na mutatie',
  'bank.dateFormat': 'Datumnotatie',
  'bank.decimalSeparator': 'Decimaalteken',
  'bank.creditIndicator': 'Waarde voor “bij”',
  'bank.unassignedColumns': 'Niet toegewezen: {columns}. Die kolommen worden overgeslagen.',
  'bank.readFile': 'Bestand lezen',
  'bank.wouldDo': 'Wat dit bestand zou doen',
  'bank.format': 'Formaat',
  'bank.formatUnknown': 'onbekend',
  'bank.periodLabel': 'Periode',
  'bank.newCount': 'Nieuw',
  'bank.alreadyImported': 'Al ingelezen',
  'bank.import': 'Inlezen',
  'bank.rules': 'Onthouden regels',
  'bank.rulesIntro': 'Wat er is onthouden van eerdere koppelingen, en hoe vaak het klopte.',
  'bank.ruleIf': 'Als',
  'bank.ruleThen': 'Dan',
  'bank.ruleApplied': 'Toegepast',
  'bank.ruleAccount': 'rekening {iban}',
  'bank.ruleName': 'naam “{name}”',
  'bank.ruleDescription': 'omschrijving bevat “{text}”',
  'bank.ruleAnd': ' en ',
  'bank.ruleDisable': 'Uitzetten',
  'bank.ruleEnable': 'Aanzetten',
  'bank.lines': 'Regels',
  'bank.lastTwoHundred': 'laatste 200',
  'bank.toMatch': 'Te koppelen',
  'bank.toMatchHint': 'nog niet aan een boeking gekoppeld',
  'bank.accounts': 'Rekeningen',
  'bank.transactions': 'Banktransacties',
  'bank.transactionsEmpty': 'Nog geen transacties. Lees een afschrift in.',
  'bank.footerNote':
    'Wat de bank zei, precies zoals de bank het zei. Koppelen aan boekingen gaat via',
  'bank.footerLink': 'de koppelwachtrij',

  // The matching queue.
  'match.title': 'Koppelen',
  'match.intro':
    '↑↓ kiest een regel · ↵ boekt het beste voorstel · 1–9 kiest een voorstel · x slaat over',
  'match.backToBank': 'Terug naar bank',
  'match.nothingToDo': 'Niets te koppelen. Elke banktransactie is geboekt of overgeslagen.',
  'match.queue': 'Wachtrij',
  'match.noCounterparty': 'zonder tegenpartij',
  'match.noCounterpartyTitle': 'Zonder tegenpartij',
  'match.searching': 'Voorstellen zoeken…',
  'match.noSuggestion': 'Geen voorstel. Kies zelf een grootboekrekening.',
  'match.book': 'Boeken',
  'match.chooseYourself': 'Zelf kiezen',
  'match.choosePlaceholder': 'Kies een grootboekrekening…',
  'match.skip': 'Overslaan',
  'match.skipped': 'Overgeslagen.',
  'match.learnNote':
    'Zelf kiezen zonder factuur wordt onthouden: de volgende keer dat er geld van dezelfde tegenpartij komt, staat deze rekening als voorstel bovenaan. Die regels staan onder Bank en kun je uitzetten.',
  'match.suggestionsFailed': 'De suggesties konden niet geladen worden.',
  'match.suggestionsFailedWhy': 'De suggesties konden niet geladen worden: {reason}',
  'match.posted': 'Geboekt als journaalpost {number}',
  'match.postedLearned': ', en onthouden voor volgende keer.',
  'match.strategy.reference': 'factuurnummer',
  'match.strategy.iban_amount': 'rekeningnummer en bedrag',
  'match.strategy.learned_rule': 'eerdere boeking',
  'match.strategy.fuzzy_name': 'naam lijkt erop',
  'match.strategy.oldest_first': 'oudste eerst',

  // VAT — the declaration periods of a year.
  'vat.title': 'BTW',
  'vat.intro':
    'Aangifte {kind}. Elke aangifte wordt uit het grootboek berekend, niet uit een aparte telling.',
  'vat.kind.monthly': 'per maand',
  'vat.kind.quarterly': 'per kwartaal',
  'vat.kind.annual': 'per jaar',
  'vat.year': 'Jaar',
  'vat.period': 'Periode',
  'vat.deadline': 'Uiterlijk',
  'vat.filedSupplement': 'suppletie {number} ingediend',
  'vat.filed': 'ingediend',
  'vat.filedOn': ' op {date}',
  'vat.late': 'te laat',
  'vat.notFiled': 'nog niet ingediend',
  'vat.payable': 'Te betalen',
  'vat.periods': 'Periodes',
  'vat.filedCount': 'Ingediend',
  'vat.lateCount': 'Te laat',
  'vat.periodsCaption': 'BTW-periodes {year}',
  'vat.noPeriods': 'Geen periodes.',

  // One BTW-aangifte.
  'vatReturn.title': 'BTW-aangifte',
  'vatReturn.titleFor': 'BTW-aangifte {period}',
  'vatReturn.intro': '{from} tot en met {to}. Uiterlijk indienen op {deadline}.',
  'vatReturn.icp': 'ICP-opgaaf',
  'vatReturn.allPeriods': 'Alle periodes',
  'vatReturn.owed': '5a Verschuldigd',
  'vatReturn.deductible': '5b Voorbelasting',
  'vatReturn.refund': '5c Terug te vragen',
  'vatReturn.toPay': '5c Te betalen',
  'vatReturn.filed': 'Ingediend',
  'vatReturn.filedOn': ' op {date}',
  'vatReturn.asSupplement': ' als suppletie {number}',
  'vatReturn.deliveryStatus': 'Status van de aanlevering:',
  'vatReturn.reference': ' · kenmerk {reference}',
  'vatReturn.downloadInstance': 'XBRL-instance downloaden',
  'vatReturn.downloadSummary': 'Samenvatting om zelf in te dienen',
  'vatReturn.pollStatus': 'Status opvragen',
  'vatReturn.evidence_one': 'Bewijslast ({count} gebeurtenis)',
  'vatReturn.evidence_other': 'Bewijslast ({count} gebeurtenissen)',
  'vatReturn.evidenceCaption': 'Alles wat er met deze aangifte is gebeurd',
  'vatReturn.when': 'Wanneer',
  'vatReturn.what': 'Wat',
  'vatReturn.referenceColumn': 'Kenmerk',
  'vatReturn.explanation': 'Toelichting',
  'vatReturn.suppletieNeeded':
    'Er is na de aangifte nog geboekt in deze periode. Dit vraagt een suppletie.',
  'vatReturn.suppletieCaption': 'Verschil met de ingediende aangifte',
  'vatReturn.rubriek': 'Rubriek',
  'vatReturn.filedAmount': 'Ingediend',
  'vatReturn.nowAmount': 'Nu',
  'vatReturn.theReturn': 'De aangifte',
  'vatReturn.rubriekenCaption': 'Rubrieken van de BTW-aangifte',
  'vatReturn.base': 'Grondslag',
  'vatReturn.vat': 'BTW',
  'vatReturn.evidenceColumn': 'Onderbouwing',
  'vatReturn.hideLines': 'verberg regels',
  'vatReturn.showLines_one': '{count} regel',
  'vatReturn.showLines_other': '{count} regels',
  'vatReturn.linesBehind': 'Grootboekregels achter rubriek {rubriek}',
  'vatReturn.posting': 'Boeking',
  'vatReturn.code': 'Code',
  'vatReturn.roleBase': ' (grondslag)',
  'vatReturn.roleVat': ' (btw)',
  'vatReturn.reconciliation': 'Aansluiting met de BTW-rekeningen',
  'vatReturn.reconciliationIntro':
    'De mutatie op elke BTW-rekening moet gelijk zijn aan wat de aangifte daarvoor opgeeft. Een verschil is het bedrag dat wel in de boeken staat maar niet in een rubriek terechtkomt, en dat blokkeert de aangifte.',
  'vatReturn.reconciliationCaption': 'Aansluiting van de BTW-rekeningen',
  'vatReturn.taggedMovement': 'Mutatie met code',
  'vatReturn.declared': 'Opgegeven',
  'vatReturn.difference': 'Verschil',
  'vatReturn.untagged': 'Zonder code',
  'vatReturn.noMovements': 'Geen mutaties op een BTW-rekening in deze periode.',
  'vatReturn.reconciles': 'sluit aan',
  'vatReturn.findings': 'Bevindingen ({blocking} blokkerend, {warnings} ter beoordeling)',
  'vatReturn.blockingPrefix': 'Blokkerend: ',
  'vatReturn.warningPrefix': 'Ter beoordeling: ',
  'vatReturn.fileSupplement': 'Suppletie indienen',
  'vatReturn.fileReturn': 'Aangifte indienen',
  'vatReturn.blocked':
    'Deze aangifte kan niet worden ingediend zolang de aansluiting niet klopt. Los de blokkerende bevindingen hierboven op.',
  'vatReturn.noIdentity':
    'Een aangifte wordt geïdentificeerd door het omzetbelastingnummer, en dat staat nog niet in deze administratie. Vul het in onder',
  'vatReturn.taxonomy':
    'Taxonomie {version}, gekozen op basis van de periode — niet op basis van welke versie de nieuwste is.',
  'vatReturn.taxonomyUnverified':
    ' Deze mapping is nog niet gecontroleerd tegen de gepubliceerde Nederlandse Taxonomie, dus de bedragen zijn goed maar de XBRL-elementnamen misschien niet. Zelf indienen kan; elektronisch versturen wordt geweigerd.',
  'vatReturn.nothingToCorrect':
    'Deze periode is ingediend en er is daarna niets meer gewijzigd. Er is dus niets te corrigeren.',
  'vatReturn.how': 'Hoe',
  'vatReturn.transportUnavailable': ' is niet beschikbaar: {reason}',
  'vatReturn.filingReference': 'Kenmerk van de indiening',
  'vatReturn.filingReferenceHint':
    'Het berichtnummer van Digipoort of het kenmerk uit Mijn Belastingdienst. Optioneel, maar het is het enige waarmee je deze aangifte later kunt terugvinden bij de Belastingdienst.',
  'vatReturn.accept_one': 'Ik heb de {count} bevinding hierboven bekeken en dien toch in',
  'vatReturn.accept_other': 'Ik heb de {count} bevindingen hierboven bekeken en dien toch in',
  'vatReturn.why': 'Waarom',
  'vatReturn.whyHint':
    'Deze toelichting wordt bij de aangifte bewaard en hoort bij het dossier van deze periode.',
  'vatReturn.fileAndClose': 'Aangifte indienen en periode vastzetten',
  'vatReturn.fileNote':
    'Indienen zet de perioden in deze aangifte op zacht afgesloten. Alleen de accountant kan er daarna nog in boeken, en zo’n correctie vraagt een suppletie.',
  'vatReturn.transport.manual': 'Zelf indienen via Mijn Belastingdienst Zakelijk',
  'vatReturn.transport.digipoort': 'Digipoort (eigen certificaat)',
  'vatReturn.transport.sbr_provider': 'Via een SBR-dienstverlener',
  'vatReturn.delivery.prepared': 'klaargezet om zelf in te dienen',
  'vatReturn.delivery.delivered': 'ontvangen, nog niet verwerkt',
  'vatReturn.delivery.accepted': 'verwerkt door de Belastingdienst',
  'vatReturn.delivery.rejected': 'afgekeurd',
  'vatReturn.delivery.failed': 'niet verstuurd',
  'vatReturn.interaction.deliver': 'aangeboden',
  'vatReturn.interaction.status': 'status opgevraagd',
  'vatReturn.interaction.confirmation': 'ontvangstbewijs vastgelegd',
  'vatReturn.finding.unknown_tax_code': 'Onbekende BTW-code',
  'vatReturn.finding.no_rule_in_force': 'BTW-code niet geldig op de boekdatum',
  'vatReturn.finding.code_declares_no_vat': 'BTW geboekt op een 0%-code',
  'vatReturn.finding.code_declares_no_base': 'Grondslag zonder rubriek',
  'vatReturn.finding.untagged_control_movement': 'Mutatie op een BTW-rekening zonder code',
  'vatReturn.finding.rate_mismatch': 'BTW wijkt af van grondslag maal tarief',
  'vatReturn.finding.control_account_difference': 'BTW-rekening sluit niet aan',

  // The ICP return.
  'icp.title': 'ICP-opgaaf',
  'icp.titleFor': 'ICP-opgaaf {period}',
  'icp.toVatReturn': 'Naar de BTW-aangifte',
  'icp.goods': 'Goederen',
  'icp.services': 'Diensten',
  'icp.totalDeclared': 'Totaal opgaaf',
  'icp.rubriek3b': 'Rubriek 3b',
  'icp.reconciles': 'sluit aan',
  'icp.doesNotReconcile': 'wijkt af',
  'icp.intro':
    'De opgaaf en rubriek 3b beschrijven dezelfde leveringen — de een per afnemer, de ander per tarief — en de Belastingdienst legt ze naast elkaar. Een verschil tussen je eigen twee aangiftes is de makkelijkste bevinding die er is, dus die wordt hier geblokkeerd.',
  'icp.caption': 'Afnemers in de ICP-opgaaf',
  'icp.vatNumber': 'Btw-nummer',
  'icp.customer': 'Afnemer',
  'icp.empty': 'Geen intracommunautaire leveringen in deze periode.',
  'icp.neverChecked': 'nooit gecontroleerd',
  'icp.checkedOn': ' op ',
  'icp.noConsultationNumber': ' · geen raadplegingsnummer',
  'icp.consultationNumber': ' · nr. {number}',
  'icp.allConfirmed': 'Alle nummers zijn bevestigd',
  'icp.checkCount_one': '{count} nummer bij VIES controleren',
  'icp.checkCount_other': '{count} nummers bij VIES controleren',
  'icp.recheckAll': 'Alles opnieuw controleren',
  'icp.offline':
    'Er is geen VIES-verbinding geconfigureerd, dus er is alleen op vorm gecontroleerd. Zet KLOPT_VIES_ENDPOINT, of controleer de nummers zelf bij de Europese Commissie en leg het raadplegingsnummer vast.',
  'icp.noConsultation':
    'VIES gaf geen raadplegingsnummer terug. Dat gebeurt als het eigen btw-nummer van deze administratie niet is ingevuld — en zonder raadplegingsnummer is er geen bewijs dat je kunt laten zien.',
  'icp.findings': 'Bevindingen',
  'icp.outcome.valid': 'geldig',
  'icp.outcome.invalid': 'ongeldig',
  'icp.outcome.unavailable': 'niet bevestigd',
  'icp.finding.supply_without_counterparty': 'Levering zonder afnemer',
  'icp.finding.counterparty_without_vat_number': 'Afnemer zonder btw-nummer',
  'icp.finding.vat_number_malformed': 'Btw-nummer heeft niet de juiste vorm',
  'icp.finding.vat_number_not_eu': 'Btw-nummer is niet van een EU-lidstaat',
  'icp.finding.vat_number_invalid': 'VIES kent dit btw-nummer niet',
  'icp.finding.vat_number_unproven': 'Btw-nummer niet bij VIES gecontroleerd',
  'icp.finding.proof_predates_period': 'VIES-controle is ouder dan de periode',
  'icp.finding.icp_mismatch': 'Opgaaf en rubriek 3b lopen uiteen',

  // The administration's own details.
  'settings.title': 'Instellingen',
  'settings.intro': 'De gegevens van deze administratie. Een e-factuur kan niet zonder.',
  'settings.saved': 'Opgeslagen.',
  'settings.registration': 'Naam en registratie',
  'settings.tradeName': 'Handelsnaam',
  'settings.kvkHint': 'Acht cijfers.',
  'settings.vatHint': 'Bijvoorbeeld NL123456789B01.',
  'settings.address': 'Adres',
  'settings.houseNumber': 'Huisnummer',
  'settings.contactAndPayment': 'Contact en betaling',
  'settings.ibanHint': 'Komt op de factuur als betaalinstructie.',
  'settings.eInvoicing': 'E-facturatie',
  'settings.eInvoicingIntro':
    'Het elektronische adres waarop deze administratie te bereiken is. Peppol vereist het, ook als je de factuur per e-mail verstuurt.',
  'settings.electronicAddress': 'Elektronisch adres',
  'settings.electronicAddressHint': 'Leeg laten om het KvK-nummer te gebruiken.',
  'settings.scheme': 'Schema',
  'settings.scheme.auto': 'Automatisch (KvK-nummer)',
  'settings.scheme.0106': '0106 — KvK-nummer',
  'settings.scheme.0190': '0190 — OIN',
  'settings.scheme.9944': '9944 — btw-nummer',
  'settings.vatRounding': 'Btw-afronding',
  'settings.vatRoundingIntro':
    'Per factuur of per regel. De twee geven andere uitkomsten — drie regels van 33,33 bij 21% worden 7,00 per regel en 6,99 op het totaal — en dit is een keuze, geen detail.',
  'settings.perInvoice': 'Per factuur',
  'settings.perLine': 'Per regel',
  'settings.bankCharges': 'Bankkosten',
  'settings.bankChargesIntro':
    'Waar bankkosten heen gaan als een betaling net te laag binnenkomt. Zonder rekening wordt het afsplitsen niet aangeboden — dan is het handmatig boeken, wat beter is dan een voorstel dat niet geboekt kan worden.',
  'settings.bankChargesAccount': 'Rekening voor bankkosten',
  'settings.bankChargesNone': 'Niet afsplitsen',

  // Postvak — the inbound queue, and where post comes from.
  'inbox.title': 'Postvak',
  'inbox.intro':
    'Alles wat binnenkomt — geüpload, per e-mail, via Peppol — staat in één rij. Wat gelezen kan worden is al ingevuld; de rest wacht op iemand.',
  'inbox.addFile': 'Bestand toevoegen',
  'inbox.waiting': 'Wacht op behandeling',
  'inbox.showing': 'In beeld',
  'inbox.filter.new': 'Nieuw',
  'inbox.filter.drafted': 'Verwerkt',
  'inbox.filter.discarded': 'Terzijde gelegd',
  'inbox.empty': 'Niets in het postvak.',
  'inbox.alreadyHeld':
    'Dit bestand was er al. Het staat nu twee keer in het postvak, als één document.',
  'inbox.parseError': 'Er kon niets uit gelezen worden: {reason}',
  'inbox.unreadable':
    'Opgeslagen. Uit dit soort bestand kan niets gelezen worden — voer de factuur zelf in en hang dit bestand eraan.',
  'inbox.noSupplierMatched': 'Gelezen, maar niet aan een leverancier gekoppeld. Kies er zelf een.',
  'inbox.unnamedDocument': 'Document zonder naam',
  'inbox.unknownSender': 'onbekende afzender',
  'inbox.receivedOn': ' op ',
  'inbox.receivedFrom': ' · van {from}',
  'inbox.seenBefore': ' · dit bestand was er al',
  'inbox.openDocument': 'Document openen',
  'inbox.close': 'Sluiten',
  'inbox.handle': 'Verwerken',
  'inbox.toInvoice': 'Naar de factuur',
  'inbox.setAsideReason': 'Terzijde gelegd: {reason}',
  'inbox.dueOn': ' · vervalt {date}',
  'inbox.noSupplierYet': ' · nog geen leverancier',
  'inbox.cannotRead': 'Uit dit bestand kan niets gelezen worden. Voer de factuur zelf in onder',
  'inbox.orSetAside': ', of leg het terzijde.',
  'inbox.whySetAside': 'Waarom terzijde?',
  'inbox.setAside': 'Terzijde leggen',
  'inbox.chooseSupplier': '— kies een leverancier —',
  'inbox.linesCaption': 'Regels uit het document, met de codering',
  'inbox.choose': '— kies —',
  'inbox.makeDraft': 'Concept maken',
  'inbox.amountsFixed': 'De bedragen komen van het document en zijn hier niet te wijzigen.',
  'inbox.source.upload': 'geüpload',
  'inbox.source.email': 'per e-mail',
  'inbox.source.peppol': 'via Peppol',
  'inbox.source.generated': 'zelf gemaakt',
  'sources.title': 'Waar post vandaan komt',
  'sources.intro':
    'Een map waar bestanden in gezet worden vraagt geen wachtwoord en is de gewone keuze; een mailbox wordt elke vijf minuten geleegd. Wat via Peppol binnenkomt wordt bezorgd en hoeft niet opgehaald te worden.',
  'sources.noSecrets':
    'Er is geen KLOPT_ENCRYPTION_KEY ingesteld, dus een wachtwoord kan niet veilig bewaard worden. Een map werkt wel — die heeft er geen nodig.',
  'sources.empty': 'Nog geen bronnen. Alles komt nu binnen doordat iemand het hierboven toevoegt.',
  'sources.caption': 'Bronnen waar post vandaan komt',
  'sources.name': 'Naam',
  'sources.where': 'Waar',
  'sources.lastPolled': 'Laatst opgehaald',
  'sources.never': 'nog nooit',
  'sources.pollNow': 'Nu ophalen',
  'sources.remove': 'Verwijderen',
  'sources.pollResult': '{messages} nieuw bericht(en), {documents} document(en).',
  'sources.pollFailed': 'Ophalen is niet gelukt.',
  'sources.add': 'Bron toevoegen',
  'sources.kind': 'Soort',
  'sources.kindMaildir': 'Map met bestanden',
  'sources.kindImap': 'Mailbox (IMAP)',
  'sources.directory': 'Map',
  'sources.host': 'Server',
  'sources.user': 'Gebruiker',
  'sources.password': 'Wachtwoord',
  'sources.processedMailbox': 'Map voor verwerkte post',
  'sources.processedPlaceholder': 'Verwerkt',
  'sources.label.maildir': 'map',
  'sources.label.imap': 'mailbox',
  'sources.label.peppol': 'Peppol',

  'exact.divisionChosen': '{name} is gekozen.',
  'exact.divisionChosenCaution': '{name} is gekozen — let op: {cautions}.',

  // Bringing an administration across from Exact Online.
  'exact.title': 'Exact Online',
  'exact.intro': 'Relaties, openstaande posten, grootboekschema en documenten overzetten.',
  'exact.disconnect': 'Verbinding verbreken',
  'exact.chooseAccount': '— kies een rekening —',
  'exact.blockedSuffix': ' (geblokkeerd)',
  'exact.step1Connect': '1. Verbinden',
  'exact.step1Intro':
    'De OAuth-app is van degene die deze installatie beheert. Registreer hem in het Exact App Center met precies deze redirect-URI — Exact vergelijkt hem letterlijk.',
  'exact.noEncryptionKey':
    'Er is geen KLOPT_ENCRYPTION_KEY ingesteld, dus een client secret kan niet versleuteld worden opgeslagen. Zet die eerst; onversleuteld bewaren doet dit systeem niet.',
  'exact.needsHttps': 'Exact accepteert alleen een https-redirect. Start de app met',
  'exact.needsHttpsAfter': 'en open die URL, of zet er een https-proxy voor.',
  'exact.environment': 'Exact-omgeving',
  'exact.clientId': 'Client ID',
  'exact.clientSecret': 'Client secret',
  'exact.redirectUri': 'Redirect-URI',
  'exact.signIn': 'Aanmelden bij Exact',
  'exact.step1Connected': '1. Verbonden',
  'exact.unknownUser': 'onbekende gebruiker',
  'exact.lastImported': ' · laatst overgezet {date}',
  'exact.step2': '2. Welke administratie',
  'exact.step2Intro':
    'Eén Exact-login bereikt élke administratie waar deze gebruiker rechten op heeft. Kies de juiste: achteraf is aan de cijfers niet te zien welke het was.',
  'exact.chosen': 'Gekozen:',
  'exact.fetchDivisions': 'Administraties ophalen',
  'exact.fetchAgain': 'Opnieuw ophalen',
  'exact.division': 'Administratie',
  'exact.divisionNumber': 'Nummer',
  'exact.divisionVat': 'BTW-nummer',
  'exact.caution': 'Let op',
  'exact.isChosen': 'gekozen',
  'exact.chooseThis': 'kies deze',
  'exact.step3': '3. Proefimport',
  'exact.step3Intro':
    'Leest de administratie en sluit aan op de proefbalans van Exact zelf. Er wordt niets overgezet.',
  'exact.fiscalYear': 'Boekjaar',
  'exact.runPreview': 'Proefimport uitvoeren',
  'exact.step4': '4. Overzetten',
  'exact.step4Intro':
    'Zet het grootboekschema, de relaties en de openstaande posten over. De openstaande posten komen als één beginbalanspost in het grootboek.',
  'exact.openingDate': 'Datum beginbalans',
  'exact.journal': 'Dagboek',
  'exact.chooseJournal': '— kies een dagboek —',
  'exact.receivableAccount': 'Debiteurenrekening',
  'exact.payableAccount': 'Crediteurenrekening',
  'exact.openingAccount': 'Tegenrekening beginbalans',
  'exact.openingAccountHint':
    'Hier komt de andere kant van elke openstaande post terecht. Een tussenrekening is hiervoor het veiligst: die staat pas op nul als de rest van de balans óók is overgezet, dus een restsaldo is het signaal dat er nog iets mist. Er is met opzet geen standaard — een verkeerde keuze is achteraf aan de cijfers niet te zien.',
  'exact.commit': 'Definitief overzetten',
  'exact.imported':
    'Overgezet: {accounts} grootboekrekeningen, {contacts} relaties, {openItems} openstaande posten ({receivables} debiteuren, {payables} crediteuren).',
  'exact.openingIn': 'De beginbalans staat in journaalpost',
  'exact.openingInAfter': '. Eén post, dus terugdraaien is één storno.',
  'exact.trialBalanceLabel': 'Proefbalans {year}',
  'exact.notRead': 'niet gelezen',
  'exact.noBalances': 'geen saldi',
  'exact.balances': 'sluit',
  'exact.doesNotBalance': 'sluit niet',
  'exact.debitCredit': '{debit} debet / {credit} credit',
  'exact.noAccessToReporting': 'Exact gaf geen toegang tot financial/ReportingBalance',
  'exact.noRowsForYear': 'Exact gaf geen enkele regel terug voor dit jaar',
  'exact.ledgerAccounts': 'Grootboekrekeningen',
  'exact.newCount': '{count} nieuw',
  'exact.newAndDerived': '{count} nieuw, {derived} afgeleid',
  'exact.contacts': 'Relaties',
  'exact.outstanding': 'Openstaand',
  'exact.outstandingHint': '{receivables} debiteuren, {payables} crediteuren',
  'exact.openItemsReconciliation': 'Aansluiting openstaande posten',
  'exact.unreadableTrialBalance':
    'De proefbalans van Exact kon niet gelezen worden, dus de openstaande posten zijn niet tegen de tussenrekeningen aangesloten.',
  'exact.emptyTrialBalance':
    'Exact gaf voor {year} helemaal geen saldi terug, dus er was niets om tegen aan te sluiten.',
  'exact.reconciliationCaveat':
    'Wat er staat is wat de openstaande posten zelf zeggen — niet dat het klopt.',
  'exact.side': 'Zijde',
  'exact.accountsColumn': 'Rekening(en)',
  'exact.ledgerColumn': 'Grootboek',
  'exact.openItemsColumn': 'Openstaande posten',
  'exact.differenceColumn': 'Verschil',
  'exact.receivables': 'Debiteuren',
  'exact.payables': 'Crediteuren',
  'exact.noneFound': 'geen gevonden',
  'exact.blocking': 'Blokkerend ({count})',
  'exact.requests': 'Verzoeken aan Exact ({count}) — {rows} rijen in {seconds}s',
  'exact.resource': 'Resource',
  'exact.statusColumn': 'Status',
  'exact.rowsColumn': 'Rijen',
  'exact.durationColumn': 'Duur',
  'exact.warnings': 'Let op ({count})',
  'exact.nothingToReport': 'Niets om te melden.',
  'exact.caution.practice': 'oefenadministratie',
  'exact.caution.dossier': 'dossieradministratie',
  'exact.caution.archived': 'gearchiveerd',
  'exact.caution.inactive': 'inactief',
  'exact.caution.blocked': 'geblokkeerd',
  'docs.title': 'Documentarchief',
  'docs.intro':
    'Haalt de bijlagen uit Exact op en bewaart ze hier. Dit draait op de achtergrond en gaat na een herstart verder waar het gebleven was — bij tienduizenden bestanden duurt het uren, en het stopt vanzelf als het dagbudget van Exact bijna op is.',
  'docs.workerSilent':
    'De worker lijkt niet te draaien: deze opdracht staat al een tijd te wachten en is nog niet opgepakt. Start hem met',
  'docs.workerSilentMiddle': '(die start web én worker) of apart met',
  'docs.status': 'Status:',
  'docs.storedAndSkipped': ' — {stored} opgeslagen, {skipped} al aanwezig.',
  'docs.refresh': 'Opnieuw bijwerken',
  'docs.fetch': 'Documenten ophalen',
  'docs.run.pending': 'wacht op de worker',
  'docs.run.running': 'bezig',
  'docs.run.paused': 'gepauzeerd tot morgen — het dagbudget van Exact was bijna op',
  'docs.run.done': 'klaar',
  'docs.run.failed': 'gestopt',

  // Coming back from Exact's sign-in.
  'exactCallback.finishing': 'Aanmelding afronden…',
  'exactCallback.noCode': 'Geen autorisatiecode ontvangen van Exact.',
  'exactCallback.wait': 'Even geduld.',
  'exactCallback.startOver': 'Begin opnieuw op de',
  'exactCallback.exactPage': 'Exact-pagina',

  // Chasing what is overdue.
  'dunning.title': 'Aanmaningen',
  'dunning.intro': 'Openstaande facturen per {date}, met de herinnering die elk nu verdient.',
  'dunning.toChase': 'Te chasen',
  'dunning.toChaseHint': 'facturen met een openstaande herinnering',
  'dunning.outstandingAmount': 'Openstaand bedrag',
  'dunning.outstandingHint': 'van de facturen in deze lijst',
  'dunning.schedule': 'Schema',
  'dunning.empty': 'Niets te chasen. Elke openstaande factuur is nog op tijd, of is al aangemaand.',
  'dunning.invoice': 'Factuur',
  'dunning.overdueSince': 'Vervallen',
  'dunning.days': 'Dagen',
  'dunning.amount': 'Bedrag',
  'dunning.nextStep': 'Volgende stap',
  'dunning.noEmail': ' · geen e-mailadres',
  'dunning.send': 'Versturen',
  'dunning.sent': '{stage} verstuurd naar {name}.',
  'dunning.sendFailed': 'Versturen naar {name} mislukt: {reason}',

  // Sealed snapshots.
  'snapshots.title': 'Verzegelde momentopnames',
  'snapshots.intro':
    'Een boekjaar onder één hash: de kop van de hashketen, een manifest van documenthashes en de auditfile. Klein genoeg om op te schrijven, genoeg om een wijziging in zeven jaar boekhouding aan te tonen.',
  'snapshots.failed': 'Dat is niet gelukt.',
  'snapshots.seal': 'Verzegelen',
  'snapshots.count': 'Momentopnames',
  'snapshots.checked': 'Gecontroleerd',
  'snapshots.drifted': 'Afwijkingen',
  'snapshots.empty':
    'Nog geen momentopnames. De werker verzegelt elk boekjaar met posten dat er nog geen heeft; hierboven kan het ook met de hand.',
  'snapshots.bookYear': 'Boekjaar {year}',
  'snapshots.checkedOn': 'gecontroleerd op {date}',
  'snapshots.driftFound': 'afwijking gevonden',
  'snapshots.sealLabel': 'zegel ',
  'snapshots.entries': 'Journaalposten',
  'snapshots.documents': 'Documenten',
  'snapshots.deletedCount': ' ({count} verwijderd)',
  'snapshots.chainHead': 'Ketenkop',
  'snapshots.previousSeal': 'Vorige zegel',
  'snapshots.verify': 'Controleren',
  'snapshots.verifyWithAuditFile': 'Controleren met auditfile',
  'snapshots.manifest': 'Manifest',
  'snapshots.drift.seal_broken': 'zegel klopt niet met het manifest',
  'snapshots.drift.chain_head_changed': 'journaalpost herschreven',
  'snapshots.drift.entry_count_fell': 'journaalposten verdwenen',
  'snapshots.drift.audit_file_changed': 'auditfile exporteert anders',
  'snapshots.drift.document_missing': 'document verdwenen',
  'snapshots.drift.document_changed': 'document veranderd',
  'snapshots.drift.document_undeleted': 'verwijderd document is terug',

  // The retention obligation.
  'retention.title': 'Bewaarplicht',
  'retention.intro':
    'Zeven jaar, tien voor onroerend goed, gerekend vanaf het einde van het boekjaar waar een document bij hoort. Verwijderen gebeurt nooit automatisch.',
  'retention.failed': 'Dat is niet gelukt.',
  'retention.documents': 'Documenten',
  'retention.expired': 'Termijn verlopen',
  'retention.legalHold': 'Legal hold',
  'retention.undated': 'Geen boekjaar',
  'retention.freeable': 'Vrij te maken',
  'retention.storage': 'Opslag: {name}',
  'retention.objectLockBefore': 'met object lock ({mode}). De opslag houdt',
  'retention.objectLockMiddle': 'van de',
  'retention.objectLockAfter':
    'documenten met een bekende termijn zelf vast — verwijderen kan dan niet, ook niet door ons.',
  'retention.entityHold': 'Legal hold op de hele administratie',
  'retention.entityHoldIntro':
    'Schort verwijderen op, ongeacht de bewaartermijn. Een geschil of een boekenonderzoek duurt langer dan de termijn, en dan moet de klok niet meer uitmaken.',
  'retention.holdOn': 'Aan',
  'retention.lift': 'Opheffen',
  'retention.why': 'Waarom',
  'retention.whyPlaceholder': 'Boekenonderzoek Belastingdienst',
  'retention.set': 'Instellen',
  'retention.empty': 'Nog geen documenten.',
  'retention.caption': 'Documenten en hun bewaartermijn',
  'retention.document': 'Document',
  'retention.bookYear': 'Boekjaar',
  'retention.retainUntil': 'Bewaren tot',
  'retention.size': 'Grootte',
  'retention.select': 'Selecteer {name}',
  'retention.unnamed': 'naamloos',
  'retention.notLinked': 'nog niet gekoppeld',
  'retention.linkedCount': '{count}× gekoppeld',
  'retention.selectPrompt':
    'Selecteer documenten om ze op hold te zetten, als onroerend goed te merken, of te verwijderen als de termijn voorbij is.',
  'retention.selected': '{count} geselecteerd, waarvan {deletable} met verlopen termijn.',
  'retention.tenYears': 'Tien jaar (onroerend goed)',
  'retention.reasonLabel': 'Reden — verplicht bij hold en bij verwijderen',
  'retention.reasonPlaceholder': 'Bewaartermijn 2018 verlopen',
  'retention.putOnHold': 'Op hold zetten',
  'retention.deleteCount': 'Definitief verwijderen ({count})',
  'retention.state.expired': 'termijn verlopen',
  'retention.state.retained': 'bewaren',
  'retention.state.held': 'legal hold',
  'retention.state.undated': 'geen boekjaar',
  'retention.state.deleted': 'verwijderd',

  // The audit log.
  'audit.title': 'Wie wat deed',
  'audit.intro':
    'Elke wijziging met wie, wanneer, vanaf welk adres en onder welk verzoek. Alleen toevoegen — een correctie is een nieuwe regel, net als in het journaal.',
  'audit.export': 'Exporteren',
  'audit.linesShown': 'Regels in beeld',
  'audit.people': 'Mensen',
  'audit.empty': 'Nog niets vastgelegd.',
  'audit.onBehalfOf': ' voor {principal}',
  'audit.hide': 'Verbergen',
  'audit.whatChanged': 'Wat er veranderde',
  'audit.before': 'Voor',
  'audit.after': 'Na',
  'audit.request': ' · verzoek {id}',
  'audit.kind.all': 'Alles',
  'audit.kind.paymentBatches': 'Betaalbatches',
  'audit.kind.vatFilings': 'BTW-aangiften',
  'audit.actor.human': 'mens',
  'audit.actor.script': 'script',
  'audit.actor.agent': 'agent',

  // Payment batches, and one batch.
  'payments.title': 'Betalingen',
  'payments.intro': 'Een batch wordt door één iemand klaargezet en door een ander gefiatteerd.',
  'payments.newBatch': 'Nieuwe batch',
  'payments.noBankAccount': 'Er is nog geen bankrekening. Voeg er een toe onder',
  'payments.reference': 'Kenmerk',
  'payments.executionDate': 'Uitvoerdatum',
  'payments.account': 'Rekening',
  'payments.instructions': 'Posten',
  'payments.create': 'Aanmaken',
  'payments.batches': 'Batches',
  'payments.awaitingApproval': 'Wacht op fiat',
  'payments.awaitingApprovalHint': 'door iemand anders dan wie ze klaarzette',
  'payments.readyToPay': 'Klaar om te betalen',
  'payments.caption': 'Betaalbatches',
  'payments.empty': 'Nog geen betaalbatches.',
  'payments.state.draft': 'concept',
  'payments.state.submitted': 'wacht op fiat',
  'payments.state.approved': 'gefiatteerd',
  'payments.state.exported': 'verstuurd naar de bank',
  'payments.state.rejected': 'afgekeurd',
  'batch.title': 'Betaalbatch {reference}',
  'batch.intro': '{iban} · uitvoerdatum {date} · {state}',
  'batch.stateNow': 'Status is nu: {state}.',
  'batch.submit': 'Ter fiattering aanbieden',
  'batch.approve': 'Fiatteren',
  'batch.reject': 'Afkeuren',
  'batch.rejectedReason': 'afgekeurd',
  'batch.reopen': 'Weer openen',
  'batch.download': 'Bestand downloaden',
  'batch.markSent': 'Markeren als verstuurd',
  'batch.back': 'Terug',
  'batch.iSubmitted':
    'Je hebt deze batch zelf klaargezet, dus iemand anders moet hem fiatteren. Dat is niet een instelling — het is de hele bedoeling van twee paar ogen.',
  'batch.checkLines':
    'Controleer de regels hieronder. Na fiattering staat de batch vast en kan er alleen nog een nieuwe komen.',
  'batch.beneficiary': 'Begunstigde',
  'batch.remove': 'Weg',
  'batch.lines': 'Betaalregels',
  'batch.linesEmpty': 'Nog geen regels. Een batch die niemand betaalt kan niet worden aangeboden.',
  'batch.approvedInvoices_one': 'Goedgekeurde inkoopfacturen ({count} begunstigde)',
  'batch.approvedInvoices_other': 'Goedgekeurde inkoopfacturen ({count} begunstigden)',
  'batch.runIntro':
    'Eén betaling per leverancier, met hun creditnota’s er al afgehaald — een betaling van min tweehonderd euro bestaat niet, dus moet een creditnota eerst ergens tegen weggestreept worden.',
  'batch.runCaption': 'Wat deze betaalrun zou betalen',
  'batch.settles': 'Wat het afrekent',
  'batch.creditSuffix': ' (credit)',
  'batch.takeOver': 'Deze betalingen overnemen',
  'batch.addPayment': 'Betaling toevoegen',
  'batch.optional': '(optioneel)',
  'batch.amount': 'Bedrag',
  'batch.ownReference': 'Eigen kenmerk',
  'batch.paymentReference': 'Betalingskenmerk',
  'batch.add': 'Toevoegen',
  'batch.exportedHashBefore': 'Verstuurd bestand:',
  'batch.exportedHashAfter':
    '— de hash van precies die bytes, zodat later te controleren is wat de bank kreeg.',

  // Who may see this administration.
  'members.title': 'Toegang',
  'members.intro': 'Wie deze administratie mag zien, en in welke rol.',
  'members.email': 'E-mail',
  'members.role': 'Rol',
  'members.roleOf': 'Rol van {email}',
  'members.memberSince': 'lid sinds {date}',
  'members.remove': 'Verwijderen',
  'members.revoke': 'Intrekken',
  'members.inviteExpired': 'uitnodiging verlopen op {date}',
  'members.invitePending': 'uitgenodigd, nog niet aangemeld — verloopt {date}',
  'members.inviteSomebody': 'Iemand uitnodigen',
  'members.inviteIntro':
    'Ze krijgen een bericht en melden zich aan met dit adres. Heeft het adres al een account, dan is de toegang meteen geregeld.',
  'members.invite': 'Uitnodigen',
  'members.hasAccessNow': '{email} heeft nu toegang.',
  'members.inviteSent': 'Uitnodiging verstuurd naar {email}.',
  'members.inviteTail': 'Ze kunnen zich aanmelden met dit adres en staan er dan meteen in.',
  'members.inviteLogged':
    '{email} is uitgenodigd. Er is geen mailserver ingesteld, dus het bericht staat in het log. {tail}',
  'members.inviteUndelivered':
    '{email} is uitgenodigd, maar het bericht kon niet worden verstuurd{why}. {tail}',
  'members.roleChanged': '{email} is nu {role}.',
  'members.accessRemoved': '{email} heeft geen toegang meer.',
  'members.inviteRevoked': 'De uitnodiging voor {email} is ingetrokken.',
  'members.role.owner': 'Eigenaar',
  'members.role.ownerHint': 'Alles, inclusief toegang en tokens beheren.',
  'members.role.bookkeeper': 'Boekhouder',
  'members.role.bookkeeperHint': 'Boeken en inrichten. Geen jaarafsluiting.',
  'members.role.accountant': 'Accountant',
  'members.role.accountantHint': 'Ook boeken in een zachtgesloten periode, en afsluiten.',
  'members.role.auditor': 'Controleur',
  'members.role.auditorHint': 'Alleen lezen en exporteren.',

  // Tokens and connected apps.
  'tokens.title': 'Tokens en gekoppelde apps',
  'tokens.intro':
    'Een token laat een script of een assistent deze administratie lezen. Met “concepten maken” mag het ook conceptfacturen aanmaken — versturen, boeken en definitief maken blijft aan een mens. Apps die je via “Toegang geven” hebt gekoppeld staan er ook tussen; die loskoppelen doet meteen alle tokens vervallen die de app heeft.',
  'tokens.issued': 'Dit is het token voor {name}.',
  'tokens.issuedOnce':
    'Je ziet het nu één keer. Er wordt alleen een hash bewaard, dus er is geen scherm dat het later nog kan tonen.',
  'tokens.saved': 'Ik heb het bewaard',
  'tokens.name': 'Naam',
  'tokens.namePlaceholder': 'Bijvoorbeeld: boekhouder-export',
  'tokens.whatItMay': 'Wat het mag',
  'tokens.readOnly': 'Alleen lezen',
  'tokens.readAndDraft': 'Lezen en concepten maken',
  'tokens.create': 'Token maken',
  'tokens.empty': 'Er zijn nog geen tokens.',
  'tokens.lastUsed': 'Laatst gebruikt',
  'tokens.connectedApp': 'gekoppelde app',
  'tokens.everything': 'alles',
  'tokens.never': 'nooit',
  'tokens.revoke': 'Intrekken',
  'tokens.disconnect': 'App loskoppelen',
  'tokens.state.live': 'actief',
  'tokens.state.expired': 'verlopen',
  'tokens.state.revoked': 'ingetrokken',

  // Giving an app access.
  'consent.badRequest': 'Deze aanvraag klopt niet',
  'consent.badRequestBody':
    'Er is niets toegekend. Sluit dit venster en probeer het opnieuw vanuit de app die de koppeling wilde maken.',
  'consent.title': 'Toegang geven',
  'consent.signedInAs': 'Je bent ingelogd als {user}.',
  'consent.asksFor': 'vraagt toegang tot je boekhouding.',
  'consent.grantedToBefore': 'De toegang wordt afgegeven aan',
  'consent.grantedToAfter': '. Herken je dat adres niet, geef dan geen toegang.',
  'consent.administration': 'Administratie',
  'consent.onlyThisOne': 'De toegang geldt alleen voor deze administratie.',
  'consent.whatItMay': 'Wat het mag:',
  'consent.nothingElse': 'Niets wijzigen, niets boeken, niets versturen.',
  'consent.expires':
    'De toegang vervalt automatisch na een uur. Je kunt hem eerder intrekken bij Toegang.',
  'consent.scope.read': 'De boeken lezen: saldi, facturen, openstaande posten, BTW-overzichten.',
  'consent.scope.export': 'Exports maken, zoals een auditfile.',

  // The keyboard map and the command palette.
  'keys.group.global': 'Algemeen',
  'keys.group.goTo': 'Ga naar',
  'keys.group.new': 'Nieuw',
  'keys.group.match': 'Koppelen',
  'keys.group.entry': 'Journaalpost',
  'keys.palette': 'Commandopalet',
  'keys.help': 'Sneltoetsen',
  'keys.goProfitAndLoss': 'Winst- en verliesrekening',
  'keys.goVat': 'BTW-aangifte',
  'keys.newInvoice': 'Nieuwe factuur',
  'keys.matchConfirm': 'Beste voorstel boeken',
  'keys.matchSkip': 'Regel overslaan',
  'keys.matchNext': 'Volgende regel',
  'keys.matchPrevious': 'Vorige regel',
  'keys.entryPost': 'Journaalpost boeken',
  'keys.entryPostAndNext': 'Boeken en de volgende beginnen',
  'keys.entryDuplicateLine': 'Regel dupliceren',
  'keys.entryDeleteLine': 'Regel verwijderen',
  'palette.commands': 'Commando’s',
  'palette.search': 'Zoek een scherm',
  'palette.searchPlaceholder': 'Waar wil je heen?',
  'palette.nothingFound': 'Niets gevonden.',
  'palette.escapeNote':
    'Sluiten met Escape. G en N zijn voorvoegsels; na 1,5 seconde vervallen ze.',
  'table.empty': 'Niets te tonen.',

  // Sidebar groups and the profile block.
  'nav.group.books': 'Boekhouden',
  'nav.group.sales': 'Verkoop',
  'nav.group.purchasing': 'Inkoop',
  'nav.group.money': 'Geld',
  'nav.group.reports': 'Rapporten',
  'nav.group.admin': 'Beheer',
  'shell.profile': 'Profiel',

  // Answering a right-to-erasure request about a contact.
  'erase.title': 'Gegevens wissen op verzoek',
  'erase.intro':
    'Wist naam, e-mail, telefoon, IBAN, adres en notities van deze relatie. De boekhouding blijft: elke factuur bewaart zelf van wie hij was, dus wat verstuurd is verandert niet en het grootboek beweegt geen cent.',
  'erase.keptTitle': 'Wat blijft staan',
  'erase.kept':
    'Het debiteurennummer, want daar hangen de boekingen aan en het gaat mee in de auditfile. Het btw- en KvK-nummer, want die horen bij een onderneming en een ICP-opgaaf moest ze noemen.',
  'erase.irreversible': 'Dit kan niet ongedaan worden gemaakt.',
  'erase.blockedByOpen_one':
    'Kan nog niet: er staat {count} factuur open. Los die eerst af of schrijf hem af — een gewiste relatie kun je niet aanmanen.',
  'erase.blockedByOpen_other':
    'Kan nog niet: er staan {count} facturen open. Los die eerst af of schrijf ze af — een gewiste relatie kun je niet aanmanen.',
  'erase.reason': 'Waarom, en wanneer is het gevraagd?',
  'erase.reasonPlaceholder': 'Verzoek tot verwijdering per e-mail, 12 maart',
  'erase.action': 'Gegevens wissen',
  'erase.done': 'Gewist. Wat er stond is vastgelegd in het logboek.',

  // Authentication in the audit log.
  'audit.kind.auth': 'Aanmelden',

  // Webhooks.
  'nav.webhooks': 'Webhooks',
  'webhooks.title': 'Webhooks',
  'webhooks.intro':
    'Klopt stuurt een bericht naar jouw systeem zodra er iets gebeurt. Het bericht zegt wát er gebeurde en waaraan — niet de factuur zelf. Die haal je op met je eigen token, zodat er niets in een payload belandt dat er niet hoort.',
  'webhooks.pollInstead':
    'Zit je achter NAT en kun je niets ontvangen? Dan is er {link}, met dezelfde gebeurtenissen in dezelfde volgorde.',
  'webhooks.pollLink': '/api/v1/events',
  'webhooks.none': 'Nog geen webhooks.',
  'webhooks.add': 'Webhook toevoegen',
  'webhooks.url': 'URL',
  'webhooks.urlHint': 'Moet https zijn.',
  'webhooks.types': 'Welke gebeurtenissen',
  'webhooks.allTypes': 'Niets aanvinken betekent alles, ook wat er later bij komt.',
  'webhooks.create': 'Aanmaken',
  'webhooks.secretTitle': 'Dit is het ondertekeningsgeheim',
  'webhooks.secretOnce':
    'Je ziet het nu één keer. Controleer er de Klopt-Signature-header mee; zonder die controle weet je niet wie er klopt.',
  'webhooks.secretSaved': 'Ik heb het bewaard',
  'webhooks.status': 'Status',
  'webhooks.enabled': 'actief',
  'webhooks.disabled': 'uitgeschakeld',
  'webhooks.backlog': '{count} wachtend',
  'webhooks.upToDate': 'bij',
  'webhooks.lastSuccess': 'laatst gelukt {date}',
  'webhooks.never': 'nog nooit iets afgeleverd',
  'webhooks.replay': 'Opnieuw versturen vanaf het begin',
  'webhooks.reenable': 'Weer aanzetten',
  'webhooks.remove': 'Verwijderen',
  'webhooks.attempts': 'Laatste pogingen',
  'webhooks.attemptWhen': 'Wanneer',
  'webhooks.attemptResult': 'Antwoord',
  'webhooks.attemptNoReply': 'geen antwoord',
  'webhooks.noEncryptionKey':
    'Er is geen KLOPT_ENCRYPTION_KEY ingesteld, dus een ondertekeningsgeheim kan niet versleuteld worden bewaard. Zet die eerst.',

  // Labels the server computes, translated here from the code it sends
  // alongside them. See ADR 0045.
  'label.purchaseStatus.draft': 'concept',
  'label.purchaseStatus.booked': 'geboekt',
  'label.purchaseStatus.approved': 'goedgekeurd',
  'label.purchaseStatus.disputed': 'in geschil',
  'label.purchaseStatus.cancelled': 'vervallen',

  'label.dunningTone.reminder': 'Betalingsherinnering',
  'label.dunningTone.demand': 'Tweede herinnering',
  'label.dunningTone.final': 'Laatste aanmaning',

  'label.statementSection.assets': 'Activa',
  'label.statementSection.liabilities': 'Schulden',
  'label.statementSection.equity': 'Eigen vermogen',
  'label.statementSection.revenue': 'Opbrengsten',
  'label.statementSection.expenses': 'Kosten',

  'label.retentionClass.standard': 'Zeven jaar',
  'label.retentionClass.immovable_property': 'Tien jaar (onroerend goed)',

  'label.vatPeriod.annual': 'Jaar {year}',
  'label.vatPeriod.quarterly': '{quarter}e kwartaal {year}',
  'label.vatPeriod.monthly': '{month} {year}',

  // The domain's own refusals (ADR 0046), keyed by which sentence rather than
  // by the error code — `invalid_tax_code` alone covers sixteen of these.
  // English lives in `VIOLATION_MESSAGES` in @klopt/core, because that is the
  // language the API speaks; this is the reader's.
  'violation.account_blocked':
    'Grootboekrekening {accountNumber} ({name}) is geblokkeerd voor boekingen.',
  'violation.approval_by_script':
    'Goedkeuren doet een mens. Een script kan geen kosten fiatteren; een mens die via de API met een token werkt wel.',
  'violation.approval_by_submitter.not_a_script':
    'Een betaalbatch moet door een persoon worden goedgekeurd. Een script is geen tweede paar ogen.',
  'violation.approval_by_submitter.not_the_submitter':
    'Een betaalbatch moet worden goedgekeurd door iemand anders dan degene die hem heeft ingediend.',
  'violation.unknown_invitation': 'Zo’n openstaande uitnodiging bestaat niet.',
  'violation.unknown_member.not_a_member': 'Die persoon hoort niet bij deze administratie.',
  'violation.unknown_member.say_who': 'Zeg wie er wordt verwijderd.',
  'violation.dimension_value_blocked':
    'Dimensiewaarde {dimensionType}/{dimensionValue} is geblokkeerd.',
  'violation.duplicate_dimension_type':
    'Dimensie {dimensionType} staat meer dan één keer op deze regel.',
  'violation.entry_too_few_lines.entry_least_two':
    'Een journaalpost heeft minstens twee regels. Eén regel kan niet in balans zijn.',
  'violation.entry_too_few_lines.invoice_line': 'Een factuur heeft een regel nodig.',
  'violation.entry_unbalanced.allocations_exceed_line':
    'De toewijzingen komen op {allocated}, meer dan de {available} die deze regel dekt.',
  'violation.entry_unbalanced.does_not_balance':
    'De post is niet in balans in {currency}: debet min credit is {difference} centen.',
  'violation.entry_unbalanced.file_control_totals':
    'De controletotalen van het bestand kloppen niet met de inhoud: het meldt {declaredLines} regels, {declaredDebit} debet en {declaredCredit} credit; het bevat er {lineCount}, {totalDebit} en {totalCredit}.',
  'violation.entry_unbalanced_functional':
    'De post is niet in balans in {functionalCurrency}: debet min credit is {difference} centen. Is dit een gerealiseerd koersresultaat, boek het restant dan op een koersverschillenrekening.',
  'violation.idempotency_key_reused':
    'Deze idempotency-key is al voor een ander verzoek gebruikt. Een key hoort bij één verzoek, niet bij één client.',
  'violation.invalid_currency': 'Gebruik een ISO 4217-code van drie letters.',
  'violation.invalid_date.booking_date_calendar':
    'De boekdatum moet een echte kalenderdatum zijn, jjjj-mm-dd.',
  'violation.invalid_date.date': '{date} is geen datum.',
  'violation.invalid_date.date_yyyy_mm': 'Een datum is jjjj-mm-dd.',
  'violation.invalid_date.declaration_year_four': 'Een aangiftejaar is vier cijfers.',
  'violation.invalid_date.document_date_calendar':
    'De documentdatum moet een echte kalenderdatum zijn, jjjj-mm-dd.',
  'violation.invalid_date.fiscal_year_labelled':
    'Een boekjaar wordt aangeduid met het beginjaar van vier cijfers.',
  'violation.invalid_date.starting_month': 'De beginmaand is 1 tot en met 12.',
  'violation.invalid_date.validfrom_date': 'validFrom moet een datum zijn.',
  'violation.invalid_date.validity_window_end':
    'Een geldigheidsperiode kan niet eindigen voordat hij begint.',
  'violation.invalid_date.validto_date_null': 'validTo moet een datum of null zijn.',
  'violation.invalid_document.document_invoice_lines': 'Het document heeft geen factuurregels.',
  'violation.invalid_document.expected_ubl_invoice':
    'Verwacht een UBL Invoice of CreditNote, gevonden <{name}>.',
  'violation.invalid_document.readable_xml': 'Dit is geen leesbare XML: {error}',
  'violation.invalid_email': 'Dat is geen e-mailadres.',
  'violation.invalid_exchange_rate.decimal_number': '"{value}" is geen decimaal getal.',
  'violation.invalid_exchange_rate.exchange_rate_positive':
    'Een wisselkoers is een positief decimaal getal als tekst.',
  'violation.invalid_kvk_number': 'Een KvK-nummer is acht cijfers.',
  'violation.invalid_name.administration_name': 'Een administratie heeft een naam nodig.',
  'violation.invalid_name.filing_legal_name': 'Voor de aangifte is de statutaire naam nodig.',
  'violation.invalid_name.name_most_characters': 'Een naam is hoogstens 200 tekens.',
  'violation.invalid_tax_code.aangifte_base_box':
    'De aangifte heeft geen grondslagrubriek voor dit soort transactie — rubriek 5b meldt alleen btw. Laat hem leeg.',
  'violation.invalid_tax_code.article_deferment_applies':
    'De verleggingsregeling van artikel 23 geldt bij invoer. Zet de scope op import.',
  'violation.invalid_tax_code.base_box_named':
    'Deze transactie heeft een grondslagrubriek op de aangifte, dus de code moet die noemen.',
  'violation.invalid_tax_code.deductibility_describes_input':
    'Aftrekbaarheid gaat over voorbelasting. Een verkoopcode heeft die niet.',
  'violation.invalid_tax_code.pro_rata_code':
    'Een pro-ratacode heeft een aftrekbaar deel strikt tussen 0 en 10000 basispunten nodig. Gebruik voor de uitersten volledig of geen.',
  'violation.invalid_tax_code.rate_basis_points': 'Een tarief is 0 tot 10000 basispunten.',
  'violation.invalid_tax_code.rate_needs_rubriek':
    'Een code met een tarief boven nul levert btw op en heeft dus een rubriek nodig om die in aan te geven.',
  'violation.invalid_tax_code.recoverable_share_only':
    'Een aftrekbaar deel betekent alleen iets op een pro-ratacode.',
  'violation.invalid_tax_code.rubriek_reports_base': 'Rubriek {id} meldt geen grondslag.',
  'violation.invalid_tax_code.rubriek_reports_vat': 'Rubriek {id} meldt geen btw-bedrag.',
  'violation.invalid_tax_code.scope_declares_base':
    'Scope {scope} geeft zijn grondslag aan in {allowed}, niet in {baseRubriek}.',
  'violation.invalid_tax_code.self_assesses_vat':
    '{taxCode} verlegt de btw naar zichzelf maar noemt geen aftrekcode, dus de voorbelasting kan nergens heen. Zet er deductionCode op.',
  'violation.invalid_tax_code.supply_kind_named':
    'De ICP-opgaaf meldt goederen en diensten apart, dus een intracommunautaire levering moet zeggen welk van de twee het is.',
  'violation.invalid_tax_code.tax_code_code': 'Een btw-code heeft een code nodig.',
  'violation.invalid_tax_code.tax_code_rule':
    'Btw-code {taxCode} heeft geen regel die geldt op {invoiceDate}. Dit had vóór het boeken opgemerkt moeten worden.',
  'violation.invalid_tax_code.under_domestic_reverse':
    'Bij binnenlandse verlegging brengt de leverancier geen btw in rekening. Het tarief op de verkoopcode is nul.',
  'violation.invalid_tax_code.zero_rate_code':
    'Een nultariefcode levert geen btw op. Laat zijn btw-rubriek leeg.',
  'violation.invalid_vat_number.omzetbelastingnummer':
    'De aangifte wordt geïdentificeerd met het omzetbelastingnummer, en {vatNumber} is er geen. Vul het in bij Instellingen.',
  'violation.invalid_vat_number.dutch_vat_number':
    'Een Nederlands btw-nummer ziet eruit als NL123456789B01.',
  'violation.last_owner.make_somebody_owner':
    'Dit is de laatste eigenaar. Maak eerst iemand anders eigenaar.',
  'violation.last_owner.without_owner':
    'Dit is de laatste eigenaar. Een administratie kan niet zonder.',
  'violation.line_debit_and_credit': 'Een regel is debet of credit, nooit allebei.',
  'violation.line_negative_amount.allocation_point_way':
    'De toewijzing aan {invoiceNumber} wijst niet dezelfde kant op als de betaling.',
  'violation.line_negative_amount.amounts_unsigned':
    'Bedragen zijn zonder teken. Een negatieve debet is een credit en moet ook zo geboekt worden.',
  'violation.line_negative_amount.charges_negative': 'Kosten kunnen niet negatief zijn.',
  'violation.line_no_amount.bank_line_amount':
    'Een bankregel zonder bedrag kan niet worden afgeletterd.',
  'violation.line_no_amount.bank_line_zero': 'Een bankregel van nul boekt niets.',
  'violation.line_no_amount.invoice_totalling_zero': 'Een factuur van nul boekt niets.',
  'violation.line_no_amount.line_amount_posts': 'Een regel zonder bedrag boekt niets.',
  'violation.missing_exchange_rate':
    'Een regel in {currency} heeft een koers naar {functionalCurrency} nodig, en een bron daarvoor.',
  'violation.missing_required_dimension':
    'Rekening {accountNumber} vereist een dimensie {dimensionType}.',
  'violation.no_period_for_date':
    'Geen enkele periode bevat {bookingDate}. Maak eerst het boekjaar aan.',
  'violation.period_already_filed':
    'Deze periode is aangegeven en de cijfers zijn niet veranderd. Er valt niets te corrigeren, dus er is geen suppletie.',
  'violation.period_hard_closed':
    'Periode {fiscalYear}-{period} is afgesloten. Boek in een open periode, of open hem bewust opnieuw.',
  'violation.period_soft_closed':
    'Periode {fiscalYear}-{period} is zacht afgesloten: alleen een accountant mag er nog in boeken.',
  'violation.reversal_target_already_reversed':
    'Post {reversesEntryId} is al gestorneerd door {reversedBy}.',
  'violation.reversal_target_not_found': 'Geen post {reversesEntryId} om te storneren.',
  'violation.unexpected_exchange_rate':
    'Een regel die al in de functionele valuta staat ({functionalCurrency}) mag geen koers dragen.',
  'violation.unknown_account.account': 'Geen rekening {accountNumber}.',
  'violation.unknown_account.account_appropriate_result':
    'Geen rekening {accountNumber} om het resultaat naar over te boeken.',
  'violation.unknown_account.account_year_s':
    'Rekening {accountNumber} is {accountType}. Het jaarresultaat gaat naar het eigen vermogen.',
  'violation.unknown_account.accounted_say_account':
    '{remainder} is nergens aan toegewezen. Zeg bij welke rekening dat hoort.',
  'violation.unknown_account.charges_account_post':
    'Kosten hebben een rekening nodig om op te boeken.',
  'violation.unknown_account.tax_code': 'Geen btw-code {taxCode}.',
  'violation.unknown_account.tax_code_no_account':
    'Btw-code {taxCode} heeft geen grootboekrekening. Stel er een in voordat je ermee boekt.',
  'violation.unknown_account.deduction_code_no_account':
    'Btw-code {deductionCode} heeft geen grootboekrekening. Stel er een in voordat je ermee boekt.',
  'violation.unknown_account.tax_code_no_account_invoicing':
    'Btw-code {taxCode} heeft geen grootboekrekening. Stel er een in voordat je ermee factureert.',
  'violation.unknown_dimension_type': 'Geen dimensiesoort {dimensionType}.',
  'violation.unknown_dimension_value':
    'Geen waarde {dimensionValue} voor dimensie {dimensionType}.',
  'violation.unknown_entity': 'Geen administratie {entityId}.',
  'violation.unknown_entry': 'De post die bij deze idempotency-key hoorde bestaat niet meer.',
  'violation.unknown_journal': 'Geen dagboek {journalCode}.',
  'violation.unknown_role': 'Rol moet eigenaar, boekhouder, accountant of auditor zijn.',
  'violation.unknown_rubriek.rubriek_btw_aangifte': '{id} is geen rubriek op de BTW-aangifte.',
  'violation.unknown_rubriek.rubriek_computed_subtotal':
    'Rubriek {id} is een berekend subtotaal. Een btw-code kan er niet naar schrijven.',
  'violation.unknown_tax_code':
    'Dit bestand gebruikt {count} btw-code(s) die deze administratie niet heeft: {codesWithNames}. Maak ze aan, gekoppeld aan hun rubrieken, en probeer het opnieuw — importeren zonder die codes boekt een jaar dat geen btw aangeeft.',
  'violation.unknown_taxonomy.mapping_maps_btw':
    'Mapping {version} hoort bij {report}, niet bij de BTW-aangifte.',
  'violation.unknown_taxonomy.rubriek_base_mapping':
    'Rubriek {id} heeft een grondslag van {baseMinorUnits} en mapping {version} heeft er geen element voor.',
  'violation.unknown_taxonomy.rubriek_vat_mapping':
    'Rubriek {id} heeft btw van {vatMinorUnits} en mapping {version} heeft er geen element voor.',
  'violation.unknown_taxonomy.taxonomy_mapping_covers':
    'Geen {report}-taxonomiemapping dekt {periodFrom}..{periodTo}. Geladen: {loaded}. Een taxonomie is een datarelease — zie docs/compliance-calendar.md.',
  'violation.unknown_taxonomy.taxonomy_mappings_claim':
    '{count} taxonomiemappings claimen {periodFrom}..{periodTo}: {versions}. Zet hun geldigheidsperiodes recht.',
  'violation.unknown_vat_period':
    '{code} is geen aangifteperiode. Gebruik 2026, 2026-Q1 of 2026-03.',
  'violation.vat_out_of_balance.accepting_warning_reason':
    'Een waarschuwing accepteren vraagt om een reden. Die wordt onderdeel van het dossier voor deze periode.',
  'violation.vat_out_of_balance.return_warning_s':
    'Deze aangifte heeft {count} waarschuwing(en). Lees ze en accepteer ze uitdrukkelijk, met een reden, of los ze op.',
  'violation.wrong_batch_state': 'Een batch die {current} is kan niet worden {actionPast}.',
  'violation.wrong_invoice_state':
    'Een factuur die {current} is kan niet worden {actionPast}. Dat mag vanuit: {allowedFrom}.',

  // What a check found (ADR 0047). Same shape as the refusals above: the
  // English lives in `FINDING_MESSAGES` in @klopt/core and this is the
  // reader's. These reach a screen directly and are also forwarded into a
  // violation when a check blocks a posting.
  'finding.icp.counterparty_without_vat_number':
    'Een intracommunautaire levering is met 0% aan een klant zonder btw-nummer in het dossier. Het nummer van de klant is een voorwaarde voor het nultarief, geen detail.',
  'finding.icp.icp_mismatch':
    'De opgaaf telt op tot {total} en rubriek 3b geeft {rubriek3b} aan (in centen). Beide beschrijven dezelfde leveringen en moeten kloppen; de bevindingen hierboven noemen de regels die de opgaaf niet kon plaatsen.',
  'finding.icp.proof_predates_period':
    'De VIES-controle voor deze klant is van vóór het aangiftetijdvak. Een nummer kan tussen twee kwartalen zijn uitgeschreven, dus dit bewijs is zwakker dan een controle binnen het tijdvak.',
  'finding.icp.supply_without_counterparty':
    'Een intracommunautaire levering staat geboekt zonder klant op de regel en kan dus niet in de opgaaf komen. De aangifte geeft hem aan in 3b en de opgaaf kan dat niet — precies het verschil waar de Belastingdienst als eerste op kijkt.',
  'finding.icp.vat_number_invalid':
    'VIES zegt dat dit btw-nummer niet geldig is. Het nultarief geldt dan niet, en de levering moet worden gecorrigeerd voordat een van beide aangiftes de deur uit gaat.',
  'finding.icp.vat_number_malformed':
    'Het btw-nummer van een klant heeft niet de vorm die die lidstaat uitgeeft. VIES weigert het, dus het wordt hier al geweigerd, waar het nog te herstellen is.',
  'finding.icp.vat_number_not_eu':
    'Een levering is aangemerkt als intracommunautair aan een klant met een btw-nummer dat niet uit een EU-lidstaat komt. Of het nummer klopt niet, of de levering is iets anders.',
  'finding.icp.vat_number_unproven':
    'Dit btw-nummer is nooit tegen VIES gecontroleerd, of de laatste poging kwam er niet doorheen. Wat VIES zei en wanneer is het bewijs voor het nultarief; zonder dat valt er niets te laten zien.',
  'finding.inbound.credit_note':
    'Dit is een creditnota. Hij verlaagt wat verschuldigd is en zijn bedragen worden andersom geboekt.',
  'finding.inbound.currency_not_functional':
    'Het document staat in {currency} en de boeken in {functionalCurrency}. De bedragen worden overgenomen zoals ze er staan; omrekenen gebeurt hier niet.',
  'finding.inbound.no_due_date':
    'Het document heeft geen vervaldatum (BT-9). De betalingstermijn van de leverancier is in plaats daarvan gebruikt.',
  'finding.inbound.no_invoice_number':
    'Het document heeft geen factuurnummer (BT-1), dus er is niets om het onder te boeken of aan te herkennen als het nog eens binnenkomt.',
  'finding.inbound.no_supplier_identifier':
    'Het document noemt zijn afzender alleen bij naam — geen btw-nummer, geen KvK-nummer, geen Peppol-adres — dus het kan niet automatisch aan een leverancier worden gekoppeld.',
  'finding.inbound.no_tax_category':
    'Regel {lineNumber} zegt niets over zijn btw-categorie, dus er kon geen btw-code worden voorgesteld.',
  'finding.inbound.totals_disagree_with_lines':
    'Het document noemt zelf {declared} exclusief btw en zijn regels tellen op tot {fromLines}. Beide worden overgenomen zoals ze zijn; het verschil is meestal een toeslag of korting op documentniveau, en die wordt hier niet gelezen.',
  'finding.inbound.unmapped_tax_category':
    'Regel {lineNumber} is categorie {categoryCode} tegen {percent}%, en geen enkele inkoop-btw-code past daarbij. Codeer hem met de hand.',
  'finding.payment.duplicate_end_to_end_id':
    '{endToEndId} komt twee keer voor. Een bank kan dat als een dubbele betaling opvatten.',
  'finding.payment.empty_batch': 'Een betaalbatch zonder opdrachten betaalt niemand.',
  'finding.payment.invalid_amount': 'Een betaling van nul of minder is geen betaling.',
  'finding.payment.invalid_bic.creditor': '{creditorBic} is geen geldige BIC.',
  'finding.payment.invalid_bic.debtor': '{debtorBic} is geen geldige BIC.',
  'finding.payment.invalid_characters': 'SEPA accepteert {characters} niet.',
  'finding.payment.invalid_currency':
    'Een SEPA-overboeking gaat in euro. Gebruik een ander middel voor andere valuta.',
  'finding.payment.invalid_date': 'De uitvoerdatum is jjjj-mm-dd.',
  'finding.payment.invalid_iban.creditor': '{creditorIban} is geen geldig IBAN.',
  'finding.payment.invalid_iban.debtor': '{debtorIban} is geen geldig IBAN.',
  'finding.payment.missing_name.payee': 'Een begunstigde heeft een naam nodig.',
  'finding.payment.missing_name.payer': 'De betaler heeft een naam nodig.',
  'finding.paymentRun.credit_exceeds_invoices':
    'Bij {contactName} staat {net} meer gecrediteerd dan gefactureerd. Dat is een terugbetaling om te vragen, geen betaling om te sturen.',
  'finding.paymentRun.invalid_iban':
    'Het IBAN van {contactName} komt niet door zijn eigen controlegetal. Een verkeerd getypt IBAN laat de hele batch afkeuren.',
  'finding.paymentRun.mixed_currencies':
    '{contactName} heeft {count} open document(en) in een andere valuta dan de {currency} van deze batch. Een pain.001-batch draagt één valuta; zet die in een eigen run.',
  'finding.paymentRun.no_iban':
    'Aan {contactName} is {net} verschuldigd en er staat geen IBAN in het dossier. Vul dat aan bij Relaties.',
  'finding.paymentRun.nothing_owed':
    'De openstaande facturen en creditnota’s van {contactName} vallen precies tegen elkaar weg. Niets te betalen, en niets mis.',
  'finding.purchase.duplicate_invoice_number':
    'Deze leverancier heeft factuur {supplierInvoiceNumber} al gestuurd. Twee keer boeken is hoe een factuur twee keer betaald wordt.',
  'finding.purchase.lines_do_not_sum_to_net':
    'De regels tellen op tot {lineNet} en de factuur zegt {netMinorUnits}. Er ontbreekt een regel of er is er een verkeerd getypt — wat in het systeem staat is niet het document.',
  'finding.purchase.lines_do_not_sum_to_tax':
    'De btw op de regels telt op tot {lineTax} en de factuur zegt {taxMinorUnits}.',
  'finding.purchase.net_plus_tax_is_not_total':
    '{netMinorUnits} plus {taxMinorUnits} is niet {totalMinorUnits}. Leg de bedragen naast het document.',
  'finding.purchase.no_rule_in_force':
    'Btw-code {taxCode} heeft geen regel die geldt op {invoiceDate}.',
  'finding.purchase.unknown_tax_code.no_such_code': 'Btw-code {taxCode} bestaat niet.',
  'finding.purchase.not_deductible':
    '{taxCode} is niet aftrekbaar, dus de {taxMinorUnits} btw op regel {lineNumber} wordt onderdeel van de kosten in plaats van voorbelasting.',
  'finding.purchase.pro_rata':
    '{taxCode} is voor {share}% aftrekbaar, dus {deductible} van de btw op regel {lineNumber} gaat naar de voorbelasting en {deductible} naar de kosten.',
  'finding.purchase.rate_mismatch':
    'Regel {lineNumber} rekent {taxMinorUnits} waar {taxCode} tegen {rate}% over {netMinorUnits} op {expected} zou uitkomen. De factuur wordt geboekt zoals hij er staat; kijk of de code klopt.',
  'finding.purchase.reverse_charge_with_tax':
    'Regel {lineNumber} gebruikt {taxCode}, wat betekent dat wij de btw aangeven — maar de factuur rekent er {taxMinorUnits} van. Of de leverancier had geen btw mogen rekenen, of dit is de verkeerde code.',
  'finding.purchase.unknown_tax_code':
    'Btw-code {taxCode} is een verkoopcode. Een inkoopfactuur heeft een inkoopcode nodig — de btw erop is voor ons om af te trekken, niet om in rekening te brengen.',
  'finding.vat.code_declares_no_base':
    'Er staat een belaste grondslag geboekt onder een code waarvoor de aangifte geen grondslagrubriek kent en die ook geen btw aangeeft. Van die regels komt niets in de aangifte terecht.',
  'finding.vat.code_declares_no_vat':
    'Er staat btw geboekt onder een nultariefcode, die geen rubriek heeft om die in aan te geven. Of het tarief klopt niet, of de boeking niet.',
  'finding.vat.control_account_difference':
    'Rekening {accountNumber} {accountName} bewoog {taggedMovementMinorUnits} op regels met een btw-code, terwijl de aangifte {declaredMinorUnits} aangeeft (in centen). Het verschil is de btw die geen rubriek bereikte — de bevindingen hierboven noemen elke regel ervan.',
  'finding.vat.no_rule_in_force':
    'Er bestaat wel een btw-code, maar geen regel die geldt op de boekdatum, dus die regels kunnen aan geen rubriek worden toegewezen. Verleng de geldigheid van de code of boek de posten anders.',
  'finding.vat.rate_mismatch':
    'Rubriek {id} geeft btw aan die zijn eigen grondslag en tarief niet opleveren. Verwacht ongeveer {expected}, gevonden {vatMinorUnits} (in centen). Een handmatige correctie verklaart dit; een verkeerd gecodeerde regel ook.',
  'finding.vat.unknown_tax_code':
    'Journaalregels dragen een btw-code die met geen enkele ingestelde code overeenkomt, dus hun btw staat wel in de boeken maar niet in de aangifte.',
  'finding.vat.untagged_control_movement':
    'Een btw-tussenrekening bewoog zonder btw-code. Een betaling aan of teruggaaf van de Belastingdienst ziet er precies zo uit, en met de hand geboekte btw ook.',
} as const

export type MessageKey = keyof typeof nl
