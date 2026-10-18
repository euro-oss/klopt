/* global KLOPT, icon */
;(function () {
  'use strict'

  const D = KLOPT
  const root = document.getElementById('app')
  const overlayRoot = document.getElementById('overlay')
  const toastRoot = document.getElementById('toast')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion.matches ? 0 : ms))

  // ---------------------------------------------------------------- state

  const S = {
    route: 'dashboard',
    params: new URLSearchParams(),
    advanced: D.user.advanced,
    overlay: null, // 'nav' | 'palette' | 'user' | 'help' | 'fix' | 'bank' | 'confirm'
    lastOverlayKey: null,
    returnFocus: null,
    dashIdx: 0,
    findings: D.findings.slice(),
    resolved: D.resolvedFindings.slice(),
    findingIdx: 0,
    fixId: null,
    explainOpen: null,
    previewOpen: null,
    picker: { query: '', active: 0, chosen: 0, vat: 'VH21' },
    fx: { rate: D.fx.ecb.rate, source: 'ecb' },
    invoice: { step: 1, customer: 'c1', customerActive: 0, query: '', send: 'email', done: false },
    bank: { items: D.bankItems.slice(), idx: 0, cand: 0, pane: 'queue', matched: [] },
    palette: { query: '', active: 0 },
  }

  // ------------------------------------------------------------- helpers

  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl'

  function keycaps(keys, extra) {
    if (!keys) return ''
    const labels = { enter: '↵', escape: 'Esc', up: '↑', down: '↓', mod: mod }
    return (
      '<span class="hidden items-center gap-0.5 md:inline-flex ' +
      (extra || '') +
      '">' +
      keys
        .split(' ')
        .map((k) => '<kbd class="keycap">' + (labels[k] || k) + '</kbd>')
        .join('') +
      '</span>'
    )
  }

  function parseRate(input) {
    const n = Number(String(input).trim().replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const nlNumber = (n, digits) =>
    n.toLocaleString('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const euro = (n) => '€ ' + nlNumber(n, 2)

  function anim(key, cls) {
    return S.lastOverlayKey === key ? '' : cls
  }

  function toast(message, tone) {
    const t = tone || 'success'
    toastRoot.innerHTML =
      '<div role="status" class="animate-in-up fixed inset-x-4 bottom-4 z-[60] flex items-center gap-3 border bg-background p-3 text-sm md:inset-x-auto md:right-6 md:bottom-6 md:min-w-80">' +
      '<span class="flex size-6 items-center justify-center ' +
      (t === 'success' ? 'text-success' : 'text-muted-foreground') +
      '">' +
      (t === 'success'
        ? '<svg viewBox="0 0 24 24" class="check-draw size-5" fill="none" stroke="currentColor" stroke-width="2.25"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
        : icon('info')) +
      '</span><span>' +
      message +
      '</span></div>'
    clearTimeout(toast.timer)
    if (!S.params.has('toast')) toast.timer = setTimeout(() => (toastRoot.innerHTML = ''), 3600)
  }

  // ------------------------------------------------------------- routing

  const ROUTES = {
    dashboard: { title: 'Dashboard', crumb: [] },
    findings: { title: 'Moneybird', crumb: ['Importeren'] },
    invoice: { title: 'Nieuwe factuur', crumb: ['Verkoop', 'Facturen'] },
    bank: { title: 'Koppelen', crumb: ['Geld'] },
  }

  function readHash() {
    const raw = location.hash.replace(/^#\/?/, '')
    const [path, query] = raw.split('?')
    S.route = ROUTES[path] ? path : 'dashboard'
    S.params = new URLSearchParams(query || '')
    applyParams()
  }

  // Query params put a screen into a given state, for review links and screenshots.
  function applyParams() {
    const p = S.params
    const theme = p.get('theme') || localStorage.getItem('klopt-proto-theme') || 'light'
    document.documentElement.classList.toggle('dark', theme === 'dark')
    if (p.has('advanced')) S.advanced = p.get('advanced') === '1'
    S.overlay = null
    if (p.get('menu') === '1') S.overlay = 'nav'
    if (p.get('palette') === '1') {
      S.overlay = 'palette'
      S.palette.query = p.get('q') || ''
    }
    if (p.get('usermenu') === '1') S.overlay = 'user'
    if (p.get('help') === '1') S.overlay = 'help'

    if (S.route === 'findings') {
      if (p.get('state') === 'done') {
        S.resolved = D.resolvedFindings.concat(
          D.findings.map((f) => ({ id: f.id, code: f.code, title: f.title, result: resultFor(f) })),
        )
        S.findings = []
      }
      const fix = p.get('fix')
      if (fix) {
        S.findingIdx = Math.max(
          0,
          S.findings.findIndex((f) => f.id === fix),
        )
        S.fixId = fix
        S.overlay = 'fix'
      }
      if (p.get('fxo') === '1') S.fx = { rate: D.fx.overrideRate, source: 'override' }
      if (p.get('preview')) {
        S.previewOpen = p.get('preview')
        S.findingIdx = Math.max(
          0,
          S.findings.findIndex((f) => f.id === S.previewOpen),
        )
      }
    }
    if (S.route === 'invoice') {
      S.invoice.step = Number(p.get('step') || 1)
      if (p.has('q')) S.invoice.query = p.get('q')
      S.invoice.done = p.get('done') === '1'
      if (p.get('confirm') === '1') S.overlay = 'confirm'
    }
    if (S.route === 'bank') {
      const row = p.get('row')
      if (row)
        S.bank.idx = Math.max(
          0,
          S.bank.items.findIndex((b) => b.id === row),
        )
      if (p.get('panel') === '1') {
        S.bank.pane = 'panel'
        if (window.innerWidth < 1024) S.overlay = 'bank'
      }
      if (p.get('matched') === '1') {
        const done = S.bank.items.splice(0, 2)
        S.bank.matched = done.map((b) => ({ ...b, result: b.suggestions[0].label }))
      }
    }
  }

  function go(route) {
    location.hash = '#/' + route
  }

  // ---------------------------------------------------------------- shell

  function brand() {
    return (
      '<div class="flex h-12 items-center gap-2 px-4">' +
      '<span class="flex size-6 items-center justify-center bg-accent text-[13px] font-bold text-accent-foreground">K</span>' +
      '<span class="text-[15px] font-semibold tracking-tight">Klopt</span></div>'
    )
  }

  function entitySwitcher() {
    return (
      '<button type="button" data-action="todo" class="mx-2 mb-2 flex min-h-11 items-center gap-2 border border-sidebar-border bg-background px-3 py-1.5 text-left md:min-h-0">' +
      '<span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">' +
      D.entity.name +
      '</span><span class="block text-xs text-muted-foreground tabular">Boekjaar ' +
      D.entity.fiscalYear +
      ' · ' +
      D.entity.fiscalYearRange +
      '</span></span>' +
      icon('chevronDown', 'size-4 text-muted-foreground') +
      '</button>'
    )
  }

  function navCount(item) {
    if (item.countKey === 'findings') {
      const n = S.findings.length
      if (!n) return ''
      const blocking = S.findings.some((f) => f.severity === 'blocking')
      return (
        '<span data-count="findings" class="inline-flex h-5 min-w-5 items-center justify-center px-1 text-[11px] font-medium tabular ' +
        (blocking
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-muted text-muted-foreground') +
        '">' +
        n +
        '</span>'
      )
    }
    const n = item.countKey === 'bank' ? S.bank.items.length : item.count
    if (!n) return ''
    return (
      '<span data-count="' +
      (item.countKey || '') +
      '" class="inline-flex h-5 min-w-5 items-center justify-center border border-sidebar-border bg-background px-1 text-[11px] font-medium tabular">' +
      n +
      '</span>'
    )
  }

  function navList(mobile) {
    return D.navigation
      .map((group) => {
        const items = group.items.filter((i) => !i.adv || S.advanced)
        if (!items.length) return ''
        return (
          '<div class="' +
          (group.label ? (mobile ? 'mt-3' : 'mt-2') : 'mt-0.5') +
          '">' +
          (group.label
            ? '<p class="px-3 pb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">' +
              group.label +
              '</p>'
            : '') +
          '<ul role="list">' +
          items
            .map((item) => {
              const current =
                item.route === S.route && (item.route !== 'bank' || item.id === 'match')
              const label = S.advanced && item.advLabel ? item.advLabel : item.label
              return (
                '<li><a href="' +
                (item.route ? '#/' + item.route : '#') +
                '" ' +
                (item.route ? '' : 'data-action="todo" ') +
                (current ? 'aria-current="page" ' : '') +
                'class="flex items-center gap-2 border-l-[3px] px-3 text-sm ' +
                (mobile ? 'min-h-11 ' : 'h-7 ') +
                (current
                  ? 'border-accent bg-background font-medium'
                  : 'border-transparent text-sidebar-foreground/85 hover:bg-background/70') +
                '"><span class="min-w-0 flex-1 truncate">' +
                label +
                '</span>' +
                navCount(item) +
                (mobile ? '' : keycaps(item.keys)) +
                '</a></li>'
              )
            })
            .join('') +
          '</ul></div>'
        )
      })
      .join('')
  }

  function userButton() {
    return (
      '<div class="border-t border-sidebar-border p-2"><button type="button" data-action="user-menu" aria-haspopup="menu" aria-expanded="' +
      (S.overlay === 'user') +
      '" class="flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-background/70 md:min-h-0 ' +
      (S.overlay === 'user' ? 'bg-background' : '') +
      '">' +
      '<span class="flex size-7 items-center justify-center bg-foreground text-xs font-semibold text-background">' +
      D.entity.user.initials +
      '</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">' +
      D.entity.user.name +
      '</span><span class="block text-xs text-muted-foreground">' +
      D.entity.user.roleLabel +
      ' · Geavanceerd ' +
      (S.advanced ? 'aan' : 'uit') +
      '</span></span>' +
      icon('chevronDown', 'size-4 text-muted-foreground -rotate-90') +
      '</button></div>'
    )
  }

  function themeButton() {
    const dark = document.documentElement.classList.contains('dark')
    return (
      '<button type="button" data-action="theme" class="btn btn-ghost btn-icon" aria-label="' +
      (dark ? 'Licht thema' : 'Donker thema') +
      '" title="' +
      (dark ? 'Licht thema' : 'Donker thema') +
      '">' +
      icon(dark ? 'sun' : 'moon', 'size-[18px]') +
      '</button>'
    )
  }

  function topbar() {
    const r = ROUTES[S.route]
    return (
      // Mobile: thin bar, menu button, title, search, theme. No bottom tab bar.
      '<header class="sticky top-0 z-30 flex h-12 items-center gap-1 border-b bg-background px-1 md:hidden">' +
      '<button type="button" data-action="nav" class="btn btn-ghost btn-icon" aria-label="Menu openen" aria-expanded="' +
      (S.overlay === 'nav') +
      '">' +
      icon('menu', 'size-5') +
      '</button>' +
      '<span class="min-w-0 flex-1 truncate text-[15px] font-medium">' +
      r.title +
      '</span>' +
      '<button type="button" data-action="palette" class="btn btn-ghost btn-icon" aria-label="Zoeken">' +
      icon('search', 'size-[18px]') +
      '</button>' +
      themeButton() +
      '</header>' +
      // Desktop
      '<header class="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b bg-background px-8 md:flex">' +
      '<nav aria-label="Kruimelpad" class="flex min-w-0 flex-1 items-center gap-1.5 text-sm">' +
      r.crumb
        .map(
          (c) =>
            '<span class="text-muted-foreground">' +
            c +
            '</span>' +
            icon('chevronRight', 'size-3.5 text-muted-foreground'),
        )
        .join('') +
      '<span class="font-medium">' +
      r.title +
      '</span></nav>' +
      '<button type="button" data-action="palette" class="flex h-9 w-72 items-center gap-2 border border-input px-3 text-sm text-muted-foreground hover:bg-muted">' +
      icon('search', 'size-4') +
      '<span class="flex-1 text-left">Zoeken of opdracht</span>' +
      keycaps('mod K') +
      '</button>' +
      themeButton() +
      '</header>'
    )
  }

  function renderShell() {
    root.innerHTML =
      '<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-background focus:p-2">Naar de inhoud</a>' +
      '<div class="flex min-h-dvh">' +
      '<div class="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block">' +
      '<aside aria-label="Navigatie" class="sticky top-0 flex h-dvh flex-col text-sidebar-foreground">' +
      brand() +
      entitySwitcher() +
      '<nav aria-label="Hoofdmenu" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">' +
      navList(false) +
      '</nav>' +
      userButton() +
      '</aside></div>' +
      '<div class="flex min-w-0 flex-1 flex-col">' +
      topbar() +
      '<main id="main" tabindex="-1" class="flex-1 outline-none"></main>' +
      '</div></div>'
    renderMain()
  }

  function refreshChrome() {
    document.querySelectorAll('[data-count="findings"]').forEach((el) => {
      el.textContent = S.findings.length
      el.classList.remove('count-bump')
      void el.offsetWidth
      el.classList.add('count-bump')
      if (!S.findings.some((f) => f.severity === 'blocking')) {
        el.classList.remove('bg-destructive', 'text-destructive-foreground')
        el.classList.add('bg-muted', 'text-muted-foreground')
      }
      if (!S.findings.length) el.remove()
    })
    document.querySelectorAll('[data-count="bank"]').forEach((el) => {
      el.textContent = S.bank.items.length
      el.classList.remove('count-bump')
      void el.offsetWidth
      el.classList.add('count-bump')
    })
  }

  function renderMain() {
    const main = document.getElementById('main')
    if (!main) return
    const screens = {
      dashboard: dashboardScreen,
      findings: findingsScreen,
      invoice: invoiceScreen,
      bank: bankScreen,
    }
    main.innerHTML = screens[S.route]()
    if (S.route === 'findings') bindFx()
  }

  function pageHeader(opts) {
    return (
      '<div class="mb-6 flex flex-wrap items-end justify-between gap-4">' +
      '<div class="min-w-0">' +
      (opts.eyebrow
        ? '<p class="mb-1 text-sm text-muted-foreground">' + opts.eyebrow + '</p>'
        : '') +
      '<h1 class="text-2xl tracking-tight md:text-[28px]">' +
      opts.title +
      '</h1>' +
      (opts.sub ? '<p class="mt-1 text-sm text-muted-foreground">' + opts.sub + '</p>' : '') +
      '</div>' +
      (opts.actions ? '<div class="flex flex-wrap gap-2">' + opts.actions + '</div>' : '') +
      '</div>'
    )
  }

  function keyStrip(items) {
    return (
      '<div class="key-strip mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-muted-foreground md:flex">' +
      items
        .map(
          ([k, label]) =>
            '<span class="inline-flex items-center gap-1.5">' + keycaps(k) + label + '</span>',
        )
        .join('') +
      '</div>'
    )
  }

  // ------------------------------------------------------------ dashboard

  const toneIcon = {
    error: ['alert', 'text-destructive'],
    attention: ['calendar', 'text-warning'],
    info: ['info', 'text-info'],
    neutral: ['circle', 'text-muted-foreground'],
  }

  function dashboardScreen() {
    const d = D.dashboard
    const max = Math.max(...d.months.map((m) => m.in))
    return (
      '<div class="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">' +
      pageHeader({
        title: 'Goedemorgen, Hidde',
        sub: 'Zondag 18 oktober · ' + D.entity.name,
        actions:
          '<a href="#/invoice" class="btn btn-primary">' +
          icon('plus') +
          'Nieuwe factuur' +
          keycaps(
            'n f',
            'ml-1 [&_.keycap]:border-primary-foreground/30 [&_.keycap]:bg-transparent [&_.keycap]:text-primary-foreground/80',
          ) +
          '</a>' +
          '<button type="button" data-action="todo" class="btn btn-outline">' +
          icon('upload') +
          'Bonnetje toevoegen</button>',
      }) +
      // Key figures: tiles split by hairlines, no cards-with-shadows.
      '<section aria-label="Kerncijfers" class="grid grid-cols-2 gap-px border bg-border lg:grid-cols-4">' +
      d.figures
        .map(
          (f) =>
            '<div class="bg-background p-4 md:p-5"><p class="text-xs text-muted-foreground md:text-sm">' +
            f.label +
            '</p><p class="mt-1 text-xl font-semibold tracking-tight tabular md:text-[26px]">€ ' +
            f.value +
            '</p><p class="mt-1 text-xs ' +
            (f.tone === 'attention' ? 'text-warning' : 'text-muted-foreground') +
            '">' +
            f.sub +
            '</p></div>',
        )
        .join('') +
      '</section>' +
      '<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">' +
      // Werklijst
      '<section aria-labelledby="att-h">' +
      '<div class="mb-2 flex items-baseline justify-between"><h2 id="att-h" class="text-base">Wat aandacht vraagt</h2><span class="text-sm text-muted-foreground tabular">' +
      d.attention.length +
      ' punten</span></div>' +
      '<ul role="list" class="divide-y border" data-list="dash">' +
      d.attention
        .map((a, i) => {
          const [ic, color] = toneIcon[a.tone]
          return (
            '<li><a href="' +
            (a.route ? '#/' + a.route : '#') +
            '" ' +
            (a.route ? '' : 'data-action="todo" ') +
            'data-fid="dash-' +
            i +
            '" tabindex="' +
            (i === S.dashIdx ? 0 : -1) +
            '" class="group flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted focus-visible:-outline-offset-2 ' +
            (a.tone === 'error'
              ? 'border-l-[3px] border-l-destructive'
              : 'border-l-[3px] border-l-transparent') +
            '"><span class="' +
            color +
            '">' +
            icon(ic, 'size-[18px]') +
            '</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium">' +
            a.title +
            '</span><span class="block text-sm text-muted-foreground">' +
            a.sub +
            '</span></span><span class="hidden text-sm text-muted-foreground group-hover:text-foreground sm:inline">' +
            a.action +
            '</span>' +
            icon('chevronRight', 'size-4 text-muted-foreground') +
            '</a></li>'
          )
        })
        .join('') +
      '</ul>' +
      keyStrip([
        ['j k', 'Volgende, vorige'],
        ['enter', 'Openen'],
        ['escape', 'Lijst verlaten'],
      ]) +
      '</section>' +
      // Right column
      '<div class="space-y-6">' +
      '<section aria-labelledby="ch-h" class="border p-4"><div class="flex items-baseline justify-between"><h2 id="ch-h" class="text-base">Inkomsten en uitgaven</h2><span class="text-xs text-muted-foreground">x € 1.000</span></div>' +
      '<div class="mt-4 flex h-32 items-end gap-3" role="img" aria-label="Inkomsten en uitgaven per maand, mei tot en met oktober">' +
      d.months
        .map(
          (m) =>
            '<div class="flex h-full flex-1 flex-col justify-end gap-1"><div class="flex flex-1 items-end gap-0.5">' +
            '<div class="flex-1 bg-chart-2 ' +
            (m.partial ? 'opacity-40' : '') +
            '" style="height:' +
            (m.in / max) * 100 +
            '%"></div><div class="flex-1 bg-chart-4 ' +
            (m.partial ? 'opacity-40' : '') +
            '" style="height:' +
            (m.out / max) * 100 +
            '%"></div></div><span class="text-center text-[11px] text-muted-foreground ' +
            (m.partial ? 'border-b-2 border-accent font-medium text-foreground' : '') +
            '">' +
            m.m +
            '</span></div>',
        )
        .join('') +
      '</div><div class="mt-3 flex gap-4 text-xs text-muted-foreground"><span class="inline-flex items-center gap-1.5"><span class="size-2.5 bg-chart-2"></span>Inkomsten</span><span class="inline-flex items-center gap-1.5"><span class="size-2.5 bg-chart-4"></span>Uitgaven</span><span class="ml-auto">okt loopt nog</span></div></section>' +
      '<section aria-labelledby="per-h" class="border p-4"><h2 id="per-h" class="text-base">Periodes</h2><ul role="list" class="mt-2 divide-y text-sm">' +
      '<li class="flex items-center justify-between py-2"><span>Oktober 2026</span><span class="badge badge-neutral">Open</span></li>' +
      '<li class="flex items-center justify-between gap-3 py-2"><span>Q3 2026</span><span class="inline-flex items-center gap-1 text-muted-foreground">' +
      icon('lock', 'size-3.5') +
      'Dit kwartaal is afgesloten</span></li>' +
      '<li class="flex items-center justify-between gap-3 py-2"><span>2025</span><span class="inline-flex items-center gap-1 text-muted-foreground">' +
      icon('lock', 'size-3.5') +
      'Dit jaar is afgesloten</span></li>' +
      '</ul></section>' +
      '</div></div></div>'
    )
  }

  // ------------------------------------------------------------- findings

  function resultFor(f) {
    const account = D.accountOptions[S.picker.chosen].name
    const vat = D.vatOptions.find((v) => v.code === S.picker.vat).label
    const rate = parseRate(S.fx.rate)
    return (
      {
        unmapped_account: 'Kantoorartikelen → ' + account + ' · ' + vat,
        unknown_currency:
          'Koers ' +
          (rate ? nlNumber(rate, 4) : '—') +
          ' (' +
          (S.fx.source === 'ecb' ? 'ECB' : 'Aangepast') +
          ' · ' +
          D.fx.ecb.date +
          ')',
        unmapped_tax_rate: 'Laag tarief → 9% btw',
        fiscal_year_start_unknown: 'Boekjaar begint in januari',
        draft_skipped: '4 concepten blijven in Moneybird',
        period_locked: 'Staat onder ‘Niet overgezet’',
      }[f.code] || 'Opgelost'
    )
  }

  function findingCard(f, i) {
    const selected = i === S.findingIdx
    const blocking = f.severity === 'blocking'
    const typeLabel = {
      oneClick: 'Eén klik',
      guided: f.fix.steps ? f.fix.steps.length + ' stappen' : 'Stappen',
      explainOnly: 'Uitleg',
    }[f.fix.type]
    let fixRow = ''
    if (f.fix.type === 'guided') {
      fixRow =
        '<button type="button" data-action="open-fix" data-id="' +
        f.id +
        '" class="btn btn-primary">' +
        f.fix.label +
        icon('arrowRight') +
        '</button>' +
        '<span class="text-xs text-muted-foreground">' +
        f.fix.steps.join(' → ') +
        '</span>'
    } else if (f.fix.type === 'oneClick') {
      fixRow =
        '<button type="button" data-action="one-click" data-id="' +
        f.id +
        '" class="btn btn-outline">' +
        icon('check') +
        f.fix.label +
        '</button>' +
        '<span class="text-xs text-muted-foreground">' +
        (f.fix.preview ? 'Je ziet eerst wat er verandert' : 'Wijzigt niets in je boekhouding') +
        '</span>'
    } else {
      fixRow =
        '<span class="text-sm text-muted-foreground">Dit los je niet hier op.</span>' +
        '<a href="' +
        f.fix.href +
        '" data-action="todo" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4 md:min-h-0">' +
        f.fix.linkLabel +
        icon('external', 'size-3.5') +
        '</a>'
    }
    const preview =
      S.previewOpen === f.id && f.fix.preview
        ? '<div class="animate-in-fade mt-4 border bg-muted p-4"><p class="text-sm font-medium">' +
          f.fix.preview.title +
          '</p><dl class="mt-2 space-y-1 text-sm">' +
          f.fix.preview.lines
            .map(
              ([k, v]) =>
                '<div class="flex justify-between gap-4"><dt class="text-muted-foreground">' +
                k +
                '</dt><dd class="tabular">' +
                v +
                '</dd></div>',
            )
            .join('') +
          '</dl><p class="mt-2 text-xs text-muted-foreground">Er wordt nu nog niets geboekt. Dat gebeurt pas als je importeert.</p><div class="mt-3 flex flex-wrap gap-2"><button type="button" data-action="apply" data-id="' +
          f.id +
          '" class="btn btn-primary">Toepassen' +
          keycaps(
            'enter',
            'ml-1 [&_.keycap]:bg-transparent [&_.keycap]:text-primary-foreground/80 [&_.keycap]:border-primary-foreground/30',
          ) +
          '</button><button type="button" data-action="close-preview" class="btn btn-ghost">Annuleren' +
          keycaps('escape', 'ml-1') +
          '</button></div></div>'
        : ''
    return (
      '<li class="collapse-out" data-card="' +
      f.id +
      '"><div>' +
      '<article data-fid="card-' +
      f.id +
      '" data-action="select-finding" data-id="' +
      f.id +
      '" tabindex="' +
      (selected ? 0 : -1) +
      '" aria-labelledby="ft-' +
      f.id +
      '" ' +
      'class="relative border border-l-4 bg-card p-4 transition-colors md:p-5 ' +
      (blocking ? 'border-l-destructive' : 'border-l-[var(--line-strong)]') +
      (selected ? ' outline-2 outline-offset-2 outline-ring' : '') +
      '">' +
      '<div class="mb-2 flex flex-wrap items-center gap-2">' +
      (blocking
        ? '<span class="badge badge-error">' + icon('alert', 'size-3') + 'Blokkeert import</span>'
        : '<span class="badge badge-neutral">Let op</span>') +
      '<span class="text-xs text-muted-foreground">' +
      typeLabel +
      '</span>' +
      '<code class="ml-auto hidden font-mono text-[11px] text-muted-foreground sm:block">' +
      f.code +
      '</code></div>' +
      '<h3 id="ft-' +
      f.id +
      '" class="text-[15px] leading-snug font-medium">' +
      f.title +
      '</h3>' +
      '<p class="mt-1 text-sm text-muted-foreground"><span class="font-medium text-foreground">Waarom dit telt:</span> ' +
      f.why +
      '</p>' +
      '<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">' +
      fixRow +
      (selected
        ? '<span class="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">' +
          keycaps('enter') +
          (f.fix.type === 'explainOnly' ? 'Uitleg' : 'Oplossen') +
          '</span>'
        : '') +
      '</div>' +
      preview +
      '</article></div></li>'
    )
  }

  function honestyCell(s) {
    const map = {
      reconciled: ['badge-success', 'check', 'Klopt', 'Aansluiting klopt', ''],
      empty: [
        'badge-neutral',
        'circle',
        'Leeg (bevestigd)',
        'Gelezen, er was niets. Niet gecontroleerd.',
        '',
      ],
      unread: [
        'badge-neutral border-dashed',
        'circleDashed',
        'Niet gelezen',
        'Moneybird weigerde de toegang. Niet leeg.',
        '<button type="button" data-action="todo" class="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4 md:min-h-0">' +
          icon('refresh', 'size-3.5') +
          'Opnieuw lezen</button>',
      ],
    }[s.honesty]
    return (
      '<div class="bg-background p-4 ' +
      (s.honesty === 'unread'
        ? 'outline outline-1 -outline-offset-4 outline-dashed outline-[var(--line-strong)]'
        : '') +
      '">' +
      '<p class="text-sm font-medium">' +
      s.label +
      '</p>' +
      '<p class="text-xs text-muted-foreground tabular">' +
      s.count +
      '</p>' +
      '<span class="badge mt-2 ' +
      map[0] +
      '">' +
      icon(map[1], 'size-3') +
      map[2] +
      '</span>' +
      '<p class="mt-1.5 text-xs text-muted-foreground">' +
      map[3] +
      '</p>' +
      map[4] +
      '</div>'
    )
  }

  function findingsScreen() {
    const blocking = S.findings.filter((f) => f.severity === 'blocking').length
    const steps = ['Verbinden', 'Lezen', 'Nakijken', 'Importeren']
    const list = S.findings.length
      ? '<ul role="list" aria-label="Bevindingen" class="space-y-3" data-list="findings">' +
        S.findings.map(findingCard).join('') +
        '</ul>' +
        keyStrip([
          ['j k', 'Volgende, vorige'],
          ['enter', 'Oplossen'],
          ['escape', 'Sluiten'],
        ])
      : '<div class="animate-in-fade flex flex-col items-center border px-6 py-12 text-center">' +
        '<span class="flex size-12 items-center justify-center border border-success text-success"><svg viewBox="0 0 24 24" class="check-draw size-7" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
        '<h3 class="mt-4 text-lg">Alles is nagekeken</h3><p class="mt-1 max-w-md text-sm text-muted-foreground">Er houdt niets de import meer tegen. We zetten 680 boekingen over. 4 concepten en 1 bon uit 2025 blijven achter; die zie je straks onder ‘Niet overgezet’.</p>' +
        '<button type="button" data-action="todo" class="btn btn-primary mt-5">Importeren</button></div>'
    return (
      '<div class="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">' +
      pageHeader({
        eyebrow: 'Importeren',
        title: 'Moneybird',
        sub:
          'Proefimport van ' + D.entity.name + ' · gelezen vandaag 07:40. Er is nog niets geboekt.',
        actions:
          '<button type="button" data-action="todo" class="btn btn-outline">' +
          icon('refresh') +
          'Opnieuw lezen</button>' +
          '<button type="button" class="btn btn-primary" ' +
          (blocking ? 'disabled aria-describedby="imp-why"' : 'data-action="todo"') +
          '>Importeren</button>',
      }) +
      (blocking
        ? '<p id="imp-why" class="-mt-4 mb-6 text-right text-xs text-muted-foreground">Nog ' +
          blocking +
          ' ' +
          (blocking === 1 ? 'punt houdt' : 'punten houden') +
          ' de import tegen</p>'
        : '') +
      '<ol class="mb-6 flex items-center gap-2 overflow-x-auto text-sm" aria-label="Voortgang">' +
      steps
        .map((s, i) => {
          const state = i < 2 ? 'done' : i === 2 ? 'current' : 'todo'
          return (
            '<li class="flex shrink-0 items-center gap-2" ' +
            (state === 'current' ? 'aria-current="step"' : '') +
            '>' +
            (i ? '<span class="h-px w-6 bg-border md:w-10"></span>' : '') +
            '<span class="flex size-6 items-center justify-center border text-xs tabular ' +
            (state === 'done'
              ? 'border-foreground bg-foreground text-background'
              : state === 'current'
                ? 'border-foreground border-b-[3px] border-b-accent font-semibold'
                : 'text-muted-foreground') +
            '">' +
            (state === 'done' ? icon('check', 'size-3.5') : i + 1) +
            '</span><span class="' +
            (state === 'todo'
              ? 'text-muted-foreground'
              : state === 'current'
                ? 'font-medium'
                : '') +
            '">' +
            s +
            '</span></li>'
          )
        })
        .join('') +
      '</ol>' +
      '<section aria-labelledby="src-h" class="mb-8"><h2 id="src-h" class="mb-2 text-base">Wat we gelezen hebben</h2>' +
      '<div class="grid grid-cols-2 gap-px border bg-border md:grid-cols-4">' +
      D.sources.map(honestyCell).join('') +
      '</div></section>' +
      '<section aria-labelledby="fd-h"><div class="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="fd-h" class="text-base">Na te kijken</h2>' +
      (S.findings.length
        ? '<p class="text-sm text-muted-foreground tabular"><span class="text-destructive">' +
          blocking +
          ' blokkeren</span> · ' +
          (S.findings.length - blocking) +
          ' let op</p>'
        : '') +
      '</div>' +
      list +
      '</section>' +
      (S.resolved.length
        ? '<section aria-labelledby="rs-h" class="mt-8"><h2 id="rs-h" class="mb-2 text-base">Opgelost <span class="text-muted-foreground tabular">' +
          S.resolved.length +
          '</span></h2><ul role="list" class="divide-y border">' +
          S.resolved
            .map(
              (r) =>
                '<li class="flex items-start gap-3 px-4 py-3 text-sm"><span class="mt-0.5 text-success">' +
                icon('check') +
                '</span><span class="min-w-0 flex-1"><span class="block">' +
                r.title +
                '</span><span class="block text-muted-foreground">' +
                r.result +
                '</span></span><code class="hidden font-mono text-[11px] text-muted-foreground sm:block">' +
                r.code +
                '</code></li>',
            )
            .join('') +
          '</ul></section>'
        : '') +
      '</div>'
    )
  }

  async function resolveFinding(id) {
    const f = S.findings.find((x) => x.id === id)
    if (!f) return
    closeOverlay(false)
    S.previewOpen = null
    const li = document.querySelector('[data-card="' + id + '"]')
    if (li) {
      const art = li.querySelector('article')
      art.classList.add('flash-success')
      art.classList.remove('border-l-destructive', 'border-l-[var(--line-strong)]')
      art.style.borderLeftColor = 'var(--color-success)'
      const badgeRow = art.firstElementChild
      badgeRow.innerHTML =
        '<span class="badge badge-success"><svg viewBox="0 0 24 24" class="check-draw size-3" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Opgelost</span><span class="text-xs text-muted-foreground">' +
        resultFor(f) +
        '</span>'
      const fixRow = art.querySelector('.mt-4')
      if (fixRow) fixRow.remove()
      li.classList.add('is-gone')
      await wait(560)
    }
    const idx = S.findings.indexOf(f)
    S.findings.splice(idx, 1)
    S.resolved.unshift({ id: f.id, code: f.code, title: f.title, result: resultFor(f) })
    S.findingIdx = Math.min(idx, Math.max(0, S.findings.length - 1))
    renderMain()
    refreshChrome()
    focusFinding()
    toast('Opgelost: ' + resultFor(f))
  }

  function focusFinding() {
    const f = S.findings[S.findingIdx]
    if (!f) return
    const el = document.querySelector('[data-fid="card-' + f.id + '"]')
    if (el) el.focus({ preventScroll: Boolean(focusFinding.quiet) })
  }

  function openFix(f) {
    if (f.fix.type === 'guided') {
      S.fixId = f.id
      if (f.fix.sheet === 'account') S.picker = { query: '', active: 0, chosen: 0, vat: 'VH21' }
      openOverlay('fix')
    } else if (f.fix.type === 'oneClick') {
      if (f.fix.preview) {
        S.previewOpen = f.id
        renderMain()
        const btn = document.querySelector('[data-action="apply"][data-id="' + f.id + '"]')
        if (btn) btn.focus()
      } else resolveFinding(f.id)
    } else {
      toast('Dit los je op in Moneybird. De link opent daar.', 'info')
    }
  }

  // ------------------------------------------------------ fix sheets

  function sheet(key, title, eyebrow, body, footer) {
    return (
      '<div class="fixed inset-0 z-40">' +
      '<div class="absolute inset-0 bg-black/40 ' +
      anim(key, 'animate-in-fade') +
      '" data-action="close-overlay"></div>' +
      '<section role="dialog" aria-modal="true" aria-labelledby="sheet-title" class="absolute top-0 right-0 flex h-full w-full flex-col border-l bg-background sm:w-[520px] ' +
      anim(key, 'animate-in-right') +
      '">' +
      '<header class="flex items-start gap-3 border-b px-5 py-4"><div class="min-w-0 flex-1"><p class="text-xs text-muted-foreground">' +
      eyebrow +
      '</p><h2 id="sheet-title" class="mt-0.5 text-lg leading-snug">' +
      title +
      '</h2></div>' +
      '<button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon -mt-1 -mr-2" aria-label="Sluiten">' +
      icon('x', 'size-5') +
      '</button></header>' +
      '<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">' +
      body +
      '</div>' +
      '<footer class="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">' +
      footer +
      '</footer>' +
      '</section></div>'
    )
  }

  function primaryWithKey(label, action, extra) {
    return (
      '<button type="button" data-action="' +
      action +
      '" class="btn btn-primary ' +
      (extra || '') +
      '">' +
      label +
      keycaps(
        'enter',
        'ml-1 [&_.keycap]:bg-transparent [&_.keycap]:text-primary-foreground/80 [&_.keycap]:border-primary-foreground/30',
      ) +
      '</button>'
    )
  }
  function cancelWithKey(label) {
    return (
      '<button type="button" data-action="close-overlay" class="btn btn-ghost">' +
      (label || 'Annuleren') +
      keycaps('escape', 'ml-1') +
      '</button>'
    )
  }

  function filteredAccounts() {
    const q = S.picker.query.trim().toLowerCase()
    if (!q) return D.accountOptions
    return D.accountOptions.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.number.startsWith(q) ||
        a.rgs.toLowerCase().includes(q),
    )
  }

  function accountOptionsHtml() {
    const opts = filteredAccounts()
    if (!opts.length)
      return '<li class="px-3 py-3 text-sm text-muted-foreground">Geen categorie gevonden.</li>'
    return opts
      .map((a, i) => {
        const active = i === S.picker.active
        const chosen = D.accountOptions.indexOf(a) === S.picker.chosen
        return (
          '<li role="option" id="acc-' +
          i +
          '" aria-selected="' +
          chosen +
          '" data-action="choose-account" data-index="' +
          i +
          '" class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 ' +
          (active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted') +
          '">' +
          '<span class="flex size-4 items-center justify-center">' +
          (chosen ? icon('check', 'size-4') : '') +
          '</span>' +
          (S.advanced
            ? '<span class="w-10 font-mono text-xs tabular">' + a.number + '</span>'
            : '') +
          '<span class="min-w-0 flex-1"><span class="flex items-center gap-2 text-sm font-medium">' +
          a.name +
          (a.best
            ? '<span class="badge ' +
              (active ? 'border-accent-foreground/40' : 'badge-success') +
              '">Beste match</span>'
            : '') +
          '</span>' +
          '<span class="block text-xs ' +
          (active ? 'text-accent-foreground/75' : 'text-muted-foreground') +
          '">' +
          (a.reason ? a.reason + ' · ' : '') +
          'RGS <span class="font-mono">' +
          a.rgs +
          '</span></span></span></li>'
        )
      })
      .join('')
  }

  function accountSheet(f) {
    const chosen = D.accountOptions[S.picker.chosen]
    const vat = D.vatOptions.find((v) => v.code === S.picker.vat)
    const body =
      '<div class="mb-5 border bg-muted px-4 py-3 text-sm"><p class="text-xs text-muted-foreground">Uit Moneybird</p><p class="mt-0.5 font-medium">Kantoorartikelen</p><p class="text-muted-foreground tabular">38 boekingen · € 2.914,60 in 2026</p></div>' +
      '<div class="mb-1 flex items-baseline justify-between"><label for="acc-q" class="text-sm font-medium">1. Waar hoort dit bij?</label><span class="text-xs text-muted-foreground">Voorgesteld op RGS</span></div>' +
      '<div class="relative">' +
      icon('search', 'size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground') +
      '<input id="acc-q" data-fid="acc-q" type="text" role="combobox" aria-expanded="true" aria-controls="acc-list" aria-activedescendant="acc-' +
      S.picker.active +
      '" autocomplete="off" placeholder="Zoek op naam' +
      (S.advanced ? ' of nummer' : '') +
      '" class="field pl-9" value="' +
      esc(S.picker.query) +
      '"></div>' +
      '<ul id="acc-list" role="listbox" aria-label="Categorieën" class="mt-1 divide-y border">' +
      accountOptionsHtml() +
      '</ul>' +
      '<button type="button" data-action="todo" class="mt-1 flex min-h-11 w-full items-center gap-2 border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted md:min-h-9">' +
      icon('plus') +
      'Nieuwe categorie maken</button>' +
      '<fieldset class="mt-6"><legend class="mb-2 text-sm font-medium">2. Welk btw-tarief?</legend><div role="radiogroup" class="grid grid-cols-3 border" data-group="vat">' +
      D.vatOptions
        .map(
          (v, i) =>
            '<button type="button" role="radio" aria-checked="' +
            (v.code === S.picker.vat) +
            '" data-action="choose-vat" data-code="' +
            v.code +
            '" data-fid="vat-' +
            v.code +
            '" tabindex="' +
            (v.code === S.picker.vat ? 0 : -1) +
            '" class="min-h-11 px-2 text-sm ' +
            (i ? 'border-l ' : '') +
            (v.code === S.picker.vat
              ? 'bg-foreground font-medium text-background'
              : 'hover:bg-muted') +
            '">' +
            v.label +
            (S.advanced
              ? ' <span class="font-mono text-xs opacity-70">' + v.code + '</span>'
              : '') +
            '</button>',
        )
        .join('') +
      '</div><p class="mt-1.5 text-xs text-muted-foreground">' +
      (vat.note ? vat.note + '.' : 'In Moneybird stond 21% btw.') +
      '</p></fieldset>' +
      '<div class="mt-6 border-l-[3px] border-accent bg-muted px-4 py-3 text-sm"><p class="font-medium">Wat er gebeurt</p><p class="mt-1 text-muted-foreground">De 38 boekingen uit Moneybird komen op <span class="text-foreground">' +
      chosen.name +
      '</span>, met <span class="text-foreground">' +
      vat.label +
      '</span>. Er wordt nu nog niets geboekt; dat gebeurt pas als je importeert.</p></div>'
    return sheet(
      'fix-' + f.id,
      'Waar hoort ‘Kantoorartikelen’ bij?',
      'Oplossen · Categorie en btw',
      body,
      cancelWithKey() + primaryWithKey('Opslaan', 'save-fix'),
    )
  }

  function fxCalc() {
    const rate = parseRate(S.fx.rate)
    const amount = Number(D.fx.amount)
    return { rate, eur: rate ? Math.round(amount * rate * 100) / 100 : null }
  }

  function fxSourceBadge() {
    const date = D.fx.ecb.date
    return S.fx.source === 'ecb'
      ? '<span class="badge badge-neutral" data-fx="badge">' +
          icon('bank', 'size-3') +
          'ECB · ' +
          date +
          '</span>'
      : '<span class="badge badge-attention" data-fx="badge">' +
          icon('pencil', 'size-3') +
          'Aangepast · ' +
          date +
          '</span>'
  }

  function fxDecision() {
    const { rate } = fxCalc()
    const rateStr = rate ? rate.toFixed(4) : null
    return (
      '// import_decisions.exchangeRates["' +
      D.fx.externalId +
      '"]\n' +
      JSON.stringify({ rate: rateStr, source: S.fx.source, date: D.fx.ecb.date }, null, 2) +
      '\n\n// bij importeren, op elke journal_line van dit document\nexchange_rate:        "' +
      rateStr +
      '"\nexchange_rate_source: "' +
      S.fx.source +
      ':' +
      D.fx.ecb.date +
      '"'
    )
  }

  function fxSheet(f) {
    const { rate, eur } = fxCalc()
    const ecbNote =
      S.fx.source === 'ecb'
        ? 'Dagkoers van de Europese Centrale Bank op de factuurdatum (1 EUR = ' +
          D.fx.ecb.perEur.replace('.', ',') +
          ' GBP).'
        : 'Je eigen koers. We bewaren hem bij de boeking, met de datum.'
    const body =
      '<dl class="mb-5 grid grid-cols-2 gap-px border bg-border text-sm">' +
      [
        ['Leverancier', D.fx.supplier],
        ['Factuur', D.fx.reference],
        ['Factuurdatum', '16 oktober 2026'],
        ['Bedrag', 'GBP ' + nlNumber(Number(D.fx.amount), 2)],
      ]
        .map(
          ([k, v]) =>
            '<div class="bg-background px-3 py-2"><dt class="text-xs text-muted-foreground">' +
            k +
            '</dt><dd class="font-medium tabular">' +
            v +
            '</dd></div>',
        )
        .join('') +
      '</dl>' +
      '<div class="flex items-baseline justify-between gap-2"><label for="fx-rate" class="text-sm font-medium">Koers</label><span data-fx="badge-wrap">' +
      fxSourceBadge() +
      '</span></div>' +
      '<p class="mb-2 text-xs text-muted-foreground">Euro per 1 Britse pond. Je mag hem aanpassen.</p>' +
      '<div class="flex items-stretch">' +
      '<span class="flex items-center border border-r-0 border-input bg-muted px-3 text-sm tabular">1 GBP =</span>' +
      '<div class="relative flex-1"><input id="fx-rate" data-fid="fx-rate" inputmode="decimal" autocomplete="off" class="field pr-9 text-lg font-medium tabular md:text-lg" value="' +
      esc(S.fx.rate.replace('.', ',')) +
      '" aria-describedby="fx-note">' +
      icon(
        'pencil',
        'size-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none',
      ) +
      '</div>' +
      '<span class="flex items-center border border-l-0 border-input bg-muted px-3 text-sm">EUR</span></div>' +
      '<p id="fx-note" class="mt-2 text-xs text-muted-foreground" data-fx="note">' +
      ecbNote +
      '</p>' +
      '<button type="button" data-action="fx-reset" data-fx="reset" class="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4 md:min-h-8"' +
      (S.fx.source === 'ecb' ? ' hidden' : '') +
      '>' +
      icon('refresh', 'size-3.5') +
      'Terug naar ECB-koers (1,1531)</button>' +
      '<section class="mt-6" aria-labelledby="fx-prev-h"><h3 id="fx-prev-h" class="mb-2 text-sm font-medium">Zo wordt het geboekt</h3>' +
      '<div class="border"><table class="w-full text-sm"><tbody class="divide-y">' +
      '<tr><td class="px-3 py-2">Inkoop grondstoffen' +
      (S.advanced ? ' <span class="font-mono text-xs text-muted-foreground">7000</span>' : '') +
      '</td><td class="px-3 py-2 text-right tabular" data-fx="eur1">' +
      (eur ? euro(eur) : '—') +
      '</td></tr>' +
      '<tr><td class="px-3 py-2">Te betalen aan Shipton Mill' +
      (S.advanced ? ' <span class="font-mono text-xs text-muted-foreground">1600</span>' : '') +
      '</td><td class="px-3 py-2 text-right tabular" data-fx="eur2">' +
      (eur ? euro(eur) : '—') +
      '</td></tr>' +
      '</tbody></table><p class="border-t bg-muted px-3 py-2 text-xs text-muted-foreground tabular" data-fx="calc">GBP 1.240,00 × ' +
      (rate ? nlNumber(rate, 4) : '—') +
      ' = ' +
      (eur ? euro(eur) : '—') +
      '</p></div>' +
      '</section>' +
      '<details ' +
      (S.params.get('notes') === '1' ? 'open ' : '') +
      'class="mt-6 border border-dashed p-3 text-xs"><summary class="cursor-pointer font-medium text-muted-foreground">Prototype-notitie voor Eng: wat er wordt opgeslagen</summary>' +
      '<pre class="mt-2 overflow-x-auto font-mono leading-relaxed" data-fx="json">' +
      esc(fxDecision()) +
      '</pre></details>'
    return sheet(
      'fix-' + f.id,
      'Koers kiezen voor ' + D.fx.reference,
      'Oplossen · Koers',
      body,
      cancelWithKey() + primaryWithKey('Koers gebruiken', 'save-fix'),
    )
  }

  function bindFx() {
    const input = document.getElementById('fx-rate')
    if (!input) return
    input.addEventListener('input', () => {
      S.fx.rate = input.value
      S.fx.source =
        parseRate(input.value) && parseRate(input.value).toFixed(4) === D.fx.ecb.rate
          ? 'ecb'
          : 'override'
      updateFx()
    })
  }

  function updateFx() {
    const { rate, eur } = fxCalc()
    const q = (k) => overlayRoot.querySelector('[data-fx="' + k + '"]')
    q('badge-wrap').innerHTML = fxSourceBadge()
    q('note').textContent =
      S.fx.source === 'ecb'
        ? 'Dagkoers van de Europese Centrale Bank op de factuurdatum (1 EUR = 0,8672 GBP).'
        : 'Je eigen koers. We bewaren hem bij de boeking, met de datum.'
    q('reset').hidden = S.fx.source === 'ecb'
    q('eur1').textContent = eur ? euro(eur) : '—'
    q('eur2').textContent = eur ? euro(eur) : '—'
    q('calc').textContent =
      'GBP 1.240,00 × ' + (rate ? nlNumber(rate, 4) : '—') + ' = ' + (eur ? euro(eur) : '—')
    q('json').textContent = fxDecision()
  }

  // -------------------------------------------------------------- invoice

  const INV_STEPS = ['Klant', 'Wat lever je', 'Controleren', 'Versturen']

  function invoiceTotals() {
    return { net: '447,00', vat: '40,23', total: '487,23' }
  }

  function invoiceScreen() {
    const inv = S.invoice
    const c = D.customers.find((x) => x.id === inv.customer)
    if (inv.done) {
      return (
        '<div class="mx-auto max-w-2xl px-4 py-10 md:px-8 md:py-16"><div class="animate-in-pop border p-8 text-center">' +
        '<span class="mx-auto flex size-14 items-center justify-center border border-success text-success"><svg viewBox="0 0 24 24" class="check-draw size-8" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
        '<h1 class="mt-5 text-2xl">Verstuurd naar ' +
        c.name.replace(' B.V.', '') +
        '</h1>' +
        '<p class="mt-2 text-sm text-muted-foreground tabular">Factuur 2026-0143 · € 487,23 · te betalen vóór 1 november.<br>Je ziet hem bij Nog te ontvangen.</p>' +
        '<div class="mt-6 flex flex-wrap justify-center gap-2"><a href="#/invoice" class="btn btn-outline">Nog een factuur</a><a href="#/dashboard" class="btn btn-primary">Naar dashboard</a></div></div></div>'
      )
    }
    const stepper =
      '<ol class="mb-6 grid grid-cols-4 border" aria-label="Stappen">' +
      INV_STEPS.map((s, i) => {
        const n = i + 1
        const state = n < inv.step ? 'done' : n === inv.step ? 'current' : 'todo'
        return (
          '<li class="flex min-h-11 items-center gap-2 px-2 text-xs md:px-3 md:text-sm ' +
          (i ? 'border-l ' : '') +
          (state === 'current'
            ? 'border-b-[3px] border-b-accent font-medium'
            : 'border-b-[3px] border-b-transparent') +
          (state === 'todo' ? ' text-muted-foreground' : '') +
          '" ' +
          (state === 'current' ? 'aria-current="step"' : '') +
          '>' +
          '<span class="flex size-5 shrink-0 items-center justify-center text-[11px] tabular ' +
          (state === 'done' ? 'bg-foreground text-background' : 'border') +
          '">' +
          (state === 'done' ? icon('check', 'size-3') : n) +
          '</span>' +
          '<span class="hidden truncate sm:inline">' +
          s +
          '</span></li>'
        )
      }).join('') +
      '</ol>'
    const bodies = [invStep1, invStep2, invStep3, invStep4]
    const nextLabel = ['Verder', 'Verder', 'Verder', 'Versturen'][inv.step - 1]
    return (
      '<div class="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">' +
      '<div class="mb-5 flex items-start justify-between gap-4"><div><h1 class="text-2xl tracking-tight md:text-[28px]">Nieuwe factuur</h1>' +
      '<p class="mt-1 text-sm text-muted-foreground">Stap ' +
      inv.step +
      ' van 4 · ' +
      INV_STEPS[inv.step - 1] +
      '</p></div>' +
      '<span class="badge badge-neutral mt-2 hidden sm:inline-flex">' +
      icon('user', 'size-3') +
      'Eigenaar · Geavanceerd ' +
      (S.advanced ? 'aan' : 'uit') +
      '</span></div>' +
      stepper +
      '<div class="animate-in-fade" data-step="' +
      inv.step +
      '">' +
      bodies[inv.step - 1](c) +
      '</div>' +
      '<div class="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center gap-2 border-t bg-background px-4 py-3 md:static md:mx-0 md:border-t-0 md:px-0">' +
      (inv.step > 1
        ? '<button type="button" data-action="inv-back" class="btn btn-outline">' +
          icon('chevronLeft') +
          'Terug' +
          keycaps('escape', 'ml-1') +
          '</button>'
        : '<a href="#/dashboard" class="btn btn-ghost">Annuleren' +
          keycaps('escape', 'ml-1') +
          '</a>') +
      '<span class="flex-1"></span>' +
      (inv.step === 4
        ? '<button type="button" data-action="todo" class="btn btn-outline">Concept opslaan</button>'
        : '') +
      primaryWithKey(nextLabel + (inv.step < 4 ? '' : ''), 'inv-next') +
      '</div></div>'
    )
  }

  function filteredCustomers() {
    const q = S.invoice.query.trim().toLowerCase()
    return D.customers.filter(
      (x) => !q || x.name.toLowerCase().includes(q) || x.city.toLowerCase().includes(q),
    )
  }

  function invStep1(c) {
    return (
      '<label for="cust-q" class="text-sm font-medium">Aan wie stuur je de factuur?</label>' +
      '<div class="relative mt-2">' +
      icon('search', 'size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground') +
      '<input id="cust-q" data-fid="cust-q" role="combobox" aria-expanded="true" aria-controls="cust-list" class="field pl-9" placeholder="Zoek een klant" autocomplete="off" value="' +
      esc(S.invoice.query) +
      '"></div>' +
      '<ul id="cust-list" role="listbox" aria-label="Klanten" class="mt-1 divide-y border">' +
      filteredCustomers()
        .map((x, i) => {
          const active = i === S.invoice.customerActive
          return (
            '<li role="option" aria-selected="' +
            (x.id === S.invoice.customer) +
            '" data-action="choose-customer" data-id="' +
            x.id +
            '" class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm ' +
            (active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted') +
            '"><span class="flex size-4 items-center">' +
            (x.id === S.invoice.customer ? icon('check') : '') +
            '</span><span class="flex-1 font-medium">' +
            x.name +
            '</span><span class="' +
            (active ? 'text-accent-foreground/75' : 'text-muted-foreground') +
            '">' +
            x.city +
            '</span></li>'
          )
        })
        .join('') +
      '<li data-action="todo" class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:bg-muted">' +
      icon('plus') +
      'Nieuwe klant</li></ul>' +
      '<div class="mt-5 border-l-[3px] border-accent bg-muted px-4 py-3 text-sm"><p class="font-medium">' +
      c.name +
      '</p><p class="text-muted-foreground">Boulevard de Ruyter 2, 4381 KA ' +
      c.city +
      ' · ' +
      c.email +
      '</p>' +
      '<p class="mt-2">We vullen alvast in: betalen binnen <span class="font-medium">' +
      c.terms +
      ' dagen</span> en <span class="font-medium">' +
      c.vat +
      '</span>, net als op je vorige factuur aan deze klant.</p></div>'
    )
  }

  function invStep2() {
    const t = invoiceTotals()
    return (
      '<div class="mb-5 grid gap-4 sm:grid-cols-2">' +
      '<div><label class="text-sm font-medium" for="inv-date">Factuurdatum</label><input id="inv-date" class="field mt-1.5 tabular" value="18-10-2026"></div>' +
      '<div><label class="text-sm font-medium" for="inv-due">Betalen vóór</label><input id="inv-due" class="field mt-1.5 tabular" value="01-11-2026"><p class="mt-1 text-xs text-muted-foreground">14 dagen, zoals afgesproken met deze klant</p></div></div>' +
      '<p class="mb-2 text-sm font-medium">Wat lever je?</p>' +
      '<div class="overflow-x-auto border"><table class="w-full min-w-[620px] text-sm">' +
      '<thead class="bg-muted text-left text-xs text-muted-foreground"><tr><th class="sticky-col bg-muted px-3 py-2 font-medium">Omschrijving</th><th class="w-20 px-3 py-2 text-right font-medium">Aantal</th><th class="w-28 px-3 py-2 text-right font-medium">Prijs</th><th class="w-32 px-3 py-2 font-medium">Btw</th><th class="w-28 px-3 py-2 text-right font-medium">Bedrag</th></tr></thead><tbody class="divide-y">' +
      D.invoiceLines
        .map(
          (l, i) =>
            '<tr><td class="sticky-col p-1"><input aria-label="Omschrijving regel ' +
            (i + 1) +
            '" class="field min-w-48 border-transparent hover:border-input" value="' +
            l.description +
            '"></td>' +
            '<td class="p-1"><input aria-label="Aantal" class="field border-transparent text-right tabular hover:border-input" value="' +
            l.qty +
            '"></td>' +
            '<td class="p-1"><input aria-label="Prijs" class="field border-transparent text-right tabular hover:border-input" value="€ ' +
            l.price +
            '"></td>' +
            '<td class="p-1"><button type="button" class="field flex items-center justify-between border-transparent text-left hover:border-input">' +
            l.vat +
            icon('chevronDown', 'size-3.5 text-muted-foreground') +
            '</button></td>' +
            '<td class="px-3 py-2 text-right font-medium tabular">€ ' +
            l.total +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div>' +
      '<button type="button" data-action="todo" class="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium md:min-h-8">' +
      icon('plus') +
      'Regel toevoegen</button>' +
      '<dl class="mt-4 ml-auto max-w-xs space-y-1 text-sm tabular"><div class="flex justify-between"><dt class="text-muted-foreground">Zonder btw</dt><dd>€ ' +
      t.net +
      '</dd></div><div class="flex justify-between"><dt class="text-muted-foreground">9% btw</dt><dd>€ ' +
      t.vat +
      '</dd></div><div class="flex justify-between border-t pt-1 text-base font-semibold"><dt>Totaal</dt><dd>€ ' +
      t.total +
      '</dd></div></dl>'
    )
  }

  function invStep3(c) {
    const t = invoiceTotals()
    return (
      '<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">' +
      '<div class="border bg-white p-6 text-black dark:bg-white" aria-label="Voorbeeld van de factuur">' +
      '<div class="flex items-start justify-between"><div><p class="font-semibold">Bakkerij De Vries B.V.</p><p class="text-xs text-black/60">Lange Delft 41, Middelburg<br>KvK 61234567 · NL861234567B01</p></div><div class="text-right"><p class="text-lg font-semibold">Factuur</p><p class="text-xs text-black/60">Nummer volgt bij versturen</p></div></div>' +
      '<div class="mt-6 grid grid-cols-2 gap-4 text-xs"><div><p class="text-black/60">Aan</p><p class="font-medium">' +
      c.name +
      '</p><p>Boulevard de Ruyter 2<br>4381 KA ' +
      c.city +
      '</p></div><div class="text-right tabular"><p><span class="text-black/60">Datum</span> 18-10-2026</p><p><span class="text-black/60">Betalen vóór</span> 01-11-2026</p></div></div>' +
      '<table class="mt-6 w-full text-xs tabular"><thead class="border-b border-black/20 text-left text-black/60"><tr><th class="py-1 font-medium">Omschrijving</th><th class="py-1 text-right font-medium">Aantal</th><th class="py-1 text-right font-medium">Prijs</th><th class="py-1 text-right font-medium">Bedrag</th></tr></thead><tbody>' +
      D.invoiceLines
        .map(
          (l) =>
            '<tr class="border-b border-black/10"><td class="py-1.5">' +
            l.description +
            '</td><td class="text-right">' +
            l.qty +
            '</td><td class="text-right">€ ' +
            l.price +
            '</td><td class="text-right">€ ' +
            l.total +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table><dl class="mt-3 ml-auto w-48 space-y-0.5 text-xs tabular"><div class="flex justify-between"><dt class="text-black/60">Zonder btw</dt><dd>€ ' +
      t.net +
      '</dd></div><div class="flex justify-between"><dt class="text-black/60">9% btw</dt><dd>€ ' +
      t.vat +
      '</dd></div><div class="flex justify-between border-t border-black/20 pt-1 text-sm font-semibold"><dt>Totaal</dt><dd>€ ' +
      t.total +
      '</dd></div></dl></div>' +
      '<div><h2 class="text-base">Wat er gebeurt</h2><ul class="mt-2 space-y-3 text-sm">' +
      '<li class="border-l-2 pl-3">' +
      c.name.replace(' B.V.', '') +
      ' moet <span class="font-medium tabular">€ ' +
      t.total +
      '</span> betalen, uiterlijk 1 november.</li>' +
      '<li class="border-l-2 pl-3"><span class="font-medium tabular">€ ' +
      t.vat +
      '</span> daarvan is btw. Die betaal je met de aangifte over Q4.</li>' +
      '<li class="border-l-2 pl-3"><span class="font-medium tabular">€ ' +
      t.net +
      '</span> telt mee als omzet.</li></ul>' +
      '<p class="mt-4 text-xs text-muted-foreground">De boekingsregels zie je als Geavanceerd aan staat. Dat zet je aan in je gebruikersmenu of met ' +
      mod +
      ' K.</p></div></div>'
    )
  }

  function invStep4(c) {
    const opt = (id, title, sub) =>
      '<button type="button" role="radio" aria-checked="' +
      (S.invoice.send === id) +
      '" data-action="inv-send" data-id="' +
      id +
      '" class="flex min-h-16 w-full items-start gap-3 border p-4 text-left ' +
      (S.invoice.send === id ? 'border-foreground' : 'hover:bg-muted') +
      '"><span class="mt-0.5 flex size-4 items-center justify-center border ' +
      (S.invoice.send === id ? 'border-foreground' : '') +
      '">' +
      (S.invoice.send === id ? '<span class="size-2 bg-foreground"></span>' : '') +
      '</span><span><span class="block text-sm font-medium">' +
      title +
      '</span><span class="block text-sm text-muted-foreground">' +
      sub +
      '</span></span></button>'
    return (
      '<p class="mb-2 text-sm font-medium">Hoe wil je hem versturen?</p><div role="radiogroup" class="space-y-2">' +
      opt('email', 'Per e-mail naar ' + c.email, 'Met de factuur als pdf en een betaallink.') +
      opt('pdf', 'Zelf versturen', 'Je krijgt de pdf. Wij zetten hem bij Nog te ontvangen.') +
      '</div><p class="mt-4 flex items-start gap-2 text-sm text-muted-foreground">' +
      icon('info', 'size-4 mt-0.5') +
      'Na versturen krijgt de factuur een vast nummer en kun je hem niet meer wijzigen. Corrigeren gaat met een creditfactuur.</p>'
    )
  }

  function confirmDialog() {
    const key = 'confirm'
    return (
      '<div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">' +
      '<div class="absolute inset-0 bg-black/40 ' +
      anim(key, 'animate-in-fade') +
      '" data-action="close-overlay"></div>' +
      '<section role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-d" class="relative w-full border bg-background p-6 sm:max-w-md ' +
      anim(key, 'animate-in-pop') +
      '">' +
      '<h2 id="cf-t" class="text-lg">Factuur versturen?</h2>' +
      '<p id="cf-d" class="mt-2 text-sm text-muted-foreground">Hij krijgt nummer <span class="font-medium text-foreground tabular">2026-0143</span> en gaat naar administratie@hotelzeezicht.nl. Daarna kun je hem niet meer wijzigen.</p>' +
      '<dl class="mt-4 space-y-1 border-y py-3 text-sm tabular"><div class="flex justify-between"><dt class="text-muted-foreground">Klant</dt><dd>Hotel Zeezicht B.V.</dd></div><div class="flex justify-between"><dt class="text-muted-foreground">Totaal</dt><dd class="font-medium">€ 487,23</dd></div></dl>' +
      '<div class="mt-5 flex flex-wrap justify-end gap-2">' +
      cancelWithKey() +
      primaryWithKey(icon('send') + 'Versturen', 'inv-confirm') +
      '</div></section></div>'
    )
  }

  // ----------------------------------------------------------------- bank

  const confTone = {
    Zeker: 'badge-success',
    Waarschijnlijk: 'badge-neutral',
    Mogelijk: 'badge-neutral',
  }

  function bankPanel(b, inSheet) {
    if (!b) return '<div class="border p-6 text-sm text-muted-foreground">Alles is gekoppeld.</div>'
    const header =
      '<div class="border-b p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-xs text-muted-foreground tabular">' +
      b.date +
      ' 2026 · ING ··· 4821</p><h2 class="mt-0.5 text-base">' +
      b.counterparty +
      '</h2><p class="text-sm text-muted-foreground">' +
      b.description +
      '</p></div>' +
      '<div class="text-right"><span class="badge badge-neutral">' +
      (b.direction === 'af' ? 'Af' : 'Bij') +
      '</span><p class="mt-1 text-xl font-semibold tabular">' +
      (b.direction === 'af' ? '− ' : '+ ') +
      '€ ' +
      b.amount +
      '</p></div></div></div>'
    let body = ''
    let footer = ''
    if (b.closed) {
      body =
        '<div class="p-4"><div class="flex gap-3 border border-dashed p-4 text-sm">' +
        icon('lock', 'size-4 mt-0.5 text-muted-foreground') +
        '<div><p class="font-medium">' +
        b.closed +
        '</p><p class="mt-1 text-muted-foreground">30 september valt in Q3 2026. Vraag je boekhouder om het kwartaal te heropenen, of laat deze regel staan.</p></div></div></div>'
      footer =
        '<button type="button" data-action="todo" class="btn btn-outline">Overslaan</button><button type="button" class="btn btn-primary" disabled>Koppelen</button>'
    } else if (b.suggestions.length) {
      body =
        '<div class="p-4"><p class="mb-2 text-sm font-medium">' +
        (b.suggestions.length > 1 ? 'Welke hoort erbij?' : 'Hoort hierbij') +
        '</p><ul role="listbox" aria-label="Voorstellen" class="space-y-2">' +
        b.suggestions
          .map((s, i) => {
            const active = i === S.bank.cand
            return (
              '<li role="option" aria-selected="' +
              active +
              '" data-action="choose-cand" data-index="' +
              i +
              '" class="flex min-h-11 cursor-pointer items-start gap-3 border p-3 ' +
              (active ? 'border-foreground border-l-[3px] border-l-accent' : 'hover:bg-muted') +
              '"><span class="mt-0.5 flex size-4 items-center justify-center border ' +
              (active ? 'border-foreground' : '') +
              '">' +
              (active ? '<span class="size-2 bg-foreground"></span>' : '') +
              '</span><span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-2"><span class="text-sm font-medium">' +
              s.label +
              '</span><span class="text-sm tabular">€ ' +
              s.amount +
              '</span></span><span class="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>' +
              s.why +
              '</span><span class="badge ' +
              confTone[s.confidence] +
              '">' +
              s.confidence +
              '</span></span></span></li>'
            )
          })
          .join('') +
        '</ul><button type="button" data-action="todo" class="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground md:min-h-8">' +
        icon('search', 'size-3.5') +
        'Iets anders zoeken</button></div>'
      footer =
        '<button type="button" data-action="todo" class="btn btn-outline">Overslaan</button>' +
        primaryWithKey(icon('link') + 'Koppelen', 'match')
    } else if (b.rule) {
      body =
        '<div class="space-y-4 p-4"><p class="flex items-center gap-2 text-sm">' +
        icon('sparkle', 'size-4 text-muted-foreground') +
        b.rule.note +
        '</p>' +
        '<div role="radiogroup" aria-label="Soort" class="grid grid-cols-2 border"><button type="button" role="radio" aria-checked="true" class="min-h-11 bg-foreground text-sm font-medium text-background">Uitgave</button><button type="button" role="radio" aria-checked="false" class="min-h-11 border-l text-sm hover:bg-muted">Inkomst</button></div>' +
        '<div class="grid grid-cols-2 gap-3"><div><label class="text-sm font-medium">Categorie</label><button type="button" class="field mt-1.5 flex items-center justify-between text-left">' +
        b.rule.category +
        icon('chevronDown', 'size-3.5 text-muted-foreground') +
        '</button></div>' +
        '<div><label class="text-sm font-medium">Btw</label><button type="button" class="field mt-1.5 flex items-center justify-between text-left">' +
        b.rule.vat +
        icon('chevronDown', 'size-3.5 text-muted-foreground') +
        '</button></div></div>' +
        '<label class="flex min-h-11 items-center gap-2 text-sm"><span class="flex size-4 items-center justify-center bg-foreground text-background">' +
        icon('check', 'size-3') +
        '</span>We onthouden dit voor ' +
        b.counterparty +
        '</label>' +
        '<p class="text-xs text-muted-foreground tabular">Je betaalde € 171,03 plus € 15,39 btw (9%).</p></div>'
      footer =
        '<button type="button" data-action="todo" class="btn btn-outline">Overslaan</button>' +
        primaryWithKey('Boeken', 'match')
    }
    return (
      '<section aria-label="Bankregel" class="flex flex-col border bg-background ' +
      (S.bank.pane === 'panel' && !inSheet ? 'outline-2 outline-offset-2 outline-ring' : '') +
      '">' +
      header +
      body +
      '<div class="mt-auto flex flex-wrap items-center justify-end gap-2 border-t p-3">' +
      footer +
      '</div>' +
      (inSheet
        ? ''
        : '<div class="hidden px-3 pb-3 lg:block">' +
          keyStripInline([
            ['j k', 'Voorstel'],
            ['enter', 'Koppelen'],
            ['u', 'Keuze wissen'],
            ['escape', 'Terug'],
          ]) +
          '</div>') +
      '</section>'
    )
  }

  function keyStripInline(items) {
    return (
      '<div class="key-strip flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-muted-foreground">' +
      items
        .map(
          ([k, l]) =>
            '<span class="inline-flex items-center gap-1.5">' + keycaps(k) + l + '</span>',
        )
        .join('') +
      '</div>'
    )
  }

  function bankScreen() {
    const items = S.bank.items
    const cur = items[S.bank.idx]
    const table =
      '<div class="overflow-x-auto border" tabindex="-1"><table class="w-full min-w-[560px] text-sm"><thead class="bg-muted text-left text-xs text-muted-foreground"><tr>' +
      '<th class="sticky-col bg-muted px-3 py-2 font-medium">Tegenpartij</th><th class="px-3 py-2 font-medium">Datum</th><th class="px-3 py-2 text-right font-medium">Af</th><th class="px-3 py-2 text-right font-medium">Bij</th><th class="px-3 py-2 font-medium">Voorstel</th></tr></thead>' +
      '<tbody class="divide-y" data-list="bank">' +
      items
        .map((b, i) => {
          const sel = i === S.bank.idx
          const sug = b.closed
            ? '<span class="flex max-w-48 items-center gap-1 text-muted-foreground"><span class="shrink-0">' +
              icon('lock', 'size-3.5') +
              '</span><span class="truncate">' +
              b.closed +
              '</span></span>'
            : b.suggestions.length
              ? '<span class="block max-w-48 truncate"><span class="mr-1.5 inline-block size-1.5 align-middle ' +
                (b.suggestions[0].confidence === 'Zeker' ? 'bg-success' : 'bg-muted-foreground') +
                '"></span>' +
                b.suggestions[0].label +
                (b.suggestions.length > 1
                  ? ' <span class="text-muted-foreground">+' +
                    (b.suggestions.length - 1) +
                    '</span>'
                  : '') +
                '</span>'
              : b.rule
                ? '<span class="block max-w-48 truncate">' +
                  b.rule.kind +
                  ' · ' +
                  b.rule.category +
                  '</span>'
                : '<span class="text-muted-foreground">—</span>'
          return (
            '<tr data-row="' +
            b.id +
            '" data-action="select-row" data-index="' +
            i +
            '" data-fid="row-' +
            b.id +
            '" tabindex="' +
            (sel ? 0 : -1) +
            '" aria-selected="' +
            sel +
            '" class="cursor-pointer transition-opacity duration-200 ' +
            (sel ? 'bg-muted' : 'hover:bg-muted/60') +
            ' focus-visible:-outline-offset-2">' +
            '<td class="sticky-col border-l-[3px] px-3 py-3 font-medium md:whitespace-nowrap ' +
            (sel ? 'border-l-accent bg-muted' : 'border-l-transparent') +
            '">' +
            b.counterparty +
            '<span class="block max-w-48 truncate text-xs font-normal text-muted-foreground">' +
            b.description +
            '</span></td>' +
            '<td class="px-3 py-3 whitespace-nowrap text-muted-foreground tabular">' +
            b.date +
            '</td>' +
            '<td class="px-3 py-3 text-right whitespace-nowrap tabular">' +
            (b.direction === 'af' ? '€ ' + b.amount : '') +
            '</td>' +
            '<td class="px-3 py-3 text-right whitespace-nowrap tabular">' +
            (b.direction === 'bij' ? '€ ' + b.amount : '') +
            '</td>' +
            '<td class="px-3 py-3 whitespace-nowrap" data-cell="sug">' +
            sug +
            '</td></tr>'
          )
        })
        .join('') +
      '</tbody></table></div>'
    return (
      '<div class="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">' +
      pageHeader({
        eyebrow: 'Geld',
        title: 'Koppelen',
        sub: 'ING Zakelijk ··· 4821 · bijgewerkt vandaag 07:12',
        actions:
          '<p class="text-sm text-muted-foreground tabular"><span class="text-lg font-semibold text-foreground">' +
          items.length +
          '</span> te koppelen</p>',
      }) +
      '<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">' +
      '<div class="min-w-0">' +
      (items.length
        ? table
        : '<div class="border p-8 text-center text-sm text-muted-foreground">Alles is gekoppeld.</div>') +
      keyStrip([
        ['j k', 'Volgende, vorige'],
        ['enter', 'Openen'],
        ['escape', 'Lijst verlaten'],
      ]) +
      '<p class="mt-2 text-xs text-muted-foreground md:hidden">Veeg de tabel opzij voor meer kolommen. Tik op een regel om te koppelen.</p>' +
      (S.bank.matched.length
        ? '<section class="mt-6" aria-labelledby="bm-h"><h2 id="bm-h" class="mb-2 text-base">Vandaag gekoppeld <span class="text-muted-foreground tabular">' +
          S.bank.matched.length +
          '</span></h2><ul role="list" class="divide-y border text-sm">' +
          S.bank.matched
            .map(
              (m) =>
                '<li class="flex items-center gap-3 px-3 py-2.5"><span class="text-success">' +
                icon('check') +
                '</span><span class="min-w-0 flex-1 truncate">' +
                m.counterparty +
                ' <span class="text-muted-foreground">→ ' +
                m.result +
                '</span></span><span class="tabular">' +
                (m.direction === 'af' ? '− ' : '+ ') +
                '€ ' +
                m.amount +
                '</span></li>',
            )
            .join('') +
          '</ul></section>'
        : '') +
      '</div>' +
      '<div class="hidden lg:sticky lg:top-20 lg:block">' +
      bankPanel(cur, false) +
      '</div>' +
      '</div></div>'
    )
  }

  async function matchCurrent() {
    const b = S.bank.items[S.bank.idx]
    if (!b || b.closed) return
    const result = b.suggestions.length
      ? b.suggestions[S.bank.cand].label
      : b.rule.kind + ' · ' + b.rule.category
    if (S.overlay === 'bank') closeOverlay(false)
    const tr = document.querySelector('[data-row="' + b.id + '"]')
    if (tr) {
      tr.classList.add('flash-success')
      tr.querySelector('[data-cell="sug"]').innerHTML =
        '<span class="inline-flex items-center gap-1.5 font-medium text-success"><svg viewBox="0 0 24 24" class="check-draw size-4" fill="none" stroke="currentColor" stroke-width="2.25"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Gekoppeld</span>'
      await wait(420)
      tr.style.opacity = '0'
      await wait(200)
    }
    S.bank.items.splice(S.bank.idx, 1)
    S.bank.matched.unshift({ ...b, result })
    S.bank.idx = Math.min(S.bank.idx, Math.max(0, S.bank.items.length - 1))
    S.bank.cand = 0
    S.bank.pane = 'queue'
    renderMain()
    refreshChrome()
    focusRow()
    toast('Gekoppeld: ' + b.counterparty + ' → ' + result)
  }

  function focusRow() {
    const b = S.bank.items[S.bank.idx]
    if (b) {
      const el = document.querySelector('[data-fid="row-' + b.id + '"]')
      if (el) el.focus()
    }
  }

  // ------------------------------------------------------------- overlays

  function openOverlay(name) {
    S.returnFocus = document.activeElement
    S.overlay = name
    renderOverlay()
  }

  function closeOverlay(restore) {
    S.overlay = null
    renderOverlay()
    if (restore !== false && S.returnFocus && document.contains(S.returnFocus))
      S.returnFocus.focus()
  }

  function navSheet() {
    const key = 'nav'
    return (
      '<div class="fixed inset-0 z-40 md:hidden">' +
      '<div class="absolute inset-0 bg-black/40 ' +
      anim(key, 'animate-in-fade') +
      '" data-action="close-overlay"></div>' +
      '<aside role="dialog" aria-modal="true" aria-label="Menu" class="absolute inset-y-0 left-0 flex w-[86vw] max-w-80 flex-col border-r bg-sidebar text-sidebar-foreground ' +
      anim(key, 'animate-in-left') +
      '">' +
      '<div class="flex items-center justify-between pr-1">' +
      brand() +
      '<button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon" aria-label="Menu sluiten">' +
      icon('x', 'size-5') +
      '</button></div>' +
      entitySwitcher() +
      '<nav aria-label="Hoofdmenu" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">' +
      navList(true) +
      '</nav>' +
      userButton() +
      '</aside></div>'
    )
  }

  function userMenu() {
    const key = 'user'
    const dark = document.documentElement.classList.contains('dark')
    const row = (inner, action, extra) =>
      '<button type="button" role="menuitem" data-action="' +
      action +
      '" class="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none md:min-h-9 ' +
      (extra || '') +
      '">' +
      inner +
      '</button>'
    return (
      '<div class="fixed inset-0 z-50" data-action="close-overlay"></div>' +
      '<div role="menu" aria-label="Gebruikersmenu" class="fixed bottom-16 left-2 z-50 w-[calc(100vw-1rem)] max-w-72 border bg-popover text-popover-foreground ' +
      anim(key, 'animate-in-pop') +
      '">' +
      '<div class="border-b px-3 py-3"><p class="text-sm font-medium">' +
      D.entity.user.name +
      '</p><p class="text-xs text-muted-foreground">hidde@bakkerijdevries.nl · ' +
      D.entity.user.roleLabel +
      '</p></div>' +
      '<div class="py-1">' +
      '<button type="button" role="menuitemcheckbox" aria-checked="' +
      S.advanced +
      '" data-action="toggle-advanced" data-fid="adv" class="flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none">' +
      '<span class="min-w-0 flex-1"><span class="block text-sm font-medium">Geavanceerd</span><span class="block text-xs opacity-70">Toon grootboeknummers, btw-codes en boekingsregels</span></span>' +
      '<span class="mt-0.5 flex h-5 w-9 shrink-0 items-center border p-0.5 transition-colors ' +
      (S.advanced ? 'justify-end border-foreground bg-foreground' : 'justify-start border-input') +
      '"><span class="size-3.5 transition-transform ' +
      (S.advanced ? 'bg-background' : 'bg-muted-foreground') +
      '"></span></span></button>' +
      '<p class="px-3 pb-2 text-[11px] text-muted-foreground">Geen sneltoets: ook te vinden in ' +
      mod +
      ' K.</p>' +
      '</div><div class="border-t py-1">' +
      row(
        icon(dark ? 'sun' : 'moon') +
          '<span class="flex-1">' +
          (dark ? 'Licht thema' : 'Donker thema') +
          '</span>',
        'theme',
      ) +
      row(
        '<span class="w-4 text-center text-xs font-semibold">NL</span><span class="flex-1">Taal: Nederlands</span>',
        'todo',
      ) +
      row(icon('keyboard') + '<span class="flex-1">Sneltoetsen</span>' + keycaps('?'), 'help') +
      '</div><div class="border-t py-1">' +
      row(icon('logout') + '<span class="flex-1">Uitloggen</span>', 'todo') +
      '</div></div>'
    )
  }

  function paletteItems() {
    const q = S.palette.query.trim().toLowerCase()
    const actions = [
      { label: 'Nieuwe factuur', keys: 'n f', run: () => go('invoice'), icon: 'plus' },
      {
        label: 'Bonnetje toevoegen',
        keys: 'n i',
        run: () => toast('Niet in dit prototype', 'info'),
        icon: 'upload',
      },
      {
        label: S.advanced ? 'Geavanceerd uitzetten' : 'Geavanceerd aanzetten',
        hint: 'Geen sneltoets',
        run: toggleAdvanced,
        icon: 'sliders',
      },
      {
        label: document.documentElement.classList.contains('dark') ? 'Licht thema' : 'Donker thema',
        run: toggleTheme,
        icon: 'moon',
      },
      { label: 'Sneltoetsen', keys: '?', run: () => openOverlay('help'), icon: 'keyboard' },
    ]
    const nav = []
    D.navigation.forEach((g) =>
      g.items
        .filter((i) => !i.adv || S.advanced)
        .forEach((i) =>
          nav.push({
            label: (S.advanced && i.advLabel) || i.label,
            group: g.label,
            keys: i.keys,
            run: () => (i.route ? go(i.route) : toast('Niet in dit prototype', 'info')),
            icon: 'arrowRight',
          }),
        ),
    )
    const match = (x) =>
      !q || x.label.toLowerCase().includes(q) || (x.group || '').toLowerCase().includes(q)
    const groups = [
      ['Acties', actions.filter(match)],
      ['Navigatie', nav.filter(match).slice(0, q ? 8 : 6)],
    ]
    if (q.length >= 2) {
      const content = [
        {
          label: 'Hotel Zeezicht B.V.',
          group: 'Klant',
          run: () => toast('Niet in dit prototype', 'info'),
          icon: 'user',
        },
        {
          label: 'Factuur 2026-0131 · Hotel Zeezicht',
          group: 'Verkoopfactuur',
          run: () => toast('Niet in dit prototype', 'info'),
          icon: 'file',
        },
        {
          label: 'Shipton Mill Ltd',
          group: 'Leverancier',
          run: () => toast('Niet in dit prototype', 'info'),
          icon: 'user',
        },
      ].filter((x) => x.label.toLowerCase().includes(q) || x.group.toLowerCase().includes(q))
      groups.push(['Inhoud', content])
    }
    return groups.filter(([, items]) => items.length)
  }

  function paletteHtml() {
    const key = 'palette'
    const groups = paletteItems()
    let n = 0
    const list = groups
      .map(
        ([title, items]) =>
          '<div role="group" aria-label="' +
          title +
          '"><p class="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">' +
          title +
          '</p>' +
          items
            .map((it) => {
              const i = n++
              const active = i === S.palette.active
              return (
                '<div role="option" id="pal-' +
                i +
                '" aria-selected="' +
                active +
                '" data-action="palette-run" data-index="' +
                i +
                '" class="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm md:min-h-9 ' +
                (active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted') +
                '">' +
                icon(it.icon, 'size-4 opacity-70') +
                '<span class="flex-1">' +
                it.label +
                (it.group && title !== 'Acties'
                  ? ' <span class="' +
                    (active ? 'opacity-70' : 'text-muted-foreground') +
                    '">· ' +
                    it.group +
                    '</span>'
                  : '') +
                '</span>' +
                (it.hint
                  ? '<span class="text-xs ' +
                    (active ? 'opacity-70' : 'text-muted-foreground') +
                    '">' +
                    it.hint +
                    '</span>'
                  : '') +
                keycaps(it.keys) +
                '</div>'
              )
            })
            .join('') +
          '</div>',
      )
      .join('')
    return (
      '<div class="fixed inset-0 z-50 flex items-start justify-center px-2 pt-2 md:pt-[12vh]">' +
      '<div class="absolute inset-0 bg-black/40 ' +
      anim(key, 'animate-in-fade') +
      '" data-action="close-overlay"></div>' +
      '<div role="dialog" aria-modal="true" aria-label="Zoeken en opdrachten" class="relative w-full max-w-xl border bg-popover ' +
      anim(key, 'animate-in-pop') +
      '">' +
      '<div class="flex items-center gap-2 border-b px-3">' +
      icon('search', 'size-4 text-muted-foreground') +
      '<input id="pal-q" data-fid="pal-q" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant="pal-' +
      S.palette.active +
      '" autocomplete="off" class="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm" placeholder="Zoek een scherm, opdracht, klant of factuur" value="' +
      esc(S.palette.query) +
      '">' +
      '<kbd class="keycap">Esc</kbd></div>' +
      '<div id="pal-list" role="listbox" class="max-h-[60vh] overflow-y-auto pb-2">' +
      (list ||
        '<p class="px-3 py-6 text-center text-sm text-muted-foreground">Niets gevonden.</p>') +
      '</div>' +
      '<div class="hidden items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground md:flex"><span class="inline-flex items-center gap-1.5">' +
      keycaps('up down') +
      'Kiezen</span><span class="inline-flex items-center gap-1.5">' +
      keycaps('enter') +
      'Openen</span><span class="ml-auto">Vanaf 2 tekens zoeken we ook in je administratie</span></div>' +
      '</div></div>'
    )
  }

  function helpDialog() {
    const key = 'help'
    const rows = [
      [
        'Overal',
        [
          ['mod K', 'Zoeken en opdrachten'],
          ['?', 'Deze sneltoetsen'],
          ['g d', 'Naar dashboard'],
          ['g o', 'Naar koppelen'],
          ['i m', 'Naar Moneybird'],
          ['n f', 'Nieuwe factuur'],
          ['escape', 'Sluiten'],
        ],
      ],
      [
        'Lijsten en bevindingen',
        [
          ['j k', 'Volgende, vorige'],
          ['enter', 'Openen of oplossen'],
          ['escape', 'Sluiten, dan lijst verlaten'],
        ],
      ],
      [
        'Koppelen',
        [
          ['enter', 'Paneel openen, dan koppelen'],
          ['u', 'Keuze wissen'],
        ],
      ],
    ]
    return (
      '<div class="fixed inset-0 z-50 flex items-start justify-center px-2 pt-2 md:pt-[10vh]"><div class="absolute inset-0 bg-black/40 ' +
      anim(key, 'animate-in-fade') +
      '" data-action="close-overlay"></div>' +
      '<section role="dialog" aria-modal="true" aria-labelledby="help-t" class="relative w-full max-w-lg border bg-popover p-5 ' +
      anim(key, 'animate-in-pop') +
      '"><div class="flex items-center justify-between"><h2 id="help-t" class="text-lg">Sneltoetsen</h2><button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon" aria-label="Sluiten">' +
      icon('x', 'size-5') +
      '</button></div>' +
      rows
        .map(
          ([t, ks]) =>
            '<h3 class="mt-4 mb-1 text-xs font-medium text-muted-foreground uppercase">' +
            t +
            '</h3><dl class="divide-y text-sm">' +
            ks
              .map(
                ([k, l]) =>
                  '<div class="flex items-center justify-between py-1.5"><dt>' +
                  l +
                  '</dt><dd>' +
                  keycaps(k, '!inline-flex') +
                  '</dd></div>',
              )
              .join('') +
            '</dl>',
        )
        .join('') +
      '<p class="mt-4 text-xs text-muted-foreground">Geavanceerd heeft bewust geen sneltoets: hoofdletters zijn voor typen-om-te-zoeken in tabellen. Je vindt het in je gebruikersmenu en in ' +
      mod +
      ' K.</p></section></div>'
    )
  }

  function renderOverlay() {
    let html = ''
    const key = S.overlay === 'fix' ? 'fix-' + S.fixId : S.overlay
    if (S.overlay === 'nav') html = navSheet()
    else if (S.overlay === 'user') html = userMenu()
    else if (S.overlay === 'palette') html = paletteHtml()
    else if (S.overlay === 'help') html = helpDialog()
    else if (S.overlay === 'confirm') html = confirmDialog()
    else if (S.overlay === 'fix') {
      const f = S.findings.find((x) => x.id === S.fixId)
      if (f) html = f.fix.sheet === 'fx' ? fxSheet(f) : accountSheet(f)
    } else if (S.overlay === 'bank') {
      const b = S.bank.items[S.bank.idx]
      html =
        '<div class="fixed inset-0 z-40 lg:hidden"><div class="absolute inset-0 bg-black/40 ' +
        anim(key, 'animate-in-fade') +
        '" data-action="close-overlay"></div>' +
        '<div role="dialog" aria-modal="true" aria-label="Bankregel koppelen" class="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto ' +
        anim(key, 'animate-in-up') +
        '"><div class="flex justify-end border-t bg-background"><button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon" aria-label="Sluiten">' +
        icon('x', 'size-5') +
        '</button></div>' +
        bankPanel(b, true) +
        '</div></div>'
    }
    overlayRoot.innerHTML = html
    document.body.style.overflow = S.overlay && S.overlay !== 'user' ? 'hidden' : ''
    S.lastOverlayKey = S.overlay ? key : null
    // Mirror aria-expanded on the triggers without re-rendering the shell.
    document
      .querySelectorAll('[data-action="user-menu"]')
      .forEach((b) => b.setAttribute('aria-expanded', String(S.overlay === 'user')))
    document
      .querySelectorAll('[data-action="nav"]')
      .forEach((b) => b.setAttribute('aria-expanded', String(S.overlay === 'nav')))
    if (S.overlay === 'fix') bindFx()
    const focusTarget = { palette: 'pal-q', user: 'adv' }[S.overlay]
    if (focusTarget) overlayRoot.querySelector('[data-fid="' + focusTarget + '"]').focus()
    if (S.overlay === 'fix') {
      const el = overlayRoot.querySelector('#acc-q, #fx-rate')
      if (el && !S.params.has('fix')) el.focus()
    }
    if (S.overlay === 'confirm') overlayRoot.querySelector('[data-action="inv-confirm"]').focus()
    if (S.overlay === 'nav') {
      const cur = overlayRoot.querySelector('[aria-current="page"]')
      if (cur) cur.focus({ preventScroll: true })
      if (S.params.get('navscroll') === '1') overlayRoot.querySelector('nav').scrollTop = 9999
    }
  }

  // --------------------------------------------------------------- toggles

  function toggleTheme() {
    const dark = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('klopt-proto-theme', dark ? 'dark' : 'light')
    const reopen = S.overlay
    renderShell()
    if (reopen === 'user' || reopen === 'nav') renderOverlay()
    else if (reopen) closeOverlay(false)
  }

  function toggleAdvanced() {
    S.advanced = !S.advanced
    renderShell()
    if (S.overlay === 'user') renderOverlay()
    else closeOverlay(false)
    toast(
      'Geavanceerd staat ' +
        (S.advanced ? 'aan. Je ziet nu grootboeknummers en btw-codes.' : 'uit.'),
      'info',
    )
  }

  // ----------------------------------------------------------------- events

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]')
    if (!el) return
    const a = el.dataset.action
    const id = el.dataset.id
    const idx = Number(el.dataset.index)
    if (a === 'todo') {
      e.preventDefault()
      toast('Dit scherm zit niet in het prototype.', 'info')
    } else if (a === 'nav') openOverlay('nav')
    else if (a === 'palette') {
      S.palette = { query: '', active: 0 }
      openOverlay('palette')
    } else if (a === 'user-menu') S.overlay === 'user' ? closeOverlay() : openOverlay('user')
    else if (a === 'help') openOverlay('help')
    else if (a === 'theme') toggleTheme()
    else if (a === 'toggle-advanced') toggleAdvanced()
    else if (a === 'close-overlay') closeOverlay()
    else if (a === 'select-finding') {
      if (e.target.closest('button, a')) return
      S.findingIdx = S.findings.findIndex((f) => f.id === id)
      renderMain()
      focusFinding()
    } else if (a === 'open-fix' || a === 'one-click') openFix(S.findings.find((f) => f.id === id))
    else if (a === 'apply') resolveFinding(id)
    else if (a === 'close-preview') {
      S.previewOpen = null
      renderMain()
      focusFinding()
    } else if (a === 'save-fix') resolveFinding(S.fixId)
    else if (a === 'choose-account') {
      const opts = filteredAccounts()
      S.picker.chosen = D.accountOptions.indexOf(opts[idx])
      S.picker.active = idx
      renderOverlay()
      overlayRoot.querySelector('[data-fid="vat-' + S.picker.vat + '"]').focus()
    } else if (a === 'choose-vat') {
      S.picker.vat = el.dataset.code
      renderOverlay()
      overlayRoot.querySelector('[data-fid="vat-' + S.picker.vat + '"]').focus()
    } else if (a === 'fx-reset') {
      S.fx = { rate: D.fx.ecb.rate, source: 'ecb' }
      document.getElementById('fx-rate').value = D.fx.ecb.rate.replace('.', ',')
      updateFx()
    } else if (a === 'choose-customer') {
      S.invoice.customer = id
      S.invoice.customerActive = filteredCustomers().findIndex((c) => c.id === id)
      renderMain()
    } else if (a === 'inv-next') invNext()
    else if (a === 'inv-back') invBack()
    else if (a === 'inv-send') {
      S.invoice.send = id
      renderMain()
    } else if (a === 'inv-confirm') {
      closeOverlay(false)
      S.invoice.done = true
      renderMain()
    } else if (a === 'select-row') {
      S.bank.idx = idx
      S.bank.cand = 0
      renderMain()
      focusRow()
      if (window.innerWidth < 1024) {
        S.bank.pane = 'panel'
        openOverlay('bank')
      }
    } else if (a === 'choose-cand') {
      S.bank.cand = idx
      if (S.overlay === 'bank') renderOverlay()
      else renderMain()
    } else if (a === 'match') matchCurrent()
    else if (a === 'palette-run') runPalette(idx)
  })

  document.addEventListener('input', (e) => {
    if (e.target.id === 'acc-q') {
      S.picker.query = e.target.value
      S.picker.active = 0
      document.getElementById('acc-list').innerHTML = accountOptionsHtml()
    } else if (e.target.id === 'cust-q') {
      S.invoice.query = e.target.value
      S.invoice.customerActive = 0
      const first = filteredCustomers()[0]
      if (first) S.invoice.customer = first.id
      renderMain()
      const inp = document.getElementById('cust-q')
      inp.focus()
      inp.setSelectionRange(inp.value.length, inp.value.length)
    } else if (e.target.id === 'pal-q') {
      S.palette.query = e.target.value
      S.palette.active = 0
      const list = overlayRoot.querySelector('#pal-list')
      const tmp = document.createElement('div')
      S.lastOverlayKey = 'palette'
      tmp.innerHTML = paletteHtml()
      list.innerHTML = tmp.querySelector('#pal-list').innerHTML
    }
  })

  function runPalette(i) {
    const flat = paletteItems().flatMap(([, items]) => items)
    const it = flat[i]
    if (!it) return
    closeOverlay(false)
    it.run()
  }

  function invNext() {
    if (S.invoice.step < 4) {
      S.invoice.step++
      renderMain()
      document.getElementById('main').focus()
    } else openOverlay('confirm')
  }
  function invBack() {
    if (S.invoice.step > 1) {
      S.invoice.step--
      renderMain()
    } else go('dashboard')
  }

  let prefix = null
  let prefixTimer = null
  const CHORDS = {
    'g d': 'dashboard',
    'g o': 'bank',
    'g f': 'invoice',
    'i m': 'findings',
    'n f': 'invoice',
  }

  const isTyping = (el) =>
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)

  document.addEventListener('keydown', (e) => {
    const k = e.key
    const typing = isTyping(e.target)

    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k') {
      e.preventDefault()
      if (S.overlay === 'palette') closeOverlay()
      else {
        S.palette = { query: '', active: 0 }
        openOverlay('palette')
      }
      return
    }

    if (S.overlay === 'palette') {
      const total = paletteItems().flatMap(([, i]) => i).length
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault()
        S.palette.active = (S.palette.active + (k === 'ArrowDown' ? 1 : -1) + total) % total
        const q = S.palette.query
        renderOverlay()
        const inp = overlayRoot.querySelector('#pal-q')
        inp.value = q
        inp.setSelectionRange(q.length, q.length)
        const act = overlayRoot.querySelector('#pal-' + S.palette.active)
        if (act) act.scrollIntoView({ block: 'nearest' })
      } else if (k === 'Enter') {
        e.preventDefault()
        runPalette(S.palette.active)
      } else if (k === 'Escape') closeOverlay()
      return
    }

    if (k === 'Escape') {
      if (S.overlay) {
        e.preventDefault()
        closeOverlay()
        return
      }
      if (S.previewOpen) {
        S.previewOpen = null
        renderMain()
        focusFinding()
        return
      }
      if (S.route === 'bank' && S.bank.pane === 'panel') {
        S.bank.pane = 'queue'
        renderMain()
        focusRow()
        return
      }
      if (S.route === 'invoice' && !typing) {
        invBack()
        return
      }
      if (document.activeElement && document.activeElement !== document.body)
        document.activeElement.blur()
      return
    }

    // Account picker
    if (S.overlay === 'fix' && e.target.id === 'acc-q') {
      const n = filteredAccounts().length
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault()
        S.picker.active = (S.picker.active + (k === 'ArrowDown' ? 1 : -1) + n) % n
        document.getElementById('acc-list').innerHTML = accountOptionsHtml()
        e.target.setAttribute('aria-activedescendant', 'acc-' + S.picker.active)
      } else if (k === 'Enter' || k === 'Tab') {
        if (!n) return
        e.preventDefault()
        S.picker.chosen = D.accountOptions.indexOf(filteredAccounts()[S.picker.active])
        const q = S.picker.query
        renderOverlay()
        overlayRoot.querySelector('#acc-q').value = q
        overlayRoot.querySelector('[data-fid="vat-' + S.picker.vat + '"]').focus()
      }
      return
    }
    if (S.overlay === 'fix' && e.target.getAttribute('role') === 'radio') {
      const codes = D.vatOptions.map((v) => v.code)
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault()
        const i =
          (codes.indexOf(S.picker.vat) + (k === 'ArrowRight' ? 1 : -1) + codes.length) %
          codes.length
        S.picker.vat = codes[i]
        renderOverlay()
        overlayRoot.querySelector('[data-fid="vat-' + S.picker.vat + '"]').focus()
        return
      }
    }
    if (S.overlay === 'fix' && k === 'Enter') {
      if (e.target.tagName === 'BUTTON' && e.target.getAttribute('role') !== 'radio') return
      e.preventDefault()
      resolveFinding(S.fixId)
      return
    }
    if (
      S.overlay === 'confirm' ||
      S.overlay === 'help' ||
      S.overlay === 'user' ||
      S.overlay === 'nav'
    )
      return

    if (typing) {
      if (S.route === 'invoice' && k === 'Enter' && e.target.id === 'cust-q') {
        e.preventDefault()
        invNext()
      }
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (k === '?') {
      openOverlay('help')
      return
    }

    // Prefix chords: g, i, n — 1.5 s window, as in the registry.
    if (prefix) {
      const route = CHORDS[prefix + ' ' + k]
      prefix = null
      clearTimeout(prefixTimer)
      if (route) {
        e.preventDefault()
        go(route)
      } else toast('Dit scherm zit niet in het prototype.', 'info')
      return
    }
    if (k === 'g' || k === 'i' || k === 'n') {
      prefix = k
      prefixTimer = setTimeout(() => (prefix = null), 1500)
      return
    }

    const onButton =
      e.target.tagName === 'BUTTON' ||
      (e.target.tagName === 'A' && !e.target.closest('[data-list="dash"]'))

    if (S.route === 'findings' && S.findings.length) {
      if (k === 'j' || k === 'ArrowDown' || k === 'k' || k === 'ArrowUp') {
        e.preventDefault()
        const d = k === 'j' || k === 'ArrowDown' ? 1 : -1
        S.findingIdx = Math.min(S.findings.length - 1, Math.max(0, S.findingIdx + d))
        S.previewOpen = null
        renderMain()
        focusFinding()
      } else if (k === 'Enter' && !onButton) {
        e.preventDefault()
        if (S.previewOpen) resolveFinding(S.previewOpen)
        else openFix(S.findings[S.findingIdx])
      }
    } else if (S.route === 'dashboard') {
      if (k === 'j' || k === 'ArrowDown' || k === 'k' || k === 'ArrowUp') {
        e.preventDefault()
        const d = k === 'j' || k === 'ArrowDown' ? 1 : -1
        S.dashIdx = Math.min(D.dashboard.attention.length - 1, Math.max(0, S.dashIdx + d))
        document
          .querySelectorAll('[data-list="dash"] a')
          .forEach((a, i) => a.setAttribute('tabindex', i === S.dashIdx ? '0' : '-1'))
        document.querySelector('[data-fid="dash-' + S.dashIdx + '"]').focus()
      }
    } else if (S.route === 'bank' && S.bank.items.length) {
      const b = S.bank.items[S.bank.idx]
      const down = k === 'j' || k === 'ArrowDown'
      const up = k === 'k' || k === 'ArrowUp'
      if (down || up) {
        e.preventDefault()
        if (S.bank.pane === 'panel') {
          const n = b.suggestions.length || 1
          S.bank.cand = Math.min(n - 1, Math.max(0, S.bank.cand + (down ? 1 : -1)))
        } else {
          S.bank.idx = Math.min(S.bank.items.length - 1, Math.max(0, S.bank.idx + (down ? 1 : -1)))
          S.bank.cand = 0
        }
        renderMain()
        if (S.bank.pane === 'queue') focusRow()
      } else if (k === 'Enter' && !onButton) {
        e.preventDefault()
        if (S.bank.pane === 'queue') {
          S.bank.pane = 'panel'
          renderMain()
          if (window.innerWidth < 1024) openOverlay('bank')
        } else matchCurrent()
      } else if (k === 'u' && S.bank.pane === 'panel') {
        S.bank.cand = 0
        renderMain()
      }
    } else if (S.route === 'invoice' && k === 'Enter' && !onButton && !S.invoice.done) {
      e.preventDefault()
      invNext()
    }
  })

  window.addEventListener('hashchange', () => {
    S.previewOpen = null
    S.fixId = null
    if (S.route !== 'invoice')
      S.invoice = {
        step: 1,
        customer: 'c1',
        customerActive: 0,
        query: '',
        send: 'email',
        done: false,
      }
    readHash()
    renderShell()
    renderOverlay()
    document.getElementById('main').focus({ preventScroll: true })
    window.scrollTo(0, 0)
  })

  readHash()
  renderShell()
  renderOverlay()
  if (S.params.has('toast')) toast(S.params.get('toast'))
  if (S.route === 'findings' && !S.overlay && !S.params.has('nofocus')) {
    focusFinding.quiet = true
    focusFinding()
    focusFinding.quiet = false
  }
})()
