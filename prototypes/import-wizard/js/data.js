// Mock data and copy for the import wizard (#100). Names follow the wire shapes
// Eng already ships (planMoneybirdImport problems with messageKey, importDecisions,
// runExactImportBody). Amounts are decimal strings in euros, dates are ISO here and
// shown as DD-MM-YYYY.
;(function () {
  const entity = {
    name: 'Bakkerij De Vries B.V.',
    fiscalYear: '2026',
    fiscalYearRange: '1 jan – 31 dec',
    user: { name: 'Hidde de Vries', initials: 'HV', roleLabel: 'Eigenaar' },
  }

  const navigation = [
    { items: [{ id: 'dashboard', label: 'Dashboard', keys: 'g d' }] },
    {
      label: 'Verkoop',
      items: [
        { id: 'invoices', label: 'Facturen', keys: 'g f' },
        { id: 'contacts', label: 'Klanten en leveranciers', keys: 'g r' },
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
        { id: 'match', label: 'Koppelen', keys: 'g o' },
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
      ],
    },
    {
      label: 'Importeren',
      items: [
        { id: 'exact', label: 'Exact Online', keys: 'i x', source: 'exact' },
        { id: 'moneybird', label: 'Moneybird', keys: 'i m', source: 'moneybird' },
      ],
    },
    {
      label: 'Beheer',
      items: [
        { id: 'settings', label: 'Instellingen', keys: 'g i' },
        { id: 'fiscalYears', label: 'Boekjaren', keys: 'g s' },
      ],
    },
  ]

  // The ten wizard steps. `short` is the rail label.
  const steps = [
    { id: 'bron', short: 'Bron' },
    { id: 'verbinden', short: 'Verbinden' },
    { id: 'administratie', short: 'Administratie en jaren' },
    { id: 'voorbeeld', short: 'Voorbeeld' },
    { id: 'btw', short: 'Btw-codes' },
    { id: 'rekeningen', short: 'Rekeningen en relaties' },
    { id: 'problemen', short: 'Problemen' },
    { id: 'overzicht', short: 'Overzicht' },
    { id: 'importeren', short: 'Importeren' },
    { id: 'klaar', short: 'Klaar' },
  ]

  const sources = {
    moneybird: {
      label: 'Moneybird',
      scope: 'Alle facturen, bonnetjes, bankmutaties en memoriaalposten.',
      notIncluded: 'Concepten en offertes komen niet mee.',
      openUrl: 'https://moneybird.com',
    },
    exact: {
      label: 'Exact Online',
      scope: 'Rekeningschema, relaties en openstaande posten van één boekjaar, als beginbalans.',
      notIncluded:
        'Losse boekingen komen niet mee. Documenten zet je daarna apart over, als je dat wilt.',
      setupLine: 'Wie Klopt beheert, stelt eerst een Exact-koppeling in.',
    },
  }

  const resume = {
    source: 'moneybird',
    step: 5,
    savedAt: '2026-10-24T16:12',
    detail: 'Nog 3 btw-tarieven te kiezen',
  }

  // ------------------------------------------------------------- Moneybird

  const administrations = [
    { id: 'a1', name: 'Bakkerij De Vries B.V.', currency: 'EUR', yearStart: 'januari', docs: 583 },
    { id: 'a2', name: 'De Vries Vastgoed B.V.', currency: 'EUR', yearStart: 'januari', docs: 64 },
  ]

  // Years found in Moneybird vs Klopt's fiscal years (setup.listFiscalYears).
  const years = [
    { year: '2024', docs: 41, klopt: 'closed', note: 'Dit jaar is afgesloten.' },
    {
      year: '2025',
      docs: 318,
      klopt: 'open',
      warn: '1 document valt vóór de startdatum van een btw-code in Klopt. Je ziet het bij Problemen.',
    },
    { year: '2026', docs: 224, klopt: 'open', note: 't/m 26-10-2026' },
  ]

  // Counts per kind, per selected year (preview).
  const kinds = [
    { id: 'sales', label: 'Verkoopfacturen', y2025: 96, y2026: 71 },
    { id: 'purchases', label: 'Inkoopfacturen', y2025: 58, y2026: 44 },
    { id: 'receipts', label: 'Bonnetjes', y2025: 61, y2026: 39 },
    { id: 'bank', label: 'Bankmutaties', y2025: 92, y2026: 63 },
    { id: 'journals', label: 'Memoriaalposten', y2025: 11, y2026: 7 },
  ]

  // Per Moneybird tax rate. `state`:
  //   confirmed  you chose it (or confirmed the previous choice)
  //   suggested  exactly one primary fits; preselected, still needs your confirm
  //   choose     several fit, or the null-% assumption; nothing preselected
  //   rc         mapped to a reverse-charge / EU code (#95): imports, filing blocked
  //   none       no Klopt code fits (#92/#93)
  const rates = [
    {
      id: 'r1',
      name: '21% btw',
      pct: '21%',
      side: 'verkoop',
      docs: 131,
      state: 'confirmed',
      code: 'H21',
      label: '21% btw',
      rubriek: '1a',
      ledger: '1510 Af te dragen btw hoog',
      prev: true,
    },
    {
      id: 'r2',
      name: '9% btw',
      pct: '9%',
      side: 'verkoop',
      docs: 58,
      state: 'confirmed',
      code: 'L9',
      label: '9% btw',
      rubriek: '1b',
      ledger: '1511 Af te dragen btw laag',
      prev: true,
    },
    {
      id: 'r3',
      name: '21% btw',
      pct: '21%',
      side: 'inkoop',
      docs: 112,
      state: 'confirmed',
      code: 'VH21',
      label: '21% btw',
      rubriek: '5b',
      ledger: '1520 Voorbelasting',
    },
    {
      id: 'r4',
      name: '9% btw',
      pct: '9%',
      side: 'inkoop',
      docs: 64,
      state: 'suggested',
      code: 'VL9',
      label: '9% btw',
      rubriek: '5b',
      ledger: '1520 Voorbelasting',
    },
    {
      id: 'r5',
      name: 'Geen btw',
      pct: null,
      side: 'inkoop',
      docs: 23,
      state: 'choose',
      assumption:
        'Moneybird gaf geen percentage mee voor ‘Geen btw’. We gaan uit van 0%; controleer dit.',
      candidates: [{ code: 'VGEEN', label: 'Inkoop zonder btw', rubriek: '—', ledger: '—' }],
    },
    {
      id: 'r6',
      name: 'EU-inkoop 21% (verlegd)',
      pct: '0%',
      side: 'inkoop',
      docs: 9,
      state: 'rc',
      code: 'ICV21',
      label: '21% btw over inkoop uit de EU',
      rubriek: '4b en 5b',
      ledger: '1512 Af te dragen btw verlegd · 1520 Voorbelasting',
    },
    {
      id: 'r7',
      name: 'Geen btw (buiten EU)',
      pct: '0%',
      side: 'inkoop',
      docs: 12,
      state: 'none',
      years: '7 in 2025, 5 in 2026',
    },
  ]

  const accounts = [
    {
      mb: 'Omzet brood en banket',
      mbNo: '8000',
      klopt: 'Omzet laag tarief',
      kloptNo: '8010',
      kind: 'Opbrengst',
      dc: 'Credit',
      state: 'prev',
    },
    {
      mb: 'Omzet catering',
      mbNo: '8100',
      klopt: 'Omzet hoog tarief',
      kloptNo: '8000',
      kind: 'Opbrengst',
      dc: 'Credit',
      state: 'prev',
    },
    {
      mb: 'Inkoop grondstoffen',
      mbNo: '7000',
      klopt: 'Inkoopwaarde van de omzet',
      kloptNo: '7000',
      kind: 'Kosten',
      dc: 'Debet',
      state: 'ok',
    },
    {
      mb: 'Huur bedrijfspand',
      mbNo: '4100',
      klopt: 'Huur',
      kloptNo: '4100',
      kind: 'Kosten',
      dc: 'Debet',
      state: 'ok',
    },
    {
      mb: 'Energie',
      mbNo: '4200',
      klopt: 'Gas, water en licht',
      kloptNo: '4210',
      kind: 'Kosten',
      dc: 'Debet',
      state: 'suggest',
    },
    {
      mb: 'Bestelbus',
      mbNo: '4500',
      klopt: 'Autokosten',
      kloptNo: '4500',
      kind: 'Kosten',
      dc: 'Debet',
      state: 'derived',
    },
    {
      mb: 'Rabobank zakelijk',
      mbNo: '1100',
      klopt: 'Bank',
      kloptNo: '1100',
      kind: 'Balans',
      dc: 'Debet',
      state: 'ok',
    },
    {
      mb: 'Privéopnamen',
      mbNo: '0610',
      klopt: null,
      kloptNo: null,
      kind: 'Balans',
      dc: 'Debet',
      state: 'new',
    },
  ]

  // Problems left after steps 5 and 6 (step 7), blocking first.
  const problems = [
    {
      id: 'p-nif',
      code: 'tax_code_not_in_force',
      severity: 'blocking',
      issue: '#99',
      title: 'Btw-code geldt nog niet op de factuurdatum',
      body: 'Inkoopfactuur 2025-0412 van Backtechnik Müller GmbH is gedateerd op 14-05-2025, maar die btw-code geldt in Klopt nog niet op die datum. Er is hier nog geen oplossing. Controleer de datum en het tarief in Moneybird.',
      secondary: 'Btw-code ICV21 · geldt in Klopt vanaf 01-07-2025',
      why: 'Zonder geldige code op de boekdatum kan de aangifte die regels niet plaatsen. De begindatum kun je in Klopt nog niet wijzigen.',
      fix: 'reread',
    },
    {
      id: 'p-untagged',
      code: 'moneybird_untagged_vat',
      severity: 'blocking',
      issue: '#96',
      title: 'Btw zonder btw-tarief',
      body: 'Op bonnetje 2026-0088 van Makro Amsterdam staat € 14,70 btw, maar de regels hebben geen btw-tarief dat die btw draagt. Klopt kan die btw dan nergens in de aangifte zetten.',
      secondary: 'Bonnetje 2026-0088 · 03-03-2026 · € 84,70',
      why: 'Btw zonder tarief telt niet mee in rubriek 1a of 5b. Die periode zou je dan niet via Klopt kunnen indienen.',
      next: 'Pas het tarief op het bonnetje aan in Moneybird en lees opnieuw. Weet je niet welk tarief het moet zijn? Vraag het je accountant.',
      fix: 'mbReread',
    },
    {
      id: 'p-fx',
      code: 'unknown_currency_document',
      severity: 'blocking',
      title: 'Factuur in Britse ponden',
      body: 'Inkoopfactuur INV-20931 van Shipton Mill Ltd is in GBP en deze boeken zijn in EUR. Kies een koers voordat je hem importeert.',
      secondary: '£ 1.240,00 · 16-10-2025',
      why: 'Zonder gekozen koers zou dit document stilzwijgend worden omgerekend. Dat verandert de boeken.',
      fix: 'fx',
    },
    {
      id: 'p-unbal',
      code: 'unbalanced_document',
      severity: 'blocking',
      title: 'Memoriaalpost sluit niet',
      body: 'Memoriaalpost 2025-M011 heeft € 1.250,00 bij en € 1.205,00 af. Het verschil is € 45,00.',
      secondary: 'Memoriaalpost 2025-M011 · 31-12-2025',
      why: 'Een document dat niet sluit mag niet stilzwijgend worden geboekt.',
      fix: 'exclude',
    },
    {
      id: 'p-rc',
      code: 'self_assessed_vat_unsupported',
      severity: 'warning',
      issue: '#95',
      title: '9 EU-inkopen: indienen via Klopt kan nog niet',
      body: 'Deze 9 inkopen worden wel geïmporteerd. Klopt boekt de zelf af te dragen btw nog niet, dus de btw-aangifte voor Q2 en Q3 2025 kun je niet via Klopt indienen.',
      secondary: 'Gekoppeld aan ICV21 · zelf af te dragen btw (2a/4a/4b en 5b)',
      why: 'Zonder de zelf af te dragen btw ontbreken rubriek 2a/4a/4b en 5b; indienen via Klopt zou te weinig btw aangeven.',
      next: 'Dien die aangiftes zelf of met een belastingadviseur in, op basis van gecorrigeerde cijfers. Wacht niet op Klopt als je aangiftetermijn eerder afloopt.',
      fix: 'explain',
    },
    {
      id: 'p-att',
      code: 'attachment_without_url',
      severity: 'warning',
      title: '3 bonnetjes zonder bestand',
      body: 'Moneybird gaf bij 3 bonnetjes geen bestand mee. De boekingen komen wel over.',
      secondary: 'Bonnetjes 2025-0301, 2025-0302 en 2026-0114',
      why: 'Zonder bestand is er niets om te bewaren bij de boeking.',
      fix: 'defer',
    },
  ]

  // ------------------------------------------------------------------ Exact

  const divisions = [
    { id: 'd1', name: 'Bakkerij De Vries B.V.', number: '1048213', currency: 'EUR' },
    { id: 'd2', name: 'De Vries Vastgoed B.V.', number: '1048214', currency: 'EUR' },
  ]

  const exactYears = [
    { year: '2025', note: 'Afgesloten in Exact' },
    { year: '2026', note: 'Lopend boekjaar' },
  ]

  const exactCounts = [
    { label: 'Rekeningen', value: 312, sub: '298 bekend, 14 nieuw' },
    { label: 'Relaties', value: 186, sub: '112 klanten, 74 leveranciers' },
    {
      label: 'Openstaande posten',
      value: 47,
      sub: '€ 38.412,50 te ontvangen · € 21.906,15 te betalen',
    },
  ]

  // Read-only list (PRD default for open question 2).
  const exactVat = [
    { code: '1', name: 'BTW hoog verkoop 21%', klopt: 'H21', label: '21% btw', accounts: 0 },
    { code: '2', name: 'BTW laag verkoop 9%', klopt: 'L9', label: '9% btw', accounts: 0 },
    { code: '4', name: 'BTW hoog inkoop 21%', klopt: 'VH21', label: '21% btw', accounts: 0 },
    { code: '5', name: 'BTW laag inkoop 9%', klopt: 'VL9', label: '9% btw', accounts: 0 },
    { code: '0', name: 'Geen BTW', klopt: 'VGEEN', label: 'Inkoop zonder btw', accounts: 0 },
    {
      code: '7',
      name: 'Verlegd inkoop EU',
      klopt: null,
      label: null,
      accounts: 3,
      lose: '4400 Inkoop EU, 4410 Vrachtkosten EU, 4420 Verpakking EU',
    },
    {
      code: '12',
      name: 'Verkoop 0% buiten EU',
      klopt: null,
      label: null,
      accounts: 1,
      lose: '8300 Omzet export',
    },
  ]

  const exactTakeover = [
    {
      id: 'receivable',
      label: 'Debiteuren',
      help: 'Waar je openstaande verkoopfacturen op staan.',
      value: '1300 Debiteuren',
      plain: 'Te ontvangen van klanten',
    },
    {
      id: 'payable',
      label: 'Crediteuren',
      help: 'Waar je openstaande inkoopfacturen op staan.',
      value: '1600 Crediteuren',
      plain: 'Te betalen aan leveranciers',
    },
    {
      id: 'opening',
      label: 'Tegenrekening beginbalans',
      help: 'Vangt het verschil op, zodat de beginbalans sluit.',
      value: null,
      plain: null,
    },
    {
      id: 'journal',
      label: 'Dagboek',
      help: 'Waarin we de beginbalans boeken.',
      value: 'MEM Memoriaal',
      plain: 'Memoriaal',
    },
  ]

  window.KLOPT = {
    entity,
    navigation,
    steps,
    sources,
    resume,
    administrations,
    years,
    kinds,
    rates,
    accounts,
    problems,
    divisions,
    exactYears,
    exactCounts,
    exactVat,
    exactTakeover,
  }
})()
