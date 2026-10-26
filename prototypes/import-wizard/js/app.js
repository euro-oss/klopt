/* global KLOPT, icon */
;(function () {
  'use strict'

  const D = KLOPT
  const root = document.getElementById('app')
  const overlayRoot = document.getElementById('overlay')
  const toastRoot = document.getElementById('toast')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl'

  // ---------------------------------------------------------------- state

  const S = {
    idx: 0,
    src: 'moneybird',
    adv: false,
    p: new URLSearchParams(),
    overlay: null,
    sheetFor: null,
    dir: 'fwd',
    lastIdx: null,
    returnFocus: null,
    rates: [],
    accounts: [],
    contactFixed: false,
    problems: [],
    busy: null,
    takeover: [],
    pct: 61,
    timer: null,
  }

  function resetData() {
    S.rates = D.rates.map((r) => ({ ...r }))
    S.accounts = D.accounts.map((a) => ({ ...a }))
    S.problems = D.problems.map((x) => ({ ...x, done: null }))
    S.takeover = D.exactTakeover.map((t) => ({ ...t }))
    S.contactFixed = false
  }
  resetData()

  // ------------------------------------------------------------- helpers

  const NBSP = '\u00a0'
  const nf = (n) => Number(n).toLocaleString('nl-NL')

  function keycaps(keys, extra) {
    if (!keys) return ''
    const labels = { enter: '↵', escape: 'Esc', mod: mod, up: '↑', down: '↓' }
    return `<span class="hidden items-center gap-0.5 md:inline-flex ${extra || ''}">${keys
      .split(' ')
      .map((k) => `<kbd class="keycap">${labels[k] || k}</kbd>`)
      .join('')}</span>`
  }
  const onPrimary =
    'ml-1 [&_.keycap]:bg-transparent [&_.keycap]:text-primary-foreground/80 [&_.keycap]:border-primary-foreground/30'

  function badge(tone, text, ic) {
    return `<span class="badge badge-${tone}">${ic ? icon(ic, 'size-3') : ''}${text}</span>`
  }

  function note(title, text) {
    return `<aside class="design-note" aria-label="Ontwerpnotitie"><p class="mb-1"><b>${title}</b></p><p>${text}</p></aside>`
  }

  function hrefFor(stepId, extra) {
    const q = new URLSearchParams()
    if (S.src !== 'moneybird') q.set('src', S.src)
    if (S.adv) q.set('adv', '1')
    const t = S.p.get('theme')
    if (t) q.set('theme', t)
    if (S.p.get('proto') === '0') q.set('proto', '0')
    if (extra) Object.entries(extra).forEach(([k, v]) => q.set(k, v))
    const s = q.toString()
    return '#/' + stepId + (s ? '?' + s : '')
  }

  function goStep(i, extra) {
    S.dir = i < S.idx ? 'back' : 'fwd'
    location.hash = hrefFor(D.steps[i].id, extra)
  }

  function toast(message, opts) {
    const o = opts || {}
    const tone = o.tone || 'success'
    const ic =
      tone === 'success'
        ? '<svg viewBox="0 0 24 24" class="check-draw size-5" fill="none" stroke="currentColor" stroke-width="2.25"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
        : icon('info', 'size-5')
    toastRoot.innerHTML = `<div role="status" class="animate-in-up fixed inset-x-4 bottom-24 z-[60] flex items-center gap-3 border bg-background p-3 text-sm md:inset-x-auto md:right-6 md:bottom-28 md:min-w-80">
      <span class="flex size-6 items-center justify-center ${tone === 'success' ? 'text-success' : 'text-info'}">${ic}</span>
      <span class="min-w-0 flex-1 tabular">${message}</span>
      ${o.undo ? `<button type="button" data-action="${o.undo}" class="btn btn-ghost -my-1 -mr-1 underline underline-offset-4">${icon('undo')}Ongedaan maken</button>` : ''}
    </div>`
    clearTimeout(toast.timer)
    if (!S.p.has('toast')) toast.timer = setTimeout(() => (toastRoot.innerHTML = ''), 5000)
  }

  const isMb = () => S.src === 'moneybird'
  const srcLabel = () => D.sources[S.src].label

  // ------------------------------------------------------------- routing

  function readHash() {
    const raw = location.hash.replace(/^#\/?/, '')
    const [path, query] = raw.split('?')
    const i = D.steps.findIndex((s) => s.id === path)
    const nextIdx = i < 0 ? 0 : i
    S.dir = nextIdx < S.idx ? 'back' : 'fwd'
    S.idx = nextIdx
    S.p = new URLSearchParams(query || '')
    const p = S.p
    S.src = p.get('src') === 'exact' ? 'exact' : 'moneybird'
    S.adv = p.get('adv') === '1'
    const theme = p.get('theme') || localStorage.getItem('klopt-proto-theme') || 'light'
    document.documentElement.classList.toggle('dark', theme === 'dark')

    resetData()
    if (p.get('excluded') === '1') S.rates.find((r) => r.id === 'r7').state = 'excluded'
    S.busy = p.get('busy')
    S.overlay = null
    S.sheetFor = null
    if (p.get('confirm')) S.overlay = 'confirm-' + p.get('confirm')
    if (p.get('sheet')) {
      S.overlay = 'sheet'
      S.sheetFor = p.get('sheet')
    }
    if (p.get('menu') === '1') S.overlay = 'steps'
    // Later steps assume the earlier ones are done.
    if (S.idx > 4)
      S.rates.forEach((r) => {
        if (r.state === 'suggested' || r.state === 'choose') {
          r.state = 'confirmed'
          if (!r.code) Object.assign(r, r.candidates[0])
        }
        if (r.state === 'none') r.state = 'excluded'
      })
    if (S.idx > 5) {
      S.accounts.forEach((a) => {
        if (a.state === 'suggest' || a.state === 'derived') a.state = 'ok'
        if (a.state === 'new') a.state = 'created'
      })
      S.contactFixed = true
      S.takeover.forEach((t) => {
        if (!t.value)
          Object.assign(t, {
            value: '0900 Tussenrekening beginbalans',
            plain: 'Tussenrekening beginbalans',
          })
      })
    }
    if (S.idx > 6)
      S.problems.forEach((x) => {
        if (x.severity === 'blocking') x.done = x.fix === 'exclude' ? 'excluded' : 'resolved'
      })
    if (p.get('resolved') === '1')
      S.problems.forEach((x) => {
        if (x.severity === 'blocking') x.done = x.fix === 'exclude' ? 'excluded' : 'resolved'
      })
    S.pct = p.has('pct') ? Number(p.get('pct')) : 0
  }

  // ---------------------------------------------------------------- shell

  function brand() {
    return `<div class="flex h-12 items-center gap-2 px-4"><span class="flex size-6 items-center justify-center bg-accent text-[13px] font-bold text-accent-foreground">K</span><span class="text-[15px] font-semibold tracking-tight">Klopt</span></div>`
  }

  function entitySwitcher() {
    return `<button type="button" data-action="todo" class="mx-2 mb-2 flex min-h-11 w-[calc(100%-1rem)] items-center gap-2 border border-sidebar-border bg-background px-3 py-1.5 text-left md:min-h-0">
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${D.entity.name}</span><span class="block text-xs text-muted-foreground tabular">Boekjaar ${D.entity.fiscalYear} · ${D.entity.fiscalYearRange}</span></span>${icon('chevronDown', 'size-4 text-muted-foreground')}</button>`
  }

  function navList(mobile) {
    return D.navigation
      .map((g) => {
        const items = g.items.filter((i) => !i.adv || S.adv)
        return `<div class="${g.label ? 'mt-2' : 'mt-0.5'}">${g.label ? `<p class="px-3 pb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">${g.label}</p>` : ''}<ul role="list">${items
          .map((it) => {
            const current = it.source && it.source === S.src
            const label = S.adv && it.advLabel ? it.advLabel : it.label
            const href = it.source ? `#/bron${it.source === 'exact' ? '?src=exact' : ''}` : '#'
            return `<li><a href="${href}" ${it.source ? '' : 'data-action="todo"'} ${current ? 'aria-current="page"' : ''} class="flex items-center gap-2 border-l-[3px] px-3 text-sm ${mobile ? 'min-h-11' : 'h-7'} ${current ? 'border-accent bg-background font-medium' : 'border-transparent text-sidebar-foreground/85 hover:bg-background/70'}"><span class="min-w-0 flex-1 truncate">${label}</span>${it.count ? `<span class="inline-flex h-5 min-w-5 items-center justify-center border border-sidebar-border bg-background px-1 text-[11px] font-medium tabular">${it.count}</span>` : ''}${mobile ? '' : keycaps(it.keys)}</a></li>`
          })
          .join('')}</ul></div>`
      })
      .join('')
  }

  function userButton() {
    return `<div class="border-t border-sidebar-border p-2"><button type="button" data-action="todo" class="flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-background/70 md:min-h-0">
      <span class="flex size-7 items-center justify-center bg-foreground text-xs font-semibold text-background">${D.entity.user.initials}</span>
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${D.entity.user.name}</span><span class="block text-xs text-muted-foreground">${D.entity.user.roleLabel} · Geavanceerd ${S.adv ? 'aan' : 'uit'}</span></span>${icon('chevronDown', 'size-4 -rotate-90 text-muted-foreground')}</button></div>`
  }

  function themeButton() {
    const dark = document.documentElement.classList.contains('dark')
    return `<button type="button" data-action="theme" class="btn btn-ghost btn-icon" aria-label="${dark ? 'Licht thema' : 'Donker thema'}">${icon(dark ? 'sun' : 'moon', 'size-[18px]')}</button>`
  }

  function topbar() {
    return `<header class="sticky top-0 z-30 flex h-12 items-center gap-1 border-b bg-background px-1 md:hidden">
        <button type="button" data-action="todo" class="btn btn-ghost btn-icon" aria-label="Menu openen">${icon('menu', 'size-5')}</button>
        <span class="min-w-0 flex-1 truncate text-[15px] font-medium">${srcLabel()} importeren</span>
        <button type="button" data-action="todo" class="btn btn-ghost btn-icon" aria-label="Zoeken">${icon('search', 'size-[18px]')}</button>${themeButton()}
      </header>
      <header class="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b bg-background px-8 md:flex">
        <nav aria-label="Kruimelpad" class="flex min-w-0 flex-1 items-center gap-1.5 text-sm"><span class="text-muted-foreground">Importeren</span>${icon('chevronRight', 'size-3.5 text-muted-foreground')}<span class="font-medium">${srcLabel()}</span></nav>
        <button type="button" data-action="todo" class="flex h-9 w-72 items-center gap-2 border border-input px-3 text-sm text-muted-foreground hover:bg-muted">${icon('search')}<span class="flex-1 text-left">Zoeken of opdracht</span>${keycaps('mod K')}</button>${themeButton()}
      </header>`
  }

  // Mock controls: outside the product, dashed, monospace. ?proto=0 hides it.
  const STATES = {
    bron: [
      ['Standaard', {}],
      ['Verder waar je was', { resume: '1' }],
      ['Opnieuw beginnen?', { resume: '1', confirm: 'restart' }],
    ],
    verbinden: {
      moneybird: [
        ['Leeg', {}],
        ['Fout token', { state: 'error' }],
        ['Verbonden', { state: 'connected' }],
        ['Verbreken?', { state: 'connected', confirm: 'disconnect' }],
      ],
      exact: [
        ['Standaard', {}],
        ['Geen sleutel', { state: 'nokey' }],
      ],
    },
    voorbeeld: [
      ['Lezen', { state: 'reading' }],
      ['Resultaat', {}],
    ],
    btw: {
      moneybird: [
        ['Standaard', {}],
        ['Niet overzetten', { excluded: '1', toast: '1' }],
        ['Tarief kiezen', { sheet: 'r5' }],
        ['Terug na pauze', { resumed: '1' }],
      ],
      exact: [['Standaard', {}]],
    },
    problemen: [
      ['Standaard', {}],
      ['Opnieuw lezen bezig', { busy: 'p-nif' }],
      ['Koers kiezen', { sheet: 'fx' }],
      ['Alles opgelost', { resolved: '1' }],
    ],
    overzicht: [
      ['Standaard', {}],
      ['Bevestigen', { confirm: 'import' }],
    ],
    importeren: [
      ['Bezig', { pct: '61' }],
      ['Live', {}],
      ['Geweigerd', { state: 'refused' }],
    ],
    klaar: [
      ['Met blokkade', {}],
      ['Zonder blokkade', { state: 'clean' }],
    ],
  }

  function protoBar() {
    if (S.p.get('proto') === '0') return ''
    const stepId = D.steps[S.idx].id
    let states = STATES[stepId] || []
    if (!Array.isArray(states)) states = states[S.src]
    const cur = S.p.toString()
    const link = (label, extra) => {
      const h = hrefFor(stepId, extra)
      const q = h.split('?')[1] || ''
      const strip = (s) => new URLSearchParams(s)
      const a = strip(q)
      const b = strip(cur)
      ;['theme', 'proto'].forEach((k) => (a.delete(k), b.delete(k)))
      const active = a.toString() === b.toString()
      return `<a href="${h}" class="inline-flex min-h-11 shrink-0 items-center px-1.5 md:min-h-7 ${active ? 'text-foreground underline underline-offset-4' : 'hover:text-foreground'}">${label}</a>`
    }
    const srcBtn = (s, label) =>
      `<a href="${(() => {
        const keep = S.src
        S.src = s
        const h = hrefFor(stepId)
        S.src = keep
        return h
      })()}" class="inline-flex min-h-11 shrink-0 items-center px-2 md:min-h-7 ${S.src === s ? 'bg-foreground text-background' : 'hover:text-foreground'}">${label}</a>`
    return `<div class="proto-bar flex items-center gap-2 overflow-x-auto px-4 text-muted-foreground md:px-8" aria-label="Mock-bediening (geen onderdeel van de app)">
      <span class="shrink-0 font-semibold text-foreground">Mock</span>
      <label class="flex shrink-0 items-center gap-1"><span class="sr-only">Stap</span><select data-action="proto-step" class="h-7 border border-dashed border-muted-foreground bg-background px-1 text-xs">${D.steps
        .map(
          (s, i) =>
            `<option value="${i}" ${i === S.idx ? 'selected' : ''}>${i + 1}. ${s.short}</option>`,
        )
        .join('')}</select></label>
      <span class="flex shrink-0 border border-dashed border-muted-foreground">${srcBtn('moneybird', 'Moneybird')}${srcBtn('exact', 'Exact')}</span>
      ${states.length ? '<span class="shrink-0">·</span>' + states.map(([l, e]) => link(l, e)).join('') : ''}
    </div>`
  }

  // -------------------------------------------------------------- counts

  const rateLeft = () =>
    S.rates.filter((r) => ['suggested', 'choose', 'none'].includes(r.state)).length
  const accLeft = () =>
    S.accounts.filter((a) => ['suggest', 'derived', 'new'].includes(a.state)).length +
    (S.contactFixed ? 0 : 1)
  const blockingLeft = () => S.problems.filter((x) => x.severity === 'blocking' && !x.done).length
  const takeoverLeft = () => S.takeover.filter((t) => !t.value).length
  const excludedRate = () => S.rates.find((r) => r.id === 'r7').state === 'excluded'

  const plural = (n, one, many) => `${nf(n)}${NBSP}${n === 1 ? one : many}`

  // ------------------------------------------------------------ the rail

  function railSub(i) {
    const mb = isMb()
    return [
      srcLabel(),
      'Verbonden',
      mb ? '2025 en 2026' : 'Boekjaar 2026',
      mb ? '542 documenten gelezen' : '312 rekeningen, 47 posten',
      mb ? '7 tarieven' : '5 van 7 herkend',
      mb ? '8 rekeningen, 186 relaties' : '4 rekeningen gekozen',
      'Niets blokkeert meer',
      'Nagekeken',
      'Klaar',
      '',
    ][i]
  }

  function railItem(s, i, mobile) {
    const state = i < S.idx ? 'done' : i === S.idx ? 'current' : 'todo'
    let count = 0
    let tone = ''
    if (i === 4 && isMb() && state === 'current') count = rateLeft()
    if (i === 5 && state === 'current') count = isMb() ? accLeft() : takeoverLeft()
    if (i === 6 && state === 'current') ((count = blockingLeft()), (tone = 'error'))
    const box =
      state === 'done'
        ? `<span class="flex size-6 shrink-0 items-center justify-center border border-foreground bg-foreground text-background">${icon('check', 'size-3.5')}</span>`
        : state === 'current'
          ? `<span class="flex size-6 shrink-0 items-center justify-center border border-foreground border-b-[3px] border-b-accent text-xs font-semibold tabular">${i + 1}</span>`
          : `<span class="flex size-6 shrink-0 items-center justify-center border text-xs text-muted-foreground tabular">${i + 1}</span>`
    const sub =
      state === 'done'
        ? railSub(i)
        : state === 'current' && count
          ? `<span class="${tone === 'error' ? 'text-destructive' : 'text-warning'}">Nog ${count}</span>`
          : ''
    const inner = `${box}<span class="min-w-0 flex-1 pt-0.5"><span class="block text-sm leading-tight ${state === 'current' ? 'font-medium' : state === 'todo' ? 'text-muted-foreground' : ''}">${s.short}</span>${sub ? `<span class="mt-0.5 block truncate text-xs text-muted-foreground tabular">${sub}</span>` : ''}</span>`
    const cls = `flex items-start gap-3 px-2 py-1.5 ${mobile ? 'min-h-11' : ''}`
    if (state === 'todo')
      return `<li><span class="${cls}" aria-disabled="true">${inner}</span></li>`
    return `<li><a href="${hrefFor(s.id)}" ${state === 'current' ? 'aria-current="step"' : ''} class="${cls} hover:bg-muted ${state === 'current' ? 'bg-muted' : ''}">${inner}</a></li>`
  }

  function rail(mobile) {
    return `<nav aria-label="Stappen"><ol class="space-y-0.5">${D.steps.map((s, i) => railItem(s, i, mobile)).join('')}</ol></nav>`
  }

  function mobileProgress() {
    return `<div class="mb-5 md:hidden">
      <div class="flex items-center justify-between gap-2 text-sm"><span class="tabular">Stap ${S.idx + 1} van 10 · <span class="font-medium">${D.steps[S.idx].short}</span></span>
      <button type="button" data-action="steps" class="btn btn-ghost -mr-3 px-3" aria-haspopup="dialog">${icon('list')}Stappen</button></div>
      <div class="mt-1 grid grid-cols-10 gap-1" aria-hidden="true">${D.steps
        .map(
          (_, i) =>
            `<span class="h-1 ${i < S.idx ? 'bg-foreground' : i === S.idx ? 'bg-accent' : 'bg-border'}"></span>`,
        )
        .join('')}</div>
    </div>`
  }

  // ---------------------------------------------------------- step parts

  function advSwitch() {
    return `<button type="button" role="switch" aria-checked="${S.adv}" data-action="toggle-adv" data-focus="adv" class="inline-flex min-h-11 items-center gap-2 px-1 text-sm md:min-h-8">
      <span class="switch" aria-checked="${S.adv}"><span></span></span><span>Geavanceerd</span></button>`
  }

  function stepHeader(title, sub, opts) {
    const o = opts || {}
    return `<div class="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div class="min-w-0 flex-1">
        <p class="mb-1 hidden text-sm text-muted-foreground md:block tabular">Stap ${S.idx + 1} van 10</p>
        <h1 id="step-title" tabindex="-1" class="text-2xl tracking-tight outline-none md:text-[28px]">${title}</h1>
        ${sub ? `<p class="mt-1 max-w-[60ch] text-sm text-muted-foreground">${sub}</p>` : ''}
      </div>
      ${o.adv === false ? '' : `<div class="flex shrink-0 items-center gap-2">${o.actions || ''}${advSwitch()}</div>`}
    </div>`
  }

  function section(title, body, extra) {
    return `<section class="mb-8"><div class="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 class="text-base">${title}</h2>${extra || ''}</div>${body}</section>`
  }

  // A labelled value with its code as a muted second line. Geavanceerd adds
  // the accountant detail (rubriek, grootboekrekening).
  function codeLabel(label, code, advDetail) {
    return `<span class="block">${label}</span><span class="block text-xs text-muted-foreground tabular">${code}${S.adv && advDetail ? ' · ' + advDetail : ''}</span>`
  }

  function statusBlock(tone, body, id) {
    const map = {
      attention: ['border-warning/50 bg-warning/[0.06]', 'alert', 'text-warning'],
      info: ['border-info/40 bg-info/[0.06]', 'info', 'text-info'],
      error: ['border-destructive/50 bg-destructive/[0.06]', 'alert', 'text-destructive'],
      neutral: ['bg-muted', 'info', 'text-muted-foreground'],
      success: ['border-success/40 bg-success/[0.06]', 'check', 'text-success'],
    }[tone]
    return `<div ${id ? `id="${id}"` : ''} role="status" class="flex gap-3 border p-3 text-sm ${map[0]}"><span class="mt-0.5 ${map[2]}">${icon(map[1])}</span><div class="min-w-0 flex-1 space-y-1">${body}</div></div>`
  }

  function external(label, sr) {
    return `<a href="#" data-action="external" class="btn btn-outline" aria-label="${sr || label + ' (opent in een nieuw tabblad)'}">${label}${icon('external', 'size-3.5')}</a>`
  }

  // ---------------------------------------------------------------- step 1

  function stepBron() {
    const resume = S.p.get('resume') === '1'
    const r = D.resume
    const card = (id) => {
      const s = D.sources[id]
      const checked = S.src === id
      return `<div role="radio" aria-checked="${checked}" tabindex="${checked ? 0 : -1}" data-action="pick-src" data-src="${id}" data-focus="src-${id}" class="relative flex cursor-pointer gap-4 border p-5 ${checked ? 'border-foreground outline outline-1 -outline-offset-2 outline-foreground' : 'hover:bg-muted'}">
        <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center border ${checked ? 'border-foreground bg-foreground text-background' : 'border-input'}">${checked ? icon('check', 'size-3.5') : ''}</span>
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2"><span class="text-[15px] font-medium">${s.label}</span>${id === 'moneybird' ? badge('neutral', 'Nog nooit geïmporteerd') : badge('neutral', 'Eén boekjaar')}</span>
          <span class="mt-1 block text-sm">${s.scope}</span>
          <span class="mt-1 block text-sm text-muted-foreground">${s.notIncluded}</span>
          ${s.setupLine ? `<span class="mt-2 block text-xs text-muted-foreground">${s.setupLine}</span>` : ''}
        </span></div>`
    }
    const resumeCard = `<section aria-labelledby="resume-h" class="mb-6 border border-l-4 border-l-accent p-5" data-focus="resume">
        <p class="text-xs text-muted-foreground">Verder waar je was</p>
        <h2 id="resume-h" class="mt-0.5 text-lg">Moneybird · ${D.entity.name}</h2>
        <p class="mt-1 text-sm tabular">Stap ${r.step} van 10: Btw-codes · ${r.detail.toLowerCase()}</p>
        <p class="mt-1 text-sm text-muted-foreground tabular">Bewaard op 24-10-2026 om 16:12. Er is nog niets geboekt.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="${hrefFor('btw', { resumed: '1' })}" data-focus="resume-go" class="btn btn-primary">Doorgaan${keycaps('enter', onPrimary)}</a>
          <button type="button" data-action="open-confirm" data-confirm="restart" class="btn btn-outline">Opnieuw beginnen</button>
        </div></section>`
    return {
      body:
        stepHeader(
          resume ? 'Welkom terug' : 'Waar komen je boeken vandaan?',
          resume
            ? 'Je was al bezig met een import. Ga verder, of begin opnieuw.'
            : 'Kies het pakket waar je nu mee werkt. We laten je eerst zien wat er overkomt; er wordt niets geboekt tot je op Importeren drukt.',
          { adv: false },
        ) +
        (resume
          ? resumeCard +
            `<p class="text-sm text-muted-foreground">Ander pakket? Kies Opnieuw beginnen.</p>`
          : `<div role="radiogroup" aria-label="Bron" class="grid gap-3">${card('moneybird')}${card('exact')}</div>` +
            `<p class="mt-3 hidden text-xs text-muted-foreground md:block">${keycaps('up down')} kiezen · ${keycaps('enter')} verder</p>`),
      notes: [
        note(
          'Open vraag 3 · oude pagina’s',
          'PRD-standaard getoond: Importeren → Moneybird (i m) en Exact Online (i x) openen deze wizard. De oude /moneybird- en /exact-pagina’s verdwijnen in fase 3. Blijven ze als expertweergave, dan komt hier onder Geavanceerd één link “Oude importpagina”.',
        ),
        note(
          'Open vraag 4 · beta-firm',
          'Fase 1 is alleen Moneybird; Exact volgt in fase 2 (na #46). Is de wizard niet beta-firm, dan opent de Exact-kaart tot fase 2 de huidige Exact-pagina.',
        ),
      ],
      hideFooter: resume,
      status: isMb() ? 'Moneybird gekozen' : 'Exact Online gekozen',
      next: resume ? { label: 'Doorgaan', action: 'resume' } : { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 2

  function stepVerbinden() {
    const st = S.p.get('state')
    if (isMb()) {
      const error = st === 'error'
      const connected = st === 'connected'
      const body = connected
        ? statusBlock(
            'success',
            `<p class="font-medium">Verbonden met Moneybird</p><p class="text-muted-foreground tabular">Sinds 24-10-2026. We lezen alleen; in Moneybird verandert niets.</p>`,
          ) +
          `<div class="mt-4"><button type="button" data-action="open-confirm" data-confirm="disconnect" class="btn btn-ghost -ml-3 px-3 text-muted-foreground">${icon('plug')}Verbinding verbreken</button></div>`
        : `<form class="max-w-lg space-y-5" onsubmit="return false">
            <div>
              <label for="mb-token" class="mb-1.5 block text-sm font-medium">API-token</label>
              <input id="mb-token" data-focus="token" type="password" autocomplete="off" spellcheck="false" class="field ${error ? 'border-destructive' : ''}" placeholder="Plak hier je token" ${error ? 'value="mb-token-placeholder" aria-invalid="true" aria-describedby="token-err"' : 'aria-describedby="token-help"'} />
              ${error ? `<p id="token-err" class="mt-1.5 flex gap-1.5 text-sm text-destructive">${icon('alert', 'mt-0.5 size-4')}Moneybird kent dit token niet. Maak in Moneybird een nieuw token aan en plak het hier.</p>` : `<p id="token-help" class="mt-1.5 text-sm text-muted-foreground">We bewaren het versleuteld en laten het nooit meer zien.</p>`}
            </div>
            <details class="border px-4 py-3 text-sm" ${error ? 'open' : ''}>
              <summary class="-my-3 -mx-4 flex min-h-11 cursor-pointer items-center px-4 font-medium">Waar vind ik dit?</summary>
              <ol class="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground"><li>Ga in Moneybird naar Instellingen → Externe koppelingen.</li><li>Kies API-token aanmaken. Leesrechten zijn genoeg.</li><li>Kopieer het token en plak het hierboven.</li></ol>
            </details>
            ${S.adv ? `<div><label for="mb-url" class="mb-1.5 block text-sm font-medium">Adres van de API</label><input id="mb-url" class="field font-mono" value="https://moneybird.com/api/v2" /><p class="mt-1.5 text-xs text-muted-foreground">Alleen aanpassen als je een testomgeving gebruikt.</p></div>` : ''}
          </form>`
      return {
        body:
          stepHeader(
            'Verbind met Moneybird',
            'Met een token uit Moneybird kunnen we je administratie lezen.',
          ) + body,
        status: connected
          ? 'Verbonden'
          : error
            ? 'Token niet geaccepteerd'
            : 'Plak je token om verder te gaan',
        next: connected ? { label: 'Volgende' } : { label: 'Verbinden', action: 'connect' },
      }
    }
    const nokey = st === 'nokey'
    const form = `<form class="max-w-lg space-y-5" onsubmit="return false">
        <div><label for="ex-id" class="mb-1.5 block text-sm font-medium">Client ID</label><input id="ex-id" class="field font-mono" value="3f1c9a2e-6b0d-4e57-9a21-7c5e0d4b8f13" ${nokey ? 'disabled' : ''}/></div>
        <div><label for="ex-secret" class="mb-1.5 block text-sm font-medium">Client secret</label><input id="ex-secret" type="password" class="field" placeholder="Plak hier het secret" ${nokey ? 'disabled' : ''}/><p class="mt-1.5 text-sm text-muted-foreground">We bewaren het versleuteld en laten het nooit meer zien.</p></div>
        <div><label for="ex-uri" class="mb-1.5 block text-sm font-medium">Redirect-URI</label>
          <div class="flex"><input id="ex-uri" readonly class="field min-w-0 font-mono" value="https://klopt.bakkerijdevries.nl/exact/callback" /><button type="button" data-action="copy" class="btn btn-outline -ml-px shrink-0">${icon('copy')}Kopiëren</button></div>
          <p class="mt-1.5 text-sm text-muted-foreground">Zet deze precies zo in het Exact App Center. Exact vergelijkt hem letterlijk.</p></div>
        <div><label for="ex-env" class="mb-1.5 block text-sm font-medium">Exact-omgeving</label><select id="ex-env" class="field" ${nokey ? 'disabled' : ''}><option>Nederland (start.exactonline.nl)</option><option>België (start.exactonline.be)</option></select></div>
      </form>`
    return {
      body:
        stepHeader(
          'Verbind met Exact Online',
          'Je gaat zo naar Exact om in te loggen. Daarna kom je vanzelf hier terug.',
        ) +
        (nokey
          ? `<div class="mb-6">${statusBlock('error', `<p class="font-medium">Verbinden kan nog niet</p><p>Klopt kan je client secret niet veilig bewaren: er is geen KLOPT_ENCRYPTION_KEY ingesteld. Onversleuteld bewaren doen we niet.</p><p class="text-muted-foreground">Wie Klopt beheert, zet die sleutel eerst. Daarna kun je hier verder.</p>`, 'nokey')}</div>`
          : '') +
        form,
      notes: [
        note(
          'Telefoon',
          'Exact verbinden op een telefoon mag, maar is niet geoptimaliseerd (PRD). De redirect naar Exact en terug werkt wel op 390.',
        ),
      ],
      status: nokey ? 'Wacht op de beheerder' : 'Je gaat naar Exact en komt terug',
      next: nokey
        ? {
            label: 'Verbinden met Exact',
            disabled: true,
            reason: 'Er is eerst een versleutelsleutel nodig.',
          }
        : { label: 'Verbinden met Exact', action: 'connect', ext: true },
    }
  }

  // ---------------------------------------------------------------- step 3

  function stepAdministratie() {
    if (isMb()) {
      const admins = D.administrations
        .map(
          (
            a,
            i,
          ) => `<label class="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 ${i === 0 ? 'bg-muted' : 'hover:bg-muted'}">
          <input type="radio" name="admin" class="mt-1 size-4 accent-[var(--foreground)]" ${i === 0 ? 'checked' : ''} />
          <span class="min-w-0 flex-1"><span class="block text-sm font-medium">${a.name}</span><span class="block text-xs text-muted-foreground tabular">${a.currency} · boekjaar begint in ${a.yearStart} · ${nf(a.docs)} documenten${S.adv ? ' · id 4189 2210 0' + (i + 1) : ''}</span></span></label>`,
        )
        .join('')
      const yearRows = D.years
        .map((y) => {
          const closed = y.klopt === 'closed'
          return `<tr class="border-t align-top">
            <td class="py-3 pr-3 pl-4"><input type="checkbox" class="mt-0.5 size-4 accent-[var(--foreground)]" aria-label="${y.year} overzetten" ${closed ? 'disabled' : 'checked'} /></td>
            <td class="py-3 pr-3 text-sm font-medium tabular">${y.year}</td>
            <td class="py-3 pr-3 text-right text-sm tabular">${nf(y.docs)}</td>
            <td class="py-3 pr-4 text-sm">${closed ? `${badge('neutral', 'Afgesloten', 'lock')}<span class="mt-1 block text-xs text-muted-foreground">${y.note} We zetten het niet over.</span>` : `<span class="block">Open</span>${S.adv ? `<span class="block text-xs text-muted-foreground tabular">01-01-${y.year} – 31-12-${y.year}</span>` : y.note ? `<span class="block text-xs text-muted-foreground tabular">${y.note}</span>` : ''}${y.warn ? `<span class="mt-1 flex gap-1.5 text-xs text-warning">${icon('alert', 'mt-px size-3.5')}<span>${y.warn}</span></span>` : ''}`}</td>
          </tr>`
        })
        .join('')
      return {
        body:
          stepHeader(
            'Welke administratie en welke jaren?',
            'Kies welke boeken we overzetten. Je kunt dit tot de import nog aanpassen.',
          ) +
          section(
            'Administratie in Moneybird',
            `<fieldset class="divide-y border"><legend class="sr-only">Administratie</legend>${admins}</fieldset>`,
          ) +
          section(
            'Jaren',
            `<div class="overflow-x-auto border"><table class="w-full text-left"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="w-10 py-2 pl-4"><span class="sr-only">Overzetten</span></th><th class="py-2 pr-3 font-medium">Jaar</th><th class="py-2 pr-3 text-right font-medium">Documenten</th><th class="py-2 pr-4 font-medium">In Klopt</th></tr></thead><tbody>${yearRows}</tbody></table></div>`,
            '<span class="text-sm text-muted-foreground tabular">2 jaren · 542 documenten</span>',
          ) +
          section(
            'Klopt dit?',
            `<div class="space-y-1">
              <label class="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="checkbox" checked class="mt-0.5 size-4 accent-[var(--foreground)]" /><span class="text-sm">Moneybird en Klopt rekenen allebei in euro.</span></label>
              <label class="flex min-h-11 cursor-pointer items-start gap-3 py-2"><input type="checkbox" checked class="mt-0.5 size-4 accent-[var(--foreground)]" /><span class="text-sm">Het boekjaar begint in allebei in januari.</span></label>
            </div>`,
          ),
        notes: [
          note(
            'Open vraag 1 · jaren kiezen',
            'PRD-standaard getoond: Moneybird krijgt een jaarkeuze (nieuw). Jaren die je uitvinkt zetten we niet over (via importDecisions); ze staan in het overzicht onder “Niet overgezet”. Alternatief: blokkeren tot je kiest.',
          ),
        ],
        status: '2 jaren · 542 documenten',
        next: { label: 'Volgende' },
      }
    }
    const divs = D.divisions
      .map(
        (d, i) =>
          `<label class="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 ${i === 0 ? 'bg-muted' : 'hover:bg-muted'}"><input type="radio" name="div" class="mt-1 size-4 accent-[var(--foreground)]" ${i === 0 ? 'checked' : ''}/><span class="min-w-0 flex-1"><span class="block text-sm font-medium">${d.name}</span><span class="block text-xs text-muted-foreground tabular">${d.currency}${S.adv ? ' · administratie ' + d.number : ''}</span></span></label>`,
      )
      .join('')
    const yrs = D.exactYears
      .map(
        (y) =>
          `<label class="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 ${y.year === '2026' ? 'bg-muted' : 'hover:bg-muted'}"><input type="radio" name="year" class="mt-1 size-4 accent-[var(--foreground)]" ${y.year === '2026' ? 'checked' : ''}/><span><span class="block text-sm font-medium tabular">${y.year}</span><span class="block text-xs text-muted-foreground">${y.note}</span></span></label>`,
      )
      .join('')
    return {
      body:
        stepHeader(
          'Welke administratie en welk boekjaar?',
          'Exact zet één boekjaar over als beginbalans: rekeningen, relaties en wat er nog openstaat.',
        ) +
        section(
          'Administratie in Exact',
          `<fieldset class="divide-y border"><legend class="sr-only">Administratie</legend>${divs}</fieldset>`,
        ) +
        section(
          'Boekjaar',
          `<fieldset class="grid divide-y border sm:grid-cols-2 sm:divide-x sm:divide-y-0"><legend class="sr-only">Boekjaar</legend>${yrs}</fieldset>`,
        ) +
        section(
          'Datum van de beginbalans',
          `<div class="max-w-xs"><label for="open-date" class="sr-only">Datum van de beginbalans</label><input id="open-date" inputmode="numeric" class="field tabular" value="01-01-2026" aria-describedby="open-help"/><p id="open-help" class="mt-1.5 text-sm text-muted-foreground">Meestal de eerste dag van het boekjaar.</p></div>`,
        ),
      status: '2026 · beginbalans op 01-01-2026',
      next: { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 4

  function todoList(rows) {
    return `<ul role="list" class="divide-y border">${rows
      .map(
        ([
          step,
          title,
          detail,
          tone,
        ]) => `<li><a href="${hrefFor(D.steps[step].id)}" class="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-muted">
        <span class="flex size-6 shrink-0 items-center justify-center border text-xs tabular text-muted-foreground">${step + 1}</span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-medium">${title}</span><span class="block text-xs tabular ${tone === 'error' ? 'text-destructive' : tone === 'attention' ? 'text-warning' : 'text-muted-foreground'}">${detail}</span></span>${icon('chevronRight', 'size-4 text-muted-foreground')}</a></li>`,
      )
      .join('')}</ul>`
  }

  function stepVoorbeeld() {
    const reading = S.p.get('state') === 'reading'
    if (reading) {
      return {
        body:
          stepHeader(
            isMb() ? 'We lezen je administratie' : 'We lezen je Exact-administratie',
            'Er wordt nog niets geboekt.',
            { adv: false },
          ) +
          `<div class="border p-5" aria-busy="true">
            <div class="flex items-baseline justify-between gap-3 text-sm"><span class="font-medium">${isMb() ? 'Inkoopfacturen lezen' : 'Openstaande posten lezen'}</span><span class="tabular text-muted-foreground">${isMb() ? '214 van 583' : '31 van 47'}</span></div>
            <div class="bar mt-2"><span style="width:${isMb() ? 37 : 66}%"></span></div>
            <p class="sr-only" aria-live="polite">${isMb() ? '214 van 583 documenten gelezen' : '31 van 47 posten gelezen'}</p>
            <ul class="mt-4 space-y-1.5 text-sm">${(isMb()
              ? [
                  ['Verkoopfacturen', 'done'],
                  ['Inkoopfacturen', 'busy'],
                  ['Bonnetjes', 'wait'],
                  ['Bankmutaties', 'wait'],
                  ['Memoriaalposten', 'wait'],
                ]
              : [
                  ['Rekeningen', 'done'],
                  ['Relaties', 'done'],
                  ['Openstaande posten', 'busy'],
                  ['Proefbalans', 'wait'],
                ]
            )
              .map(
                ([l, s]) =>
                  `<li class="flex items-center gap-2 ${s === 'wait' ? 'text-muted-foreground' : ''}">${s === 'done' ? icon('check', 'size-4 text-success') : s === 'busy' ? icon('loader', 'spin size-4') : icon('circle', 'size-4')}${l}</li>`,
              )
              .join('')}</ul>
          </div>
          <p class="mt-4 text-sm text-muted-foreground">Je kunt dit scherm sluiten. We lezen verder en je gaat later verder waar je was.</p>`,
        status: 'Bezig met lezen',
        next: {
          label: 'Volgende',
          disabled: true,
          reason: 'Even geduld, we zijn nog aan het lezen.',
        },
      }
    }
    const reread = `<button type="button" data-action="reread-all" class="btn btn-outline">${icon('refresh')}Opnieuw lezen</button>`
    if (isMb()) {
      const rows = D.kinds
        .map(
          (k) =>
            `<tr class="border-t"><td class="py-2.5 pr-3 pl-4 text-sm">${k.label}</td><td class="py-2.5 pr-3 text-right text-sm tabular">${nf(k.y2025)}</td><td class="py-2.5 pr-3 text-right text-sm tabular">${nf(k.y2026)}</td><td class="py-2.5 pr-4 text-right text-sm font-medium tabular">${nf(k.y2025 + k.y2026)}</td></tr>`,
        )
        .join('')
      const recon = S.adv
        ? section(
            'Aansluiting per rekening',
            `<p class="mb-2 text-sm text-muted-foreground">Wat het plan uit Moneybird zou boeken, tegen het saldo in Moneybird op 31-12-2025.</p>
            <div class="overflow-x-auto border"><table class="w-full min-w-[520px] text-left text-sm"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="py-2 pr-3 pl-4 font-medium">Rekening</th><th class="py-2 pr-3 text-right font-medium">Debet</th><th class="py-2 pr-3 text-right font-medium">Credit</th><th class="py-2 pr-4 font-medium">Aansluiting</th></tr></thead><tbody>${[
              ['1100 Bank', '412.906,12', '398.115,40', 'ok'],
              ['1300 Debiteuren', '186.420,00', '179.032,55', 'ok'],
              ['1600 Crediteuren', '92.310,18', '97.604,90', 'ok'],
              ['1510 Af te dragen btw hoog', '6.204,00', '9.876,33', 'ok'],
              ['2000 Memoriaal', '1.250,00', '1.205,00', 'diff'],
            ]
              .map(
                ([a, d, c, s]) =>
                  `<tr class="border-t"><td class="py-2 pr-3 pl-4 tabular">${a}</td><td class="py-2 pr-3 text-right tabular">€ ${d}</td><td class="py-2 pr-3 text-right tabular">€ ${c}</td><td class="py-2 pr-4">${s === 'ok' ? badge('success', 'Klopt', 'check') : badge('attention', 'Verschil € 45,00')}</td></tr>`,
              )
              .join('')}</tbody></table></div>`,
          )
        : ''
      return {
        body:
          stepHeader(
            'Dit hebben we gelezen',
            'Gelezen vandaag om 19:12. Er is nog niets geboekt.',
            { actions: reread },
          ) +
          section(
            'Gevonden in Moneybird',
            `<div class="overflow-x-auto border"><table class="w-full text-left"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="py-2 pr-3 pl-4 font-medium">Soort</th><th class="py-2 pr-3 text-right font-medium">2025</th><th class="py-2 pr-3 text-right font-medium">2026</th><th class="py-2 pr-4 text-right font-medium">Totaal</th></tr></thead><tbody>${rows}<tr class="border-t bg-muted/60"><td class="py-2.5 pr-3 pl-4 text-sm font-medium">Totaal</td><td class="py-2.5 pr-3 text-right text-sm tabular">318</td><td class="py-2.5 pr-3 text-right text-sm tabular">224</td><td class="py-2.5 pr-4 text-right text-sm font-medium tabular">542</td></tr></tbody></table></div>
            <p class="mt-2 text-xs text-muted-foreground">Ook gelezen, niet overgezet: 4 concepten en 41 documenten uit 2024.</p>`,
          ) +
          section(
            'Wat moet je nog doen',
            todoList([
              [4, 'Btw-codes', 'Nog 3 tarieven kiezen', 'attention'],
              [5, 'Rekeningen en relaties', 'Nog 4 nakijken', 'attention'],
              [6, 'Problemen', '4 houden de import tegen · 2 om te weten', 'error'],
            ]),
          ) +
          recon,
        status: 'Nog 3 stappen met werk',
        next: { label: 'Volgende' },
      }
    }
    const cards = D.exactCounts
      .map(
        (c) =>
          `<div class="bg-background p-4"><p class="text-sm text-muted-foreground">${c.label}</p><p class="mt-1 text-2xl font-medium tabular">${nf(c.value)}</p><p class="mt-1 text-xs text-muted-foreground tabular">${c.sub}</p></div>`,
      )
      .join('')
    return {
      body:
        stepHeader(
          'Dit hebben we gelezen',
          'Boekjaar 2026 van Bakkerij De Vries B.V., gelezen vandaag om 19:12. Er is nog niets geboekt.',
          { actions: reread },
        ) +
        section(
          'Gevonden in Exact',
          `<div class="grid gap-px border bg-border sm:grid-cols-3">${cards}</div>`,
        ) +
        section(
          'Wat moet je nog doen',
          todoList([
            [4, 'Btw-codes', '2 codes herkent Klopt niet · alleen ter info', 'muted'],
            [5, 'Rekeningen en relaties', 'Nog 1 rekening kiezen', 'attention'],
            [6, 'Problemen', '1 houdt de import tegen', 'error'],
          ]),
        ) +
        (S.adv
          ? section(
              'Aansluiting',
              `<div class="overflow-x-auto border"><table class="w-full min-w-[520px] text-left text-sm"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="py-2 pr-3 pl-4 font-medium">Rekening</th><th class="py-2 pr-3 text-right font-medium">Saldo Exact</th><th class="py-2 pr-3 text-right font-medium">Beginbalans</th><th class="py-2 pr-4 font-medium"></th></tr></thead><tbody>${[
                ['1100 Bank', '€ 24.180,66 D', '€ 24.180,66 D'],
                ['1300 Debiteuren', '€ 38.412,50 D', '€ 38.412,50 D'],
                ['1600 Crediteuren', '€ 21.906,15 C', '€ 21.906,15 C'],
                ['0500 Eigen vermogen', '€ 40.687,01 C', '€ 40.687,01 C'],
              ]
                .map(
                  ([a, x, k]) =>
                    `<tr class="border-t"><td class="py-2 pr-3 pl-4 tabular">${a}</td><td class="py-2 pr-3 text-right tabular">${x}</td><td class="py-2 pr-3 text-right tabular">${k}</td><td class="py-2 pr-4">${badge('success', 'Klopt', 'check')}</td></tr>`,
                )
                .join('')}</tbody></table></div>
              <p class="mt-2 text-xs text-muted-foreground tabular">Openstaande posten (47) tellen op tot het saldo van 1300 en 1600.</p>`,
            )
          : ''),
      status: 'Nog 2 stappen met werk',
      next: { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 5

  function rateCard(r) {
    const pct = r.pct ? r.pct : 'geen percentage'
    const head = `<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div class="min-w-0"><h3 id="rt-${r.id}" class="text-[15px] font-medium">${r.name}</h3>
        <p class="text-xs text-muted-foreground tabular">${r.side === 'verkoop' ? 'Verkoop' : 'Inkoop'} · ${pct} · ${plural(r.docs, 'document', 'documenten')}${S.adv ? ' · Moneybird-tarief ' + (380 + Number(r.id.slice(1))) : ''}</p></div>
        <div class="flex shrink-0 items-center gap-1.5">${
          {
            confirmed: r.prev
              ? badge('neutral', 'Vorige keuze')
              : badge('success', 'Gekozen', 'check'),
            suggested: badge('neutral', 'Voorstel'),
            choose: badge('attention', 'Kies een code'),
            none: badge('attention', 'Geen passende code'),
            rc: badge('neutral', 'Gekozen'),
            excluded: badge('neutral', 'Niet overzetten', 'ban'),
          }[r.state]
        }</div></div>`
    let body = ''
    const mapped = (lbl, code, rub, led) =>
      `<div class="mt-3 flex items-start gap-2 text-sm"><span class="mt-0.5 text-muted-foreground">${icon('arrowRight', 'size-4')}</span><div>${codeLabel(lbl, code, rub ? 'rubriek ' + rub + ' · ' + led : '')}</div></div>`
    if (r.state === 'confirmed') body = mapped(r.label, r.code, r.rubriek, r.ledger)
    if (r.state === 'suggested')
      body =
        mapped(r.label, r.code, r.rubriek, r.ledger) +
        `<p class="mt-2 text-xs text-muted-foreground">De enige code die past. Bevestig hem zelf.</p>
        <div class="mt-3 flex flex-wrap gap-2"><button type="button" data-action="confirm-rate" data-id="${r.id}" class="btn btn-outline">${icon('check')}Bevestigen</button><button type="button" data-action="open-sheet" data-id="${r.id}" class="btn btn-ghost">Andere kiezen</button></div>`
    if (r.state === 'choose')
      body = `<div class="mt-3">${statusBlock('neutral', `<p>${r.assumption}</p>`)}</div>
        <div class="mt-3 flex flex-wrap gap-2"><button type="button" data-action="open-sheet" data-id="${r.id}" class="btn btn-outline">Btw-code kiezen${icon('arrowRight')}</button></div>`
    if (r.state === 'rc')
      body =
        mapped(r.label, r.code, r.rubriek, r.ledger) +
        `<div class="mt-3">${statusBlock(
          'attention',
          `<p class="font-medium">Deze ${r.docs} inkopen worden gewoon geïmporteerd.</p><p>Alleen de btw-aangifte voor die periodes kun je nog niet via Klopt indienen: Klopt boekt de zelf af te dragen btw nog niet. Dien die aangifte zelf of met een belastingadviseur in, op basis van gecorrigeerde cijfers.</p><p class="text-muted-foreground">Wacht niet op Klopt als je aangiftetermijn eerder afloopt.</p>`,
        )}</div>`
    if (r.state === 'none')
      body = `<div class="mt-3">${statusBlock(
        'attention',
        `<p>Klopt heeft geen btw-code die bij dit tarief past. Pas het tarief aan in Moneybird en lees opnieuw, of zet deze documenten op niet overzetten.</p>`,
        'none-' + r.id,
      )}</div>
        <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" aria-describedby="none-${r.id}">
          ${external('Open in Moneybird', 'Open dit tarief in Moneybird (nieuw tabblad)')}
          <button type="button" data-action="reread-rate" data-id="${r.id}" class="btn btn-outline">${icon('refresh')}Opnieuw lezen</button>
          <button type="button" data-action="exclude-rate" data-id="${r.id}" class="btn btn-outline">${icon('ban')}${r.docs} documenten niet overzetten</button>
          ${S.adv ? `<button type="button" data-action="open-sheet" data-id="${r.id}" class="btn btn-ghost">Zelf kiezen in de tabel</button>` : ''}
        </div>`
    if (r.state === 'excluded')
      body = `<p class="mt-3 text-sm">Deze ${r.docs} documenten zetten we niet over <span class="text-muted-foreground tabular">(${r.years})</span>. Ze tellen niet mee voor dit tarief en staan in het overzicht onder ‘Niet overgezet’.</p>
        <div class="mt-3"><button type="button" data-action="undo-exclude" class="btn btn-outline">${icon('undo')}Ongedaan maken</button></div>`
    const left = {
      confirmed: 'border-l-success',
      suggested: 'border-l-[var(--line-strong)]',
      choose: 'border-l-warning',
      none: 'border-l-warning',
      rc: 'border-l-warning',
      excluded: 'border-l-[var(--line-strong)]',
    }[r.state]
    return `<li><article data-card="${r.id}" data-focus="card-${r.id}" tabindex="0" aria-labelledby="rt-${r.id}" class="border border-l-4 bg-card p-4 md:p-5 ${left} ${r.state === 'excluded' ? 'bg-muted/50' : ''}">${head}${body}</article></li>`
  }

  function stepBtw() {
    if (!isMb()) {
      const rows = D.exactVat
        .map(
          (v) =>
            `<tr class="border-t align-top"><td class="py-2.5 pr-3 pl-4 text-sm">${codeLabel(v.name, 'Exact-code ' + v.code)}</td><td class="py-2.5 pr-4 text-sm">${
              v.klopt
                ? codeLabel(v.label, v.klopt)
                : `<span class="flex items-center gap-1.5 text-warning">${icon('alert', 'size-3.5')}Klopt herkent deze niet</span><span class="mt-0.5 block text-xs text-muted-foreground tabular">${plural(v.accounts, 'rekening krijgt', 'rekeningen krijgen')} geen standaard btw-code${S.adv ? ': ' + v.lose : ''}</span>`
            }</td></tr>`,
        )
        .join('')
      return {
        body:
          stepHeader(
            'Btw-codes uit Exact',
            'Exact geeft per rekening een standaard btw-code mee. Klopt herkent ze op naam. Je hoeft hier niets te kiezen.',
          ) +
          section(
            'Wat Klopt herkent',
            `<div class="overflow-x-auto border"><table class="w-full text-left"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="py-2 pr-3 pl-4 font-medium">In Exact</th><th class="py-2 pr-4 font-medium">In Klopt</th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="mt-2 text-sm text-muted-foreground">Rekeningen zonder standaard btw-code komen wel over. Bij nieuwe boekingen kies je de btw dan zelf.</p>`,
            '<span class="text-sm text-muted-foreground tabular">5 van 7 herkend</span>',
          ),
        notes: [
          note(
            'Open vraag 2 · btw bij Exact',
            'PRD-standaard getoond: een lijst om te lezen, zonder keuzes. Kiest Hidde voor echte koppeling zoals bij Moneybird, dan krijgt deze stap dezelfde kaarten als Moneybird stap 5 (fase 2+).',
          ),
        ],
        status: '5 van 7 herkend · niets te kiezen',
        next: { label: 'Volgende' },
      }
    }
    const left = rateLeft()
    // Order by the state the rate was read in, so a card never jumps when you act on it.
    const order = { none: 0, choose: 1, suggested: 2, rc: 3, confirmed: 4 }
    const initial = Object.fromEntries(D.rates.map((r) => [r.id, order[r.state]]))
    const sorted = S.rates.slice().sort((a, b) => initial[a.id] - initial[b.id])
    const resumed = S.p.get('resumed') === '1'
    return {
      body:
        (resumed
          ? `<div class="mb-6">${statusBlock('info', `<p class="font-medium">Je gaat verder waar je was</p><p class="text-muted-foreground tabular">Je keuzes van 24-10-2026 staan er nog. We lazen Moneybird net opnieuw: er is niets veranderd.</p>`)}</div>`
          : '') +
        stepHeader(
          'Welke btw-code hoort bij elk tarief?',
          'Hier kan je aangifte stil fout gaan, dus we kiezen niets voor je. Een voorstel bevestig je zelf.',
        ) +
        `<ul role="list" aria-label="Btw-tarieven" class="space-y-3">${sorted.map(rateCard).join('')}</ul>` +
        `<div class="key-strip mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-muted-foreground md:flex"><span class="inline-flex items-center gap-1.5">${keycaps('j k')}Volgend, vorig tarief</span><span class="inline-flex items-center gap-1.5">${keycaps('enter')}Kiezen of bevestigen (alleen dit tarief)</span></div>`,
      notes: [
        note(
          'Regels',
          'Nooit verkoop en inkoop door elkaar, geen 21%-terugval. Een voorstel alleen als er precies één code past; VGEEN en 0%-verkoopcodes nooit. Eén Enter bevestigt nooit meer dan het tarief met focus.',
        ),
      ],
      status: left ? `Nog ${plural(left, 'tarief', 'tarieven')} kiezen` : 'Alle tarieven gekozen',
      next: left
        ? {
            label: 'Volgende',
            disabled: true,
            reason: `Kies eerst een btw-code voor ${left === 1 ? 'het laatste tarief' : 'elk tarief'}, of zet de documenten op niet overzetten.`,
          }
        : { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 6

  function accountRow(a, i) {
    const right = a.klopt
      ? codeLabel(a.klopt, a.kloptNo, a.kind + ' · ' + a.dc)
      : a.state === 'created'
        ? codeLabel('Privéopnamen', 'nieuw · 0610', 'Balans · Debet')
        : `<span class="block">Nieuwe rekening</span><span class="block text-xs text-muted-foreground">Privéopnamen${S.adv ? ' · 0610 · Balans · Debet' : ''}</span>`
    const action = {
      prev: badge('neutral', 'Vorige keuze'),
      ok: badge('success', 'Gekozen', 'check'),
      created: badge('success', 'Nieuw', 'check'),
      suggest: `<button type="button" data-action="confirm-acc" data-i="${i}" class="btn btn-outline">${icon('check')}Bevestigen</button>`,
      derived: `<button type="button" data-action="confirm-acc" data-i="${i}" class="btn btn-outline">${icon('check')}Ja, dit zijn kosten</button>`,
      new: `<button type="button" data-action="confirm-acc" data-i="${i}" class="btn btn-outline">${icon('plus')}Nieuwe rekening maken</button>`,
    }[a.state]
    const hint =
      a.state === 'derived'
        ? `<p class="mt-1 flex gap-1.5 text-xs text-warning">${icon('alert', 'mt-px size-3.5')}Moneybird zegt niet wat voor rekening dit is. We denken: kosten.</p>`
        : a.state === 'suggest'
          ? '<p class="mt-1 text-xs text-muted-foreground">Voorstel op naam</p>'
          : ''
    return `<li class="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_12.5rem] sm:items-center sm:gap-4">
      <div class="text-sm">${codeLabel(a.mb, a.mbNo)}</div>
      <span class="hidden text-muted-foreground sm:block">${icon('arrowRight')}</span>
      <div class="text-sm">${right}${hint}</div>
      <div class="sm:justify-self-end">${action}</div></li>`
  }

  function stepRekeningen() {
    if (!isMb()) {
      const fields = S.takeover
        .map(
          (
            t,
          ) => `<div class="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:gap-6">
          <div><p class="text-sm font-medium">${t.label}</p><p class="text-xs text-muted-foreground">${t.help}</p></div>
          <button type="button" data-action="todo" aria-haspopup="listbox" class="field flex items-center gap-2 text-left ${t.value ? '' : 'border-warning'}">
            <span class="min-w-0 flex-1">${t.value ? `<span class="block text-sm">${S.adv ? t.value : t.plain}</span>${S.adv ? '' : `<span class="block text-xs text-muted-foreground tabular">${t.value.split(' ')[0]}</span>`}` : '<span class="text-muted-foreground">Kies een rekening</span>'}</span>${icon('chevronDown', 'size-4 text-muted-foreground')}</button></div>`,
        )
        .join('')
      const left = takeoverLeft()
      return {
        body:
          stepHeader(
            'Rekeningen voor de beginbalans',
            'We kiezen deze niet voor je. Een verkeerde rekening zet je beginbalans op de verkeerde plek, en dat merk je pas bij de jaarafsluiting.',
          ) +
          section(
            'Waar de beginbalans landt',
            `<div class="divide-y border">${fields}</div>`,
            left ? `<span class="text-sm text-warning tabular">Nog ${left} kiezen</span>` : '',
          ) +
          section(
            'Rekeningschema',
            `<p class="text-sm">312 rekeningen uit Exact maken we aan met hetzelfde nummer en dezelfde naam.</p>
            <ul role="list" class="mt-3 divide-y border">${[
              ['Bestelbus', '4500'],
              ['Kas winkel', '1000'],
              ['Vooruitbetaalde huur', '1400'],
            ]
              .map(
                ([n, no], i) =>
                  `<li class="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div class="text-sm">${codeLabel(n, no)}<p class="mt-1 flex gap-1.5 text-xs text-warning">${icon('alert', 'mt-px size-3.5')}Soort geraden: ${['kosten', 'bezit', 'bezit'][i]}</p></div><button type="button" data-action="todo" class="btn btn-outline">${icon('check')}Klopt</button></li>`,
              )
              .join('')}</ul>`,
          ),
        status: left ? `Nog ${left} rekening kiezen · 3 nakijken` : 'Alles gekozen',
        next: left
          ? {
              label: 'Volgende',
              disabled: true,
              reason: 'Kies eerst de tegenrekening voor de beginbalans.',
            }
          : { label: 'Volgende' },
      }
    }
    const left = accLeft()
    const contact = S.contactFixed
      ? `<div class="flex flex-wrap items-center gap-3 border px-4 py-3 text-sm">${badge('success', 'Opgelost', 'check')}<span>Molen De Hoop B.V. krijgt relatienummer <span class="tabular">1187</span>.</span></div>`
      : `<div class="border border-l-4 border-l-warning p-4"><p class="text-sm font-medium">Relatienummer 1042 staat twee keer in Moneybird</p><p class="mt-1 text-sm text-muted-foreground">Bij Molen De Hoop en bij Molen De Hoop B.V. Twee relaties met hetzelfde nummer zouden elkaar overschrijven.</p><div class="mt-3"><button type="button" data-action="fix-contact" class="btn btn-outline">Volgend vrij nummer geven <span class="tabular text-muted-foreground">(1187)</span></button></div></div>`
    return {
      body:
        stepHeader(
          'Waar komen je rekeningen terecht?',
          'Elke rekening uit Moneybird krijgt een plek in Klopt. Je vorige keuzes staan er al.',
        ) +
        section(
          'Rekeningen',
          `<div class="mb-2 hidden grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_12.5rem] gap-4 px-4 text-xs text-muted-foreground sm:grid"><span>In Moneybird</span><span></span><span>In Klopt</span><span></span></div><ul role="list" class="divide-y border">${S.accounts.map(accountRow).join('')}</ul>`,
          `<span class="text-sm text-muted-foreground tabular">24 rekeningen · 16 zonder werk niet getoond</span>`,
        ) +
        section(
          'Relaties',
          `<p class="mb-3 text-sm tabular">186 relaties: 112 klanten en 74 leveranciers.</p>${contact}`,
        ),
      status: left ? `Nog ${left} nakijken` : 'Alles nagekeken',
      next: left
        ? {
            label: 'Volgende',
            disabled: true,
            reason: 'Bevestig eerst de rekeningen en het relatienummer.',
          }
        : { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 7

  function problemCard(x) {
    const blocking = x.severity === 'blocking'
    if (x.done)
      return `<li><div class="flex flex-wrap items-start gap-3 border px-4 py-3 text-sm">${x.done === 'excluded' ? badge('neutral', 'Niet overzetten', 'ban') : badge('success', 'Opgelost', 'check')}<span class="min-w-0 flex-1">${x.title}</span>${x.done === 'excluded' ? `<button type="button" data-action="undo-problem" data-id="${x.id}" class="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 md:min-h-0">${icon('undo', 'size-3.5')}Ongedaan maken</button>` : ''}</div></li>`
    const busy = S.busy === x.id
    let actions = ''
    if (x.fix === 'reread')
      actions = busy
        ? `<button type="button" disabled aria-busy="true" class="btn btn-primary">${icon('loader', 'spin size-4')}Bezig met lezen…</button><span class="sr-only" aria-live="polite">Bezig met opnieuw lezen</span>`
        : `<button type="button" data-action="reread" data-id="${x.id}" class="btn btn-primary">${icon('refresh')}Opnieuw lezen</button>${external('Open in Moneybird', 'Open inkoopfactuur 2025-0412 in Moneybird (nieuw tabblad)')}`
    if (x.fix === 'mbReread')
      actions = `${external('Open in Moneybird', 'Open bonnetje 2026-0088 in Moneybird (nieuw tabblad)')}<button type="button" data-action="reread" data-id="${x.id}" class="btn btn-outline">${icon('refresh')}Opnieuw lezen</button>`
    if (x.fix === 'fx')
      actions = `<button type="button" data-action="open-sheet" data-id="fx" class="btn btn-primary">Koers kiezen${icon('arrowRight')}</button><span class="text-xs text-muted-foreground">Koers → Voorbeeld → Bevestigen</span>`
    if (x.fix === 'exclude')
      actions = `<button type="button" data-action="todo" class="btn btn-outline">${icon('eye')}Document bekijken</button><button type="button" data-action="exclude-problem" data-id="${x.id}" class="btn btn-outline">${icon('ban')}Niet overzetten</button>`
    if (x.fix === 'explain')
      actions = `<span class="text-sm text-muted-foreground">Dit los je niet hier op.</span>${external('Open in Moneybird', 'Bekijk deze inkopen in Moneybird (nieuw tabblad, alleen bekijken)')}<span class="text-xs text-muted-foreground">Alleen om te bekijken</span>`
    if (x.fix === 'defer')
      actions = `<button type="button" data-action="defer" data-id="${x.id}" class="btn btn-outline">Later toevoegen</button>`
    return `<li><article data-card="${x.id}" data-focus="card-${x.id}" tabindex="0" aria-labelledby="pt-${x.id}" class="border border-l-4 bg-card p-4 md:p-5 ${blocking ? 'border-l-destructive' : 'border-l-[var(--line-strong)]'}">
      <div class="mb-2 flex flex-wrap items-center gap-2">${blocking ? badge('error', 'Blokkeert import', 'alert') : badge('neutral', 'Let op')}${S.adv ? `<code class="ml-auto font-mono text-[11px] text-muted-foreground">${x.code}</code>` : ''}</div>
      <h3 id="pt-${x.id}" class="text-[15px] leading-snug font-medium">${x.title}</h3>
      <p class="mt-1 text-sm">${x.body}</p>
      ${x.secondary ? `<p class="mt-1 text-xs text-muted-foreground tabular">${x.secondary}</p>` : ''}
      ${x.next ? `<p class="mt-2 text-sm"><span class="font-medium">Wat je kunt doen:</span> ${x.next}</p>` : ''}
      <p class="mt-2 text-sm text-muted-foreground"><span class="font-medium text-foreground">Waarom dit telt:</span> ${x.why}</p>
      <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">${actions}</div>
    </article></li>`
  }

  function stepProblemen() {
    if (!isMb()) {
      const card = `<li><article data-card="ex1" tabindex="0" class="border border-l-4 border-l-destructive bg-card p-4 md:p-5">
        <div class="mb-2 flex flex-wrap items-center gap-2">${badge('error', 'Blokkeert import', 'alert')}${S.adv ? '<code class="ml-auto font-mono text-[11px] text-muted-foreground">resource_unreadable · 403</code>' : ''}</div>
        <h3 class="text-[15px] font-medium">Exact gaf geen toegang tot je openstaande posten</h3>
        <p class="mt-1 text-sm">De Exact-gebruiker waarmee je verbond mag openstaande posten niet bekijken. Zonder die posten klopt je beginbalans niet.</p>
        <p class="mt-2 text-sm"><span class="font-medium">Wat je kunt doen:</span> geef die gebruiker in Exact het recht ‘Financieel – Openstaande posten bekijken’ en lees opnieuw.</p>
        <div class="mt-4 flex flex-wrap gap-2"><button type="button" data-action="reread" data-id="ex1" class="btn btn-primary">${icon('refresh')}Opnieuw lezen</button>${external('Open Exact')}</div></article></li>`
      return {
        body:
          stepHeader(
            'Dit moet nog opgelost worden',
            'Wat na de btw-codes en rekeningen nog openstaat.',
          ) + `<ul role="list" class="space-y-3">${card}</ul>`,
        notes: [
          note(
            'Afhankelijk van #46',
            'Exact-bevindingen zijn nu Engels en alleen uitleg. Deze kaart gaat uit van #46: NL/EN-teksten en het patroon bevinding-met-oplossing.',
          ),
        ],
        status: 'Nog 1 ding om op te lossen',
        next: { label: 'Volgende', disabled: true, reason: 'Er houdt nog 1 punt de import tegen.' },
      }
    }
    const left = blockingLeft()
    const open = S.problems.filter((x) => !x.done)
    const done = S.problems.filter((x) => x.done)
    const blocking = open.filter((x) => x.severity === 'blocking')
    const warnings = open.filter((x) => x.severity !== 'blocking')
    return {
      body:
        stepHeader(
          left ? 'Dit moet nog opgelost worden' : 'Niets houdt de import meer tegen',
          left
            ? 'Wat na de btw-codes en rekeningen nog openstaat. Elk punt heeft een oplossing of een eerlijke uitleg.'
            : 'Er staan nog een paar dingen om te weten. Die houden de import niet tegen.',
        ) +
        (blocking.length
          ? section(
              'Houdt de import tegen',
              `<ul role="list" class="space-y-3">${blocking.map(problemCard).join('')}</ul>`,
              `<span class="text-sm text-destructive tabular">${left} over</span>`,
            )
          : '') +
        (warnings.length
          ? section(
              'Om te weten',
              `<ul role="list" class="space-y-3">${warnings.map(problemCard).join('')}</ul>`,
            )
          : '') +
        (done.length
          ? section(
              'Gedaan',
              `<ul role="list" class="space-y-2">${done.map(problemCard).join('')}</ul>`,
            )
          : '') +
        `<div class="key-strip hidden flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-muted-foreground md:flex"><span class="inline-flex items-center gap-1.5">${keycaps('j k')}Volgend, vorig punt</span><span class="inline-flex items-center gap-1.5">${keycaps('enter')}Eerste actie van het punt</span></div>`,
      notes: [
        note(
          '#99 na release',
          'Zodra #99 er is, krijgt de btw-code-kaart “Geldig vanaf aanpassen” (Eigenaar/Accountant). Een Boekhouder ziet dan “Vraag de eigenaar of accountant”. Nu: alleen Opnieuw lezen.',
        ),
      ],
      status: left
        ? `Nog ${plural(left, 'ding', 'dingen')} om op te lossen`
        : 'Niets blokkeert meer',
      next: left
        ? {
            label: 'Volgende',
            disabled: true,
            reason: `Er ${left === 1 ? 'houdt nog 1 punt' : `houden nog ${left} punten`} de import tegen.`,
          }
        : { label: 'Volgende' },
    }
  }

  // ---------------------------------------------------------------- step 8

  function numLink(n, step, cls) {
    return `<a href="${hrefFor(D.steps[step].id)}" class="tabular underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-foreground ${cls || ''}">${n}</a>`
  }

  function stepOverzicht() {
    if (!isMb()) {
      const dl = [
        ['Datum', '01-01-2026', 2],
        ['Dagboek', S.adv ? 'MEM Memoriaal' : 'Memoriaal', 5],
        ['Debiteuren', S.adv ? '1300 Debiteuren' : 'Te ontvangen van klanten', 5],
        ['Crediteuren', S.adv ? '1600 Crediteuren' : 'Te betalen aan leveranciers', 5],
        [
          'Tegenrekening',
          S.adv ? '0900 Tussenrekening beginbalans' : 'Tussenrekening beginbalans',
          5,
        ],
      ]
        .map(
          ([k, v, s]) =>
            `<div class="flex justify-between gap-4 px-4 py-2.5 text-sm"><dt class="text-muted-foreground">${k}</dt><dd class="text-right">${numLink(v, s)}</dd></div>`,
        )
        .join('')
      return {
        body:
          stepHeader('Dit gaat er gebeuren', 'Lees het na. Er is nog niets geboekt.') +
          section('Beginbalans', `<dl class="divide-y border">${dl}</dl>`) +
          section(
            'Wordt aangemaakt',
            `<dl class="divide-y border">${[
              ['Rekeningen', '312', '14 nieuw', 5],
              ['Relaties', '186', '112 klanten, 74 leveranciers', 3],
              ['Openstaande posten', '47', '€ 38.412,50 te ontvangen · € 21.906,15 te betalen', 3],
            ]
              .map(
                ([k, v, sub, s]) =>
                  `<div class="flex justify-between gap-4 px-4 py-2.5 text-sm"><dt><span class="block">${k}</span><span class="block text-xs text-muted-foreground tabular">${sub}</span></dt><dd class="font-medium">${numLink(v, s)}</dd></div>`,
              )
              .join('')}</dl>`,
          ) +
          section(
            'Komt niet mee',
            `<p class="text-sm text-muted-foreground">Losse boekingen uit 2026 en eerdere jaren. Documenten zet je na de import apart over, als je dat wilt.</p>`,
          ),
        status: 'Klaar om te boeken',
        next: { label: 'Beginbalans boeken', action: 'confirm-import' },
      }
    }
    const k = D.kinds.map((x) => ({ ...x }))
    k[1].y2025 -= 7
    k[1].y2026 -= 5
    k[4].y2025 -= 1
    const rows = k
      .map(
        (x) =>
          `<tr class="border-t"><td class="py-2.5 pr-3 pl-4 text-sm">${x.label}</td><td class="py-2.5 pr-3 text-right text-sm">${numLink(nf(x.y2025), 3)}</td><td class="py-2.5 pr-3 text-right text-sm">${numLink(nf(x.y2026), 3)}</td><td class="py-2.5 pr-4 text-right text-sm font-medium tabular">${nf(x.y2025 + x.y2026)}</td></tr>`,
      )
      .join('')
    const skipped = [
      ['Geen btw (buiten EU)', 12, 'inkoopfacturen', 'Jij koos ‘Niet overzetten’', 4, true],
      ['Memoriaalpost 2025-M011', 1, 'memoriaalpost', 'Sluit niet', 6, false],
      ['2024', 41, 'documenten', 'Boekjaar afgesloten in Klopt', 2, false],
      ['Concepten', 4, 'concepten', 'Concepten zetten we niet over', 3, false],
    ]
      .map(
        ([
          t,
          n,
          unit,
          why,
          s,
          undo,
        ]) => `<li class="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
        <span class="min-w-0 flex-1"><span class="block font-medium">${t}</span><span class="block text-xs text-muted-foreground">${why}</span></span>
        <span class="inline-flex min-h-11 items-center tabular sm:min-h-0">${numLink(n + NBSP + unit, s)}</span>
        ${undo ? `<a href="${hrefFor('btw')}" class="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4 md:min-h-0">${icon('undo', 'size-3.5')}Ongedaan maken</a>` : ''}</li>`,
      )
      .join('')
    return {
      body:
        stepHeader(
          'Dit gaat er gebeuren',
          'Lees het na. Er is nog niets geboekt. Elk getal brengt je terug naar de stap waar het vandaan komt.',
        ) +
        `<div class="mb-8">${statusBlock(
          'attention',
          `<p class="font-medium">Na de import kun je de btw-aangifte voor Q2 en Q3 2025 niet via Klopt indienen</p><p>9 EU-inkopen worden wel geïmporteerd, maar Klopt boekt de zelf af te dragen btw nog niet. Dien die aangiftes zelf of met een belastingadviseur in, op basis van gecorrigeerde cijfers.</p>`,
        )}</div>` +
        section(
          'Wordt geïmporteerd',
          `<div class="overflow-x-auto border"><table class="w-full text-left"><thead class="bg-muted text-xs text-muted-foreground"><tr><th class="py-2 pr-3 pl-4 font-medium">Soort</th><th class="py-2 pr-3 text-right font-medium">2025</th><th class="py-2 pr-3 text-right font-medium">2026</th><th class="py-2 pr-4 text-right font-medium">Totaal</th></tr></thead><tbody>${rows}<tr class="border-t bg-muted/60"><td class="py-2.5 pr-3 pl-4 text-sm font-medium">Totaal</td><td class="py-2.5 pr-3 text-right text-sm tabular">310</td><td class="py-2.5 pr-3 text-right text-sm tabular">219</td><td class="py-2.5 pr-4 text-right text-sm font-medium tabular">529</td></tr></tbody></table></div>`,
        ) +
        section(
          'Niet overgezet',
          `<ul role="list" class="divide-y border">${skipped}</ul>`,
          '<span class="text-sm text-muted-foreground tabular">58 documenten</span>',
        ) +
        section(
          'Al in Klopt',
          '<p class="text-sm text-muted-foreground">Niets. Dit is je eerste import van deze administratie. Wat al in Klopt staat, slaan we bij een volgende import over.</p>',
        ) +
        section(
          'Je keuzes',
          `<dl class="divide-y border">${[
            ['Btw-tarieven', '7', '6 gekoppeld, 1 niet overzetten', 4],
            ['Rekeningen', '24', '1 nieuw', 5],
            ['Relaties', '186', '1 nieuw nummer', 5],
            ['Koersen', '1', 'GBP op 16-10-2025: 1,1531', 6],
          ]
            .map(
              ([kk, v, sub, s]) =>
                `<div class="flex justify-between gap-4 px-4 py-2.5 text-sm"><dt><span class="block">${kk}</span><span class="block text-xs text-muted-foreground tabular">${sub}</span></dt><dd class="font-medium">${numLink(v, s)}</dd></div>`,
            )
            .join('')}</dl>`,
        ) +
        (S.adv
          ? `<p class="-mt-4 text-xs text-muted-foreground tabular">Plan 7F3A-21C9 · gelezen 26-10-2026 19:12 · de server voert precies dit plan uit.</p>`
          : ''),
      status: '529 documenten klaar om te importeren',
      next: { label: '529 documenten importeren', action: 'confirm-import' },
    }
  }

  // ---------------------------------------------------------------- step 9

  function stepImporteren() {
    const st = S.p.get('state')
    if (st === 'refused')
      return {
        body:
          stepHeader('We hebben niets geboekt', '', { adv: false }) +
          statusBlock(
            'attention',
            `<p class="font-medium">Sinds je overzicht is er in Moneybird iets veranderd</p><p>We lazen 2 nieuwe documenten met een probleem. Om je boeken niet half over te zetten, zijn we gestopt voordat er iets geboekt werd.</p>`,
          ) +
          `<div class="mt-4"><a href="${hrefFor('problemen')}" class="btn btn-primary">Naar problemen${icon('arrowRight')}</a></div>`,
        hideFooter: true,
      }
    const pct = S.pct
    const done = pct >= 100
    const kinds = isMb()
      ? [
          ['Verkoopfacturen', 167],
          ['Inkoopfacturen', 90],
          ['Bonnetjes', 100],
          ['Bankmutaties', 155],
          ['Memoriaalposten', 17],
        ]
      : [
          ['Rekeningen', 312],
          ['Relaties', 186],
          ['Openstaande posten', 47],
          ['Beginbalans', 1],
        ]
    const total = kinds.reduce((s, k) => s + k[1], 0)
    let budget = Math.round((pct / 100) * total)
    const rows = kinds
      .map(([l, n]) => {
        const got = Math.max(0, Math.min(n, budget))
        budget -= got
        const state = got === n ? 'done' : got > 0 ? 'busy' : 'wait'
        return `<li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3">
          <span class="flex items-center gap-2 text-sm ${state === 'wait' ? 'text-muted-foreground' : ''}">${state === 'done' ? icon('check', 'size-4 text-success') : state === 'busy' ? icon('loader', 'spin size-4') : icon('circle', 'size-4')}${l}</span>
          <span class="text-sm tabular ${state === 'wait' ? 'text-muted-foreground' : ''}">${state === 'wait' ? 'Wacht' : `${nf(got)} van ${nf(n)}`}</span>
          <div class="bar col-span-2"><span style="width:${(got / n) * 100}%"></span></div></li>`
      })
      .join('')
    return {
      body:
        stepHeader(
          done
            ? 'Alles is overgezet'
            : isMb()
              ? 'We zetten je boeken over'
              : 'We boeken je beginbalans',
          '',
          { adv: false },
        ) +
        `<div class="border p-5"><div class="flex items-baseline justify-between text-sm"><span class="font-medium">${done ? 'Klaar' : 'Bezig'}</span><span class="tabular" data-pct>${pct}%</span></div><div class="bar mt-2 h-2"><span data-bar style="width:${pct}%"></span></div><p class="sr-only" aria-live="polite" data-live>${pct}% overgezet</p></div>
        <ul role="list" class="mt-4 divide-y border" data-rows>${rows}</ul>
        <div class="mt-4 space-y-1 text-sm text-muted-foreground"><p>Je kunt dit scherm sluiten; we gaan door. Kom je terug, dan zie je hier hoe ver we zijn.</p><p>Dubbel boeken kan niet: wat al in Klopt staat, slaan we over.</p></div>`,
      notes: isMb()
        ? []
        : [
            note(
              'Eng: Exact wordt async',
              'POST /exact/import is nu synchroon (201). Deze voortgang vraagt een async run zoals Moneybird, of minstens een “bezig”-status die een herlaadbeurt overleeft.',
            ),
          ],
      status: done ? 'Klaar' : `${pct}% overgezet`,
      back: false,
      next: done
        ? { label: 'Volgende' }
        : { label: 'Volgende', disabled: true, reason: 'We zijn nog bezig.' },
    }
  }

  // --------------------------------------------------------------- step 10

  function stepKlaar() {
    const clean = S.p.get('state') === 'clean' || !isMb()
    const nextSteps = [
      ['Nakijken in de werklijst', '6 punten om even naar te kijken', 'list'],
      ['Btw-periode Q3 2026 controleren', 'Aangifte uiterlijk 31-10-2026', 'calendar'],
      ['Bank koppelen', '38 bankmutaties nog zonder factuur', 'bank'],
      ...(isMb()
        ? [['Niet overgezet bekijken', '58 documenten, met de reden erbij', 'ban']]
        : [
            [
              'Documenten uit Exact overzetten',
              'Optioneel: facturen en bonnen als bijlage',
              'file',
            ],
          ]),
    ]
      .map(
        ([t, sub, ic]) =>
          `<li><a href="#" data-action="todo" class="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-muted"><span class="text-muted-foreground">${icon(ic)}</span><span class="min-w-0 flex-1"><span class="block text-sm font-medium">${t}</span><span class="block text-xs text-muted-foreground tabular">${sub}</span></span>${icon('chevronRight', 'size-4 text-muted-foreground')}</a></li>`,
      )
      .join('')
    const headIcon = clean
      ? `<span class="flex size-12 items-center justify-center border border-success text-success"><svg viewBox="0 0 24 24" class="check-draw size-7" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`
      : `<span class="flex size-12 items-center justify-center border border-foreground">${icon('file', 'size-6')}</span>`
    const block = clean
      ? ''
      : `<article class="mb-8 border border-l-4 border-l-destructive p-4 md:p-5" aria-labelledby="blk-h">
        <div class="mb-2">${badge('error', 'Blokkeert indienen', 'alert')}</div>
        <h2 id="blk-h" class="text-[15px] font-medium">Btw-aangifte Q2 en Q3 2025: indienen via Klopt kan nog niet</h2>
        <p class="mt-1 text-sm">Klopt kan dit nog niet oplossen: bij 9 geïmporteerde Moneybird-inkopen met btw-verlegging of uit de EU hoort zelf af te dragen btw in rubriek 2a/4a/4b en 5b, en die boekt de import niet.</p>
        <p class="mt-2 text-sm"><span class="font-medium">Wat je kunt doen:</span> dien de aangifte voor deze periodes zelf of met een belastingadviseur in, op basis van gecorrigeerde cijfers. Wacht niet op Klopt als je aangiftetermijn eerder afloopt.</p>
        <div class="mt-4 flex flex-wrap gap-2"><a href="#" data-action="todo" class="btn btn-outline">Naar Q2 2025${icon('arrowRight')}</a><a href="#" data-action="todo" class="btn btn-outline">Naar Q3 2025${icon('arrowRight')}</a></div>
      </article>`
    const counts = (
      isMb()
        ? [
            ['Verkoopfacturen', 167],
            ['Inkoopfacturen', 90],
            ['Bonnetjes', 100],
            ['Bankmutaties', 155],
            ['Memoriaalposten', 17],
          ]
        : [
            ['Rekeningen', 312],
            ['Relaties', 186],
            ['Openstaande posten', 47],
          ]
    )
      .map(
        ([l, n]) =>
          `<div class="flex justify-between px-4 py-2.5 text-sm"><dt>${l}</dt><dd class="tabular">${nf(n)}</dd></div>`,
      )
      .join('')
    return {
      body:
        `<div class="mb-6 flex items-start gap-4">${headIcon}<div class="min-w-0 flex-1"><h1 id="step-title" tabindex="-1" class="text-2xl tracking-tight outline-none md:text-[28px]">${isMb() ? 'Je boeken staan in Klopt' : 'Je beginbalans staat in Klopt'}</h1>
        <p class="mt-1 text-sm text-muted-foreground tabular">${isMb() ? '529 documenten overgezet op 26-10-2026 om 19:24. 58 niet overgezet.' : 'Geboekt op 01-01-2026, op 26-10-2026 om 19:24.'}</p></div></div>` +
        block +
        section('Wat nu', `<ul role="list" class="divide-y border">${nextSteps}</ul>`) +
        section('Overgezet', `<dl class="divide-y border">${counts}</dl>`),
      notes: clean
        ? []
        : [
            note(
              'Geen groen vinkje',
              'Zolang een btw-periode geblokkeerd is: geen vinkje en geen “alles klopt”. Zonder blokkade (zie “Zonder blokkade”) wel.',
            ),
          ],
      back: false,
      status: '',
      next: { label: 'Naar de werklijst', action: 'todo' },
    }
  }

  const STEP_FNS = [
    stepBron,
    stepVerbinden,
    stepAdministratie,
    stepVoorbeeld,
    stepBtw,
    stepRekeningen,
    stepProblemen,
    stepOverzicht,
    stepImporteren,
    stepKlaar,
  ]

  // --------------------------------------------------------------- footer

  function footer(v) {
    if (v.hideFooter) return ''
    const n = v.next || {}
    const back =
      v.back === false || S.idx === 0
        ? '<span class="hidden md:block"></span>'
        : `<a href="${hrefFor(D.steps[S.idx - 1].id)}" data-action="back" class="btn btn-outline">${icon('arrowLeft')}Terug${keycaps('escape', 'ml-1')}</a>`
    return `<div data-footer class="fixed inset-x-0 bottom-0 z-20 border-t bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:sticky md:mt-10 md:px-0 md:py-4">
      ${v.status || n.reason ? `<p id="next-why" class="mb-2 text-xs md:hidden ${n.disabled ? 'text-foreground' : 'text-muted-foreground'} tabular">${n.disabled && n.reason ? n.reason : v.status}</p>` : ''}
      <div class="flex items-center gap-3">
        ${back}
        <p class="hidden min-w-0 flex-1 text-sm md:block tabular ${n.disabled ? '' : 'text-muted-foreground'}">${n.disabled && n.reason ? n.reason : v.status || ''}</p>
        <span class="flex-1 md:hidden"></span>
        <button type="button" data-action="next" data-focus="next" class="btn btn-primary flex-1 md:flex-none" ${n.disabled ? 'disabled aria-describedby="next-why"' : ''}>${n.label || 'Volgende'}${n.ext ? icon('external', 'size-3.5') : n.disabled ? '' : keycaps('enter', onPrimary)}</button>
      </div>
      <p class="mt-2 hidden text-right text-xs text-muted-foreground md:block">${keycaps('mod enter')} vanuit een veld · ${keycaps('escape')} sluit eerst een venster</p>
    </div>`
  }

  // --------------------------------------------------------------- render

  let current = null

  function render() {
    const v = STEP_FNS[S.idx]()
    current = v
    const notes = S.p.get('notes') === '0' ? [] : v.notes || []
    const anim =
      S.lastIdx === null || S.lastIdx === S.idx
        ? ''
        : S.dir === 'back'
          ? 'step-in-back'
          : 'step-in-fwd'
    const html = `<a href="#step-title" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-background focus:p-2">Naar de inhoud</a>
      <div class="flex min-h-dvh">
        <div class="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
          <aside aria-label="Navigatie" class="sticky top-0 flex h-dvh flex-col text-sidebar-foreground">${brand()}${entitySwitcher()}<nav aria-label="Hoofdmenu" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">${navList(false)}</nav>${userButton()}</aside>
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          ${topbar()}${protoBar()}
          <main id="main" class="flex-1">
            <div data-page class="mx-auto w-full max-w-[1120px] px-4 pt-5 pb-40 md:px-8 md:pt-8 md:pb-0">
              ${mobileProgress()}
              <div class="md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 xl:grid-cols-[200px_minmax(0,1fr)_208px]">
                <div class="hidden md:block"><div class="sticky top-[72px]"><p class="mb-2 px-2 text-xs text-muted-foreground">${srcLabel()} importeren</p>${rail(false)}</div></div>
                <div class="min-w-0"><div class="${anim}">${v.body}</div>${footer(v)}</div>
                ${notes.length ? `<div class="mt-8 space-y-3 xl:mt-0"><div class="space-y-3 xl:sticky xl:top-[72px]">${notes.join('')}</div></div>` : ''}
              </div>
            </div>
          </main>
        </div>
      </div>`
    root.innerHTML = html.replace(/([€£]) /g, '$1' + NBSP)
    S.lastIdx = S.idx
    renderOverlay()
    if (S.idx === 8 && !S.p.has('pct') && S.p.get('state') !== 'refused') runProgress()
  }

  function rerender() {
    const keep =
      document.activeElement && document.activeElement.dataset
        ? document.activeElement.dataset.focus
        : null
    S.lastIdx = S.idx
    render()
    if (keep) {
      const el = document.querySelector(`[data-focus="${keep}"]`)
      if (el) el.focus({ preventScroll: true })
    }
  }

  function runProgress() {
    clearInterval(S.timer)
    S.timer = setInterval(() => {
      if (S.idx !== 8) return clearInterval(S.timer)
      S.pct = Math.min(100, S.pct + 3)
      const bar = document.querySelector('[data-bar]')
      if (S.pct >= 100) {
        clearInterval(S.timer)
        rerender()
        return
      }
      if (bar) {
        bar.style.width = S.pct + '%'
        document.querySelector('[data-pct]').textContent = S.pct + '%'
        if (S.pct % 15 === 0)
          document.querySelector('[data-live]').textContent = S.pct + '% overgezet'
        const v = stepImporteren()
        const tmp = document.createElement('div')
        tmp.innerHTML = v.body
        document.querySelector('[data-rows]').innerHTML = tmp.querySelector('[data-rows]').innerHTML
      }
    }, 160)
  }

  // ------------------------------------------------------------- overlays

  function dialog(id, title, desc, extra, cancel, confirmLabel, confirmAction) {
    return `<div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div class="animate-in-fade absolute inset-0 bg-black/40" data-action="close-overlay"></div>
      <section role="alertdialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-d" class="animate-in-pop relative w-full border bg-background p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md">
        <h2 id="${id}-t" class="text-lg">${title}</h2>
        <p id="${id}-d" class="mt-2 text-sm text-muted-foreground">${desc}</p>${extra || ''}
        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" data-action="close-overlay" class="btn btn-outline">${cancel}${keycaps('escape', 'ml-1')}</button>
          <button type="button" data-action="${confirmAction}" data-autofocus class="btn btn-primary">${confirmLabel}${keycaps('enter', onPrimary)}</button>
        </div></section></div>`
  }

  function sheet(title, eyebrow, body, foot) {
    return `<div class="fixed inset-0 z-40">
      <div class="animate-in-fade absolute inset-0 bg-black/40" data-action="close-overlay"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="sheet-t" class="animate-in-right absolute top-0 right-0 flex h-full w-full flex-col border-l bg-background sm:w-[520px]">
        <header class="flex items-start gap-3 border-b px-5 py-4"><div class="min-w-0 flex-1"><p class="text-xs text-muted-foreground">${eyebrow}</p><h2 id="sheet-t" class="mt-0.5 text-lg leading-snug">${title}</h2></div>
        <button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon -mt-1 -mr-2" aria-label="Sluiten">${icon('x', 'size-5')}</button></header>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">${body}</div>
        <footer class="flex flex-col-reverse gap-2 border-t px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">${foot}</footer>
      </section></div>`
  }

  function rateSheet(r) {
    const opts = r.candidates || [
      { code: r.code, label: r.label, rubriek: r.rubriek, ledger: r.ledger },
    ]
    const body = `${r.assumption ? `<div class="mb-4">${statusBlock('neutral', `<p>${r.assumption}</p>`)}</div>` : ''}
      <p class="mb-2 text-sm text-muted-foreground tabular">${r.side === 'verkoop' ? 'Verkoop' : 'Inkoop'} · ${r.pct || 'geen percentage'} · ${plural(r.docs, 'document', 'documenten')}</p>
      <fieldset><legend class="mb-2 text-sm font-medium">Btw-code in Klopt</legend><div class="divide-y border">${opts
        .map(
          (o) =>
            `<label class="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted"><input type="radio" name="rate-pick" class="mt-1 size-4 accent-[var(--foreground)]" data-focus="pick-${o.code}"/><span class="text-sm">${codeLabel(o.label, o.code, o.rubriek && o.rubriek !== '—' ? 'rubriek ' + o.rubriek + ' · ' + o.ledger : 'geen rubriek')}</span></label>`,
        )
        .join('')}</div></fieldset>
      <p class="mt-3 text-xs text-muted-foreground">We kiezen niets voor: ook als er maar één code past, kies je hem zelf.</p>`
    return sheet(
      r.name,
      'Btw-code kiezen',
      body,
      `<button type="button" data-action="close-overlay" class="btn btn-outline">Annuleren${keycaps('escape', 'ml-1')}</button><button type="button" data-action="save-rate" data-id="${r.id}" class="btn btn-primary">Opslaan${keycaps('enter', onPrimary)}</button>`,
    )
  }

  function fxSheet() {
    const body = `<p class="text-sm">Inkoopfactuur INV-20931 van Shipton Mill Ltd · £ 1.240,00 · 16-10-2025</p>
      <div class="mt-5"><label for="fx-rate" class="mb-1.5 block text-sm font-medium">Koers: euro per pond</label><input id="fx-rate" data-focus="fx" class="field tabular" value="1,1531" inputmode="decimal"/>
      <p class="mt-1.5 text-xs text-muted-foreground tabular">ECB · 16-10-2025. Pas aan als je bank een andere koers gaf.</p></div>
      <dl class="mt-5 border-y py-3 text-sm"><div class="flex justify-between"><dt class="text-muted-foreground">In euro</dt><dd class="font-medium tabular">€ 1.429,84</dd></div></dl>
      <p class="mt-3 text-xs text-muted-foreground">Er wordt nu nog niets geboekt. Dat gebeurt pas als je importeert.</p>`
    return sheet(
      'Koers voor INV-20931',
      'Koers kiezen',
      body,
      `<button type="button" data-action="close-overlay" class="btn btn-outline">Annuleren${keycaps('escape', 'ml-1')}</button><button type="button" data-action="save-fx" class="btn btn-primary">Opslaan${keycaps('enter', onPrimary)}</button>`,
    )
  }

  function stepsSheet() {
    return `<div class="fixed inset-0 z-40 md:hidden"><div class="animate-in-fade absolute inset-0 bg-black/40" data-action="close-overlay"></div>
      <section role="dialog" aria-modal="true" aria-labelledby="steps-t" class="animate-in-up absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div class="mb-2 flex items-center justify-between"><h2 id="steps-t" class="text-base">${srcLabel()} importeren</h2><button type="button" data-action="close-overlay" class="btn btn-ghost btn-icon -mr-2" aria-label="Sluiten">${icon('x', 'size-5')}</button></div>
        ${rail(true)}</section></div>`
  }

  function renderOverlay() {
    let html = ''
    const o = S.overlay
    if (o === 'confirm-restart')
      html = dialog(
        'rs',
        'Opnieuw beginnen?',
        'Je begint weer bij stap 1. Er is nog niets geboekt, dus in je boekhouding gaat niets verloren.',
        '<p class="mt-2 text-sm text-muted-foreground">Je keuzes voor btw-codes en rekeningen bewaren we als ‘vorige keuze’. Je bevestigt ze straks opnieuw.</p>',
        'Annuleren',
        'Opnieuw beginnen',
        'restart',
      )
    if (o === 'confirm-disconnect')
      html = dialog(
        'dc',
        'Verbinding met Moneybird verbreken?',
        'We gooien je token weg. Voor een nieuwe import maak je opnieuw verbinding.',
        '<p class="mt-2 text-sm text-muted-foreground">Je keuzes voor btw-codes en rekeningen blijven bewaard voor deze administratie. Wat al geïmporteerd is, blijft staan.</p>',
        'Annuleren',
        'Verbreken',
        'disconnect',
      )
    if (o === 'confirm-import')
      html = isMb()
        ? dialog(
            'im',
            '529 documenten importeren?',
            `We boeken ze in ${D.entity.name}, in 2025 en 2026.`,
            `<dl class="mt-4 space-y-1 border-y py-3 text-sm"><div class="flex justify-between"><dt class="text-muted-foreground">Overzetten</dt><dd class="tabular">529</dd></div><div class="flex justify-between"><dt class="text-muted-foreground">Niet overzetten</dt><dd class="tabular">58</dd></div></dl><p class="mt-3 text-sm text-muted-foreground">Een import haal je niet terug met één knop. Een fout herstel je met een tegenboeking.</p>`,
            'Annuleren',
            'Importeren',
            'run-import',
          )
        : dialog(
            'im',
            'Beginbalans boeken?',
            `We boeken één beginbalans op 01-01-2026 in ${D.entity.name}.`,
            '<p class="mt-3 text-sm text-muted-foreground">Een boeking haal je niet terug met één knop. Een fout herstel je met een tegenboeking.</p>',
            'Annuleren',
            'Boeken',
            'run-import',
          )
    if (o === 'sheet') {
      if (S.sheetFor === 'fx') html = fxSheet()
      else {
        const r = S.rates.find((x) => x.id === S.sheetFor)
        if (r) html = rateSheet(r)
      }
    }
    if (o === 'steps') html = stepsSheet()
    overlayRoot.innerHTML = html.replace(/([€£]) /g, '$1' + NBSP)
    if (html) {
      const f = overlayRoot.querySelector('[data-autofocus], [data-focus], input, button')
      if (f) f.focus()
    }
  }

  function openOverlay(name, forId) {
    S.returnFocus = document.activeElement
    S.overlay = name
    S.sheetFor = forId || null
    renderOverlay()
  }
  function closeOverlay() {
    S.overlay = null
    renderOverlay()
    if (S.returnFocus && document.contains(S.returnFocus)) S.returnFocus.focus()
  }

  // -------------------------------------------------------------- actions

  function next() {
    const n = current && current.next
    if (!n || n.disabled || S.overlay) return
    if (n.action === 'confirm-import') return openOverlay('confirm-import')
    if (n.action === 'todo') return toast('Niet in deze mock', { tone: 'info' })
    if (n.action === 'resume') return (location.hash = hrefFor('btw', { resumed: '1' }))
    if (S.idx === 1 && n.action === 'connect') {
      if (isMb()) {
        const v = document.getElementById('mb-token')
        if (v && !v.value) {
          location.hash = hrefFor('verbinden', { state: 'error' })
          return
        }
      }
    }
    if (S.idx < 9) goStep(S.idx + 1)
  }
  function back() {
    if (current && current.back === false) return
    if (S.idx > 0) goStep(S.idx - 1)
  }

  async function reread(id) {
    S.busy = id
    rerender()
    await new Promise((r) => setTimeout(r, reducedMotion.matches ? 300 : 1600))
    S.busy = null
    rerender()
    toast('Opnieuw gelezen. In Moneybird is niets veranderd, dus dit punt staat er nog.', {
      tone: 'info',
    })
  }

  const actions = {
    todo: () => toast('Niet in deze mock', { tone: 'info' }),
    external: () => toast('Opent Moneybird in een nieuw tabblad', { tone: 'info' }),
    copy: () => toast('Redirect-URI gekopieerd'),
    theme: () => {
      const dark = !document.documentElement.classList.contains('dark')
      document.documentElement.classList.toggle('dark', dark)
      localStorage.setItem('klopt-proto-theme', dark ? 'dark' : 'light')
      const p = new URLSearchParams(S.p)
      p.set('theme', dark ? 'dark' : 'light')
      history.replaceState(null, '', '#/' + D.steps[S.idx].id + '?' + p)
      S.p = p
      rerender()
    },
    'toggle-adv': () => {
      S.adv = !S.adv
      const p = new URLSearchParams(S.p)
      S.adv ? p.set('adv', '1') : p.delete('adv')
      S.p = p
      history.replaceState(null, '', '#/' + D.steps[S.idx].id + (p.toString() ? '?' + p : ''))
      rerender()
    },
    next,
    back: (el, e) => {
      e.preventDefault()
      back()
    },
    'pick-src': (el) => {
      S.src = el.dataset.src
      history.replaceState(null, '', hrefFor('bron'))
      S.p = new URLSearchParams(location.hash.split('?')[1] || '')
      rerender()
      document.querySelector(`[data-focus="src-${S.src}"]`).focus()
    },
    'open-confirm': (el) => openOverlay('confirm-' + el.dataset.confirm),
    'close-overlay': closeOverlay,
    restart: () => {
      S.overlay = null
      location.hash = hrefFor('bron')
    },
    disconnect: () => {
      S.overlay = null
      location.hash = hrefFor('verbinden')
      toast('Verbinding verbroken. Je keuzes zijn bewaard.')
    },
    'run-import': () => {
      S.overlay = null
      goStep(8)
    },
    steps: () => openOverlay('steps'),
    'confirm-rate': (el) => {
      const r = S.rates.find((x) => x.id === el.dataset.id)
      r.state = 'confirmed'
      rerender()
      toast(`${r.name} (${r.side}) → ${r.label}`)
      focusCard(r.id)
    },
    'open-sheet': (el) => openOverlay('sheet', el.dataset.id),
    'save-rate': (el) => {
      const r = S.rates.find((x) => x.id === el.dataset.id)
      const picked = overlayRoot.querySelector('input[name="rate-pick"]:checked')
      if (!picked) return toast('Kies eerst een btw-code', { tone: 'info' })
      if (r.candidates) Object.assign(r, r.candidates[0])
      r.state = 'confirmed'
      S.overlay = null
      renderOverlay()
      rerender()
      toast(`${r.name} → ${r.label}`)
      focusCard(r.id)
    },
    'exclude-rate': (el) => {
      const r = S.rates.find((x) => x.id === el.dataset.id)
      r.state = 'excluded'
      rerender()
      toast(`${r.docs} documenten niet overzetten`, { undo: 'undo-exclude', tone: 'info' })
      focusCard(r.id)
    },
    'undo-exclude': () => {
      S.rates.find((x) => x.id === 'r7').state = 'none'
      toastRoot.innerHTML = ''
      rerender()
      focusCard('r7')
    },
    'reread-rate': () => reread('rate'),
    reread: (el) => reread(el.dataset.id),
    'reread-all': () => toast('Opnieuw gelezen. Er is niets veranderd.', { tone: 'info' }),
    'confirm-acc': (el) => {
      const a = S.accounts[Number(el.dataset.i)]
      a.state = a.state === 'new' ? 'created' : 'ok'
      rerender()
    },
    'fix-contact': () => {
      S.contactFixed = true
      rerender()
    },
    'exclude-problem': (el) => {
      S.problems.find((x) => x.id === el.dataset.id).done = 'excluded'
      rerender()
      toast('Memoriaalpost 2025-M011 niet overzetten', { undo: 'undo-problem-last', tone: 'info' })
    },
    'undo-problem': (el) => {
      S.problems.find((x) => x.id === el.dataset.id).done = null
      rerender()
    },
    'undo-problem-last': () => {
      S.problems.find((x) => x.id === 'p-unbal').done = null
      toastRoot.innerHTML = ''
      rerender()
    },
    defer: (el) => {
      S.problems.find((x) => x.id === el.dataset.id).done = 'resolved'
      rerender()
    },
    'save-fx': () => {
      S.problems.find((x) => x.id === 'p-fx').done = 'resolved'
      S.overlay = null
      renderOverlay()
      rerender()
      toast('Koers 1,1531 gekozen voor INV-20931')
    },
  }

  function focusCard(id) {
    const el = document.querySelector(`[data-card="${id}"]`)
    if (el) el.focus({ preventScroll: false })
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]')
    if (!el || el.tagName === 'SELECT') return
    const a = actions[el.dataset.action]
    if (!a) return
    if (el.tagName === 'A' && el.dataset.action !== 'back') e.preventDefault()
    a(el, e)
  })

  document.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'proto-step') goStep(Number(e.target.value))
  })

  document.addEventListener('keydown', (e) => {
    const t = e.target
    const inField = t.matches && t.matches('input, textarea, select, [contenteditable]')
    if (e.key === 'Escape') {
      if (S.overlay) return (e.preventDefault(), closeOverlay())
      if (inField) return t.blur()
      return back()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      return next()
    }
    if (S.overlay) {
      if (e.key === 'Enter' && !inField && !(t.closest && t.closest('button, a'))) {
        const p = overlayRoot.querySelector('.btn-primary')
        if (p) p.click()
      }
      return
    }
    if (inField) return
    if (
      t.getAttribute &&
      t.getAttribute('role') === 'radio' &&
      ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    ) {
      e.preventDefault()
      const ids = ['moneybird', 'exact']
      const n = ids[(ids.indexOf(S.src) + 1) % 2]
      actions['pick-src']({ dataset: { src: n } })
      return
    }
    if ((e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey) {
      const cards = Array.from(document.querySelectorAll('[data-card]'))
      if (!cards.length) return
      const i = cards.indexOf(t.closest ? t.closest('[data-card]') : null)
      const n = e.key === 'j' ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1)
      cards[i < 0 ? 0 : n].focus()
      return
    }
    if (e.key === 'Enter') {
      if (t.closest && t.closest('button, a, summary, label')) return
      const card = t.closest && t.closest('[data-card]')
      if (card) {
        e.preventDefault()
        const first = card.querySelector('[data-action]:not([data-action="external"])')
        if (first) first.click()
        return
      }
      if (t.getAttribute && t.getAttribute('role') === 'radio') return (e.preventDefault(), next())
      e.preventDefault()
      next()
    }
  })

  function hashToast() {
    if (S.p.get('toast') === '1' && S.idx === 4 && excludedRate())
      toast('12 documenten niet overzetten', { undo: 'undo-exclude', tone: 'info' })
  }

  window.addEventListener('hashchange', () => {
    readHash()
    render()
    hashToast()
    const h = document.getElementById('step-title')
    if (h) h.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  })

  readHash()
  render()
  hashToast()
  const f = S.p.get('focus')
  if (f) {
    const el = document.querySelector(`[data-focus="${f}"]`)
    if (el) {
      el.focus({ focusVisible: true })
      el.scrollIntoView({ block: 'center' })
    }
  }
})()
