// Prototype data. Field names follow the wire shapes Eng already ships:
//   findings: { code, path, messageKey, detail, severity, fix: { type }, honesty }
//     (docs/finding-card.md, PR #52)
//   FX: journal_lines.exchange_rate / exchange_rate_source,
//       import_decisions.exchangeRates[externalId] = { rate, source, date } (PR #55)
// Amounts are decimal strings in euros, never minor units.
;(function () {
  const entity = {
    name: 'Bakkerij De Vries B.V.',
    fiscalYear: '2026',
    fiscalYearRange: '1 jan – 31 dec',
    user: { name: 'Hidde de Vries', initials: 'HV', role: 'owner', roleLabel: 'Eigenaar' },
  }

  // `adv: true` items only show with Geavanceerd on (#44).
  const navigation = [
    { items: [{ id: 'dashboard', label: 'Dashboard', keys: 'g d', route: 'dashboard' }] },
    {
      label: 'Verkoop',
      items: [
        { id: 'invoices', label: 'Facturen', keys: 'g f', route: 'invoice' },
        { id: 'contacts', label: 'Klanten en leveranciers', keys: 'g r' },
        { id: 'dunning', label: 'Herinneringen', keys: 'g m' },
      ],
    },
    {
      label: 'Inkoop',
      items: [
        { id: 'inbox', label: 'Postvak', keys: 'g e', count: 3 },
        { id: 'purchases', label: 'Inkoopfacturen', keys: 'g n' },
      ],
    },
    {
      label: 'Geld',
      items: [
        { id: 'bank', label: 'Bank', keys: 'g k' },
        { id: 'match', label: 'Koppelen', keys: 'g o', route: 'bank', countKey: 'bank' },
        { id: 'payments', label: 'Betalingen', keys: 'g y' },
      ],
    },
    {
      label: 'Boekhouden',
      items: [
        { id: 'vat', label: 'Btw-aangifte', keys: 'g g' },
        { id: 'accounts', label: 'Categorieën', advLabel: 'Grootboek', keys: 'g a' },
        { id: 'entries', label: 'Journaalposten', keys: 'g j', adv: true },
      ],
    },
    {
      label: 'Rapporten',
      items: [
        { id: 'pnl', label: 'Winst en verlies', keys: 'g w' },
        { id: 'balance', label: 'Balans', keys: 'g b' },
        { id: 'debtors', label: 'Openstaand bij klanten', advLabel: 'Debiteuren', keys: 'g v' },
        { id: 'trial', label: 'Proefbalans', keys: 'g p', adv: true },
      ],
    },
    {
      label: 'Importeren',
      items: [
        { id: 'exact', label: 'Exact Online', keys: 'i x' },
        {
          id: 'moneybird',
          label: 'Moneybird',
          keys: 'i m',
          route: 'findings',
          countKey: 'findings',
        },
      ],
    },
    {
      label: 'Beheer',
      items: [
        { id: 'settings', label: 'Instellingen', keys: 'g i' },
        { id: 'members', label: 'Toegang', keys: 'g t' },
        { id: 'fiscalYears', label: 'Boekjaren', keys: 'g s' },
      ],
    },
  ]

  const dashboard = {
    attention: [
      {
        id: 'mb',
        tone: 'error',
        title: 'Moneybird-import: 3 punten houden de import tegen',
        sub: 'Los ze op en je kunt importeren. Meestal is het één keer kiezen.',
        route: 'findings',
        action: 'Nakijken',
      },
      {
        id: 'bank',
        tone: 'neutral',
        title: '7 bankregels wachten op koppelen',
        sub: 'Bij 5 weten we al waar ze bij horen.',
        route: 'bank',
        action: 'Koppelen',
      },
      {
        id: 'late',
        tone: 'attention',
        title: 'Hotel Zeezicht moet nog € 1.452,00 betalen',
        sub: 'Factuur 2026-0131 · 12 dagen over de vervaldatum',
        action: 'Herinnering sturen',
      },
      {
        id: 'inbox',
        tone: 'neutral',
        title: '3 bonnetjes in je postvak',
        sub: 'Makro, Shell en KPN. Wij hebben ze al gelezen.',
        action: 'Bekijken',
      },
      {
        id: 'vat',
        tone: 'info',
        title: 'Btw-aangifte Q3 staat klaar',
        sub: 'Uiterlijk 31 oktober indienen · € 3.918,00 te betalen',
        action: 'Bekijken',
      },
    ],
    figures: [
      { label: 'Op de bank', value: '18.240,55', sub: 'ING ··· 4821 · vandaag 07:12' },
      {
        label: 'Nog te ontvangen',
        value: '6.830,00',
        sub: '9 facturen, 2 te laat',
        tone: 'attention',
      },
      { label: 'Nog te betalen', value: '2.115,40', sub: '4 facturen, eerste op 22 okt' },
      { label: 'Winst dit jaar', value: '41.372,18', sub: '€ 3.120 meer dan vorig jaar' },
    ],
    months: [
      { m: 'mei', in: 22.4, out: 15.1 },
      { m: 'jun', in: 24.8, out: 16.0 },
      { m: 'jul', in: 27.9, out: 17.2 },
      { m: 'aug', in: 26.1, out: 18.4 },
      { m: 'sep', in: 23.5, out: 15.9 },
      { m: 'okt', in: 13.2, out: 8.6, partial: true },
    ],
  }

  // Moneybird dry-run findings. `detail` already holds display strings.
  const findings = [
    {
      id: 'f1',
      code: 'unmapped_account',
      path: 'ledger_accounts/389114002',
      messageKey: 'moneybird.unmapped_account',
      severity: 'blocking',
      title: 'Categorie ‘Kantoorartikelen’ heeft nog geen plek in Klopt',
      why: 'Zonder plek komen de 38 boekingen op deze categorie niet mee.',
      detail: { name: 'Kantoorartikelen', number: '4510', rgsCode: 'WBedKanKan', count: '38' },
      fix: {
        type: 'guided',
        label: 'Categorie kiezen',
        steps: ['Categorie', 'Btw'],
        sheet: 'account',
      },
    },
    {
      id: 'f2',
      code: 'unknown_currency',
      path: 'documents/purchase_invoices/389114027',
      messageKey: 'moneybird.unknown_currency.document',
      severity: 'blocking',
      title: 'Inkoopfactuur INV-20931 van Shipton Mill is in Britse ponden',
      why: 'Klopt boekt in euro. Kies de koers, dan zie je precies wat er geboekt wordt.',
      detail: { reference: 'INV-20931', currency: 'GBP', amount: '1.240,00', date: '2026-10-16' },
      fix: { type: 'guided', label: 'Koers kiezen', steps: ['Koers', 'Controleren'], sheet: 'fx' },
    },
    {
      id: 'f3',
      code: 'unmapped_tax_rate',
      path: 'tax_rates/389113870',
      messageKey: 'moneybird.unmapped_tax_rate',
      severity: 'blocking',
      title: 'Btw-tarief ‘Laag tarief’ uit Moneybird is nog niet gekoppeld',
      why: 'Zonder btw-tarief kan de aangifte deze 12 regels niet plaatsen.',
      detail: { name: 'Laag tarief', percentage: '9' },
      fix: {
        type: 'oneClick',
        label: 'Gebruik 9% btw',
        preview: {
          title: 'Dit verandert wat er geïmporteerd wordt',
          lines: [
            ['12 regels krijgen', '9% btw'],
            ['Btw over die regels', '€ 214,30'],
          ],
        },
      },
    },
    {
      id: 'f4',
      code: 'fiscal_year_start_unknown',
      path: 'administration',
      messageKey: 'moneybird.fiscal_year_start_unknown',
      severity: 'warning',
      title: 'Moneybird zegt niet in welke maand je boekjaar begint',
      why: 'Wij gaan uit van januari. Klopt dat, dan staat alles in de goede periode.',
      detail: { month: 'januari' },
      fix: { type: 'oneClick', label: 'Klopt, januari' },
    },
    {
      id: 'f5',
      code: 'draft_skipped',
      path: 'documents/sales_invoices',
      messageKey: 'moneybird.draft_skipped',
      severity: 'warning',
      title: '4 facturen staan in Moneybird nog op concept',
      why: 'Een concept is nog geen boeking. Rond ze af in Moneybird en lees opnieuw.',
      detail: { count: '4', state: 'concept' },
      fix: { type: 'explainOnly', linkLabel: 'Open in Moneybird', href: '#' },
    },
    {
      id: 'f6',
      code: 'period_locked',
      path: 'documents/receipts/389110551',
      messageKey: 'moneybird.period_locked',
      severity: 'warning',
      title: 'Bon MB-2025-0912 van 28 december 2025 komt niet mee',
      why: 'Dit jaar is afgesloten. Hij staat straks onder ‘Niet overgezet’.',
      detail: { reference: 'MB-2025-0912', year: '2025' },
      fix: { type: 'explainOnly', linkLabel: 'Naar Boekjaren', href: '#' },
    },
  ]

  const resolvedFindings = [
    {
      id: 'r1',
      code: 'contact_number_collision',
      title: 'Relatienummer 1042 kwam twee keer voor',
      result: 'Lunchroom Het Hoekje kreeg nummer 1043',
    },
  ]

  // Honesty: unread ≠ empty ≠ reconciled.
  const sources = [
    { label: 'Verkoopfacturen', count: '412 gelezen', honesty: 'reconciled' },
    { label: 'Inkoop en bonnen', count: '268 gelezen', honesty: 'reconciled' },
    { label: 'Boekingen 2024', count: '0 gelezen', honesty: 'empty' },
    { label: 'Bijlagen', count: 'HTTP 403', honesty: 'unread' },
  ]

  // Account picker: ranked by RGS code, then number, then name (#42).
  const accountOptions = [
    {
      number: '4400',
      name: 'Kantoorkosten',
      rgs: 'WBedKanCea',
      reason: 'Zelfde soort als in Moneybird',
      best: true,
    },
    { number: '4410', name: 'Telefoon en internet', rgs: 'WBedKanTef' },
    { number: '4420', name: 'Boekhouding en administratie', rgs: 'WBedKanBoe' },
    { number: '4900', name: 'Algemene kosten', rgs: 'WBedAlkOal' },
    { number: '4500', name: 'Reclame en advertenties', rgs: 'WBedVkkRea' },
  ]
  const vatOptions = [
    { code: 'VH21', label: '21% btw', note: 'Zo stond het in Moneybird' },
    { code: 'VL9', label: '9% btw' },
    { code: 'GEEN', label: 'Geen btw' },
  ]

  // ECB publishes GBP per EUR; Klopt stores EUR per 1 unit (PR #55).
  const fx = {
    externalId: '389114027',
    supplier: 'Shipton Mill Ltd',
    reference: 'INV-20931',
    documentDate: '2026-10-16',
    currency: 'GBP',
    amount: '1240.00',
    ecb: { date: '2026-10-16', perEur: '0.8672', rate: '1.1531' },
    overrideRate: '1.1490',
  }

  const customers = [
    {
      id: 'c1',
      name: 'Hotel Zeezicht B.V.',
      city: 'Vlissingen',
      terms: 14,
      vat: '9% btw',
      email: 'administratie@hotelzeezicht.nl',
    },
    { id: 'c2', name: 'Lunchroom Het Hoekje', city: 'Middelburg', terms: 14, vat: '9% btw' },
    { id: 'c3', name: 'Gemeente Middelburg', city: 'Middelburg', terms: 30, vat: '9% btw' },
    { id: 'c4', name: 'Catering Van Dalen', city: 'Goes', terms: 21, vat: '9% btw' },
  ]
  const invoiceLines = [
    {
      description: 'Desembroden, week 41',
      qty: '60',
      price: '4,20',
      vat: '9% btw',
      total: '252,00',
    },
    {
      description: 'Appeltaarten voor de zondagsbrunch',
      qty: '6',
      price: '32,50',
      vat: '9% btw',
      total: '195,00',
    },
  ]

  // Bank items: `direction` is af (money out) or bij (money in).
  const bankItems = [
    {
      id: 'b1',
      date: '16 okt',
      counterparty: 'Hotel Zeezicht B.V.',
      description: 'Factuur 2026-0131',
      direction: 'bij',
      amount: '1.452,00',
      suggestions: [
        {
          id: 's1',
          label: 'Factuur 2026-0131',
          who: 'Hotel Zeezicht B.V.',
          amount: '1.452,00',
          why: 'Zelfde bedrag en factuurnummer',
          confidence: 'Zeker',
        },
      ],
    },
    {
      id: 'b2',
      date: '16 okt',
      counterparty: 'Shipton Mill Ltd',
      description: 'INV-20931',
      direction: 'af',
      amount: '1.429,84',
      suggestions: [
        {
          id: 's2',
          label: 'Inkoopfactuur INV-20931',
          who: 'Shipton Mill Ltd',
          amount: '1.429,84',
          why: 'GBP 1.240,00 tegen ECB · 2026-10-16',
          confidence: 'Zeker',
        },
      ],
    },
    {
      id: 'b3',
      date: '15 okt',
      counterparty: 'Makro Middelburg',
      description: 'Pinbetaling 14:32',
      direction: 'af',
      amount: '186,42',
      suggestions: [],
      rule: {
        kind: 'Uitgave',
        category: 'Inkoop grondstoffen',
        vat: '9% btw',
        note: 'Zo boekte je Makro de vorige 6 keer',
      },
    },
    {
      id: 'b4',
      date: '15 okt',
      counterparty: 'KPN B.V.',
      description: 'Abonnement oktober',
      direction: 'af',
      amount: '54,45',
      suggestions: [
        {
          id: 's4',
          label: 'Inkoopfactuur KPN 3021-88',
          who: 'KPN B.V.',
          amount: '54,45',
          why: 'Zelfde bedrag, uit je postvak',
          confidence: 'Zeker',
        },
      ],
    },
    {
      id: 'b5',
      date: '14 okt',
      counterparty: 'Lunchroom Het Hoekje',
      description: 'Betaling facturen',
      direction: 'bij',
      amount: '386,10',
      suggestions: [
        {
          id: 's5',
          label: 'Factuur 2026-0128',
          who: 'Lunchroom Het Hoekje',
          amount: '386,10',
          why: 'Zelfde bedrag',
          confidence: 'Waarschijnlijk',
        },
        {
          id: 's6',
          label: 'Factuur 2026-0125',
          who: 'Lunchroom Het Hoekje',
          amount: '386,10',
          why: 'Zelfde bedrag, ouder',
          confidence: 'Mogelijk',
        },
      ],
    },
    {
      id: 'b6',
      date: '14 okt',
      counterparty: 'Belastingdienst',
      description: 'Btw 2e kwartaal 2026',
      direction: 'af',
      amount: '2.811,00',
      suggestions: [
        {
          id: 's7',
          label: 'Btw-aangifte Q2 2026',
          who: 'Belastingdienst',
          amount: '2.811,00',
          why: 'Zelfde bedrag en kenmerk',
          confidence: 'Zeker',
        },
      ],
    },
    {
      id: 'b7',
      date: '30 sep',
      counterparty: 'Mollie Payments',
      description: 'Uitbetaling webwinkel',
      direction: 'bij',
      amount: '612,40',
      suggestions: [],
      closed: 'Dit kwartaal is afgesloten',
    },
  ]

  const user = {
    advanced: false,
  }

  window.KLOPT = {
    entity,
    navigation,
    dashboard,
    findings,
    resolvedFindings,
    sources,
    accountOptions,
    vatOptions,
    fx,
    customers,
    invoiceLines,
    bankItems,
    user,
  }
})()
